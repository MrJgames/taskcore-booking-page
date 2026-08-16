import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { sql, type Kysely } from "kysely";
import type { AppConfig } from "./config.js";
import { createAdminAuth } from "./auth.js";
import { generateAvailability } from "./booking/availability.js";
import { createCheckout, customerBookingState } from "./booking/checkout.js";
import { configuredServices, publicService } from "./booking/services.js";
import { SignedSessionError, verifySession, type PaymentSession, type SlotSession } from "./booking/session.js";
import { availabilityQuerySchema, checkoutSchema, paymentTokenSchema } from "./booking/validation.js";
import { SlotUnavailableError } from "./domain/booking.js";
import { DEVELOPMENT_DEPOSIT_CONFIGURATION, type DepositConfiguration } from "./domain/money.js";
import type { PaymentProvider } from "./payments/provider.js";
import { PaymentProviderError } from "./payments/provider.js";
import { bookingIdSchema, depositPaymentSchema } from "./payments/validation.js";
import { processSquareWebhook } from "./payments/webhook.js";
import { PaymentWorkflowError, processDepositPayment } from "./payments/workflow.js";
import type { TaskCoreDatabase } from "./types.js";
import { adminUpdateSchema, serviceRequestSchema } from "./validation.js";

const adminDirectory = fileURLToPath(new URL("../public/", import.meta.url));

function publicRequest(row: Record<string, unknown>) {
  return {
    id: row.id,
    createdAt: row.created_at,
    customerName: row.customer_name,
    phone: row.phone,
    email: row.email,
    serviceAddress: row.service_address,
    issueDescription: row.issue_description,
    preferredContactMethod: row.preferred_contact_method,
    preferredServiceDate: row.preferred_service_date,
    requestedArrivalWindow: row.requested_arrival_window,
    submittedAt: row.submitted_at,
    status: row.status,
    privateNote: row.private_note,
    updatedAt: row.updated_at
  };
}

export interface AppDependencies {
  paymentProvider?: PaymentProvider;
  depositConfiguration?: DepositConfiguration;
  now?: () => Date;
  customerDirectory?: string;
}

export function createApp(config: AppConfig, db: Kysely<TaskCoreDatabase>, dependencies: AppDependencies = {}) {
  const app = express();
  const depositConfiguration = dependencies.depositConfiguration ?? DEVELOPMENT_DEPOSIT_CONFIGURATION;
  const now = () => (dependencies.now?.() ?? new Date()).toISOString();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://sandbox.web.squarecdn.com"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'", "https://sandbox.web.squarecdn.com", "https://pci-connect.squareupsandbox.com", "https://o160250.ingest.sentry.io"],
        frameSrc: ["'self'", "https://sandbox.web.squarecdn.com"],
        fontSrc: ["'self'", "https://square-fonts-production-f.squarecdn.com", "https://d1g145x70srn7h.cloudfront.net"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"]
      }
    }
  }));
  app.use(cors({
    origin(origin, callback) {
      if (!origin || config.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin not allowed."));
    },
    methods: ["GET", "POST", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"]
  }));

  app.post("/api/webhooks/square", express.raw({ type: "application/json", limit: config.bodyLimit }), async (request, response, next) => {
    try {
      if (!dependencies.paymentProvider || !Buffer.isBuffer(request.body)) {
        response.status(503).json({ error: "Payment webhooks are not configured." });
        return;
      }
      const signature = request.get("x-square-hmacsha256-signature");
      const rawBody = request.body.toString("utf8");
      if (!signature || !await dependencies.paymentProvider.verifyWebhookSignature(rawBody, signature)) {
        response.status(403).json({ error: "Webhook verification failed." });
        return;
      }
      await processSquareWebhook(db, rawBody, depositConfiguration, now());
      response.status(200).json({ received: true });
    } catch (error) {
      next(error);
    }
  });
  app.use(express.json({ limit: config.bodyLimit, strict: true }));

  app.get("/health", async (_request, response) => {
    try {
      await sql`select 1`.execute(db);
      response.json({ status: "ok", database: "connected" });
    } catch {
      response.status(503).json({ status: "unavailable" });
    }
  });

  const submissionLimiter = rateLimit({
    windowMs: config.rateLimitWindowMs,
    limit: config.rateLimitMax,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests. Please wait and try again, or text TaskCore." }
  });

  const paymentLimiter = rateLimit({
    windowMs: config.rateLimitWindowMs,
    limit: Math.max(3, config.rateLimitMax),
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many payment attempts. Please wait and try again." }
  });

  const services = configuredServices(config.nodeEnv);
  const bookingLimiter = rateLimit({
    windowMs: config.rateLimitWindowMs, limit: Math.max(3, config.rateLimitMax), standardHeaders: "draft-7", legacyHeaders: false,
    message: { error: "Too many booking attempts. Please wait and try again, or request a quote." }
  });
  app.use("/api/booking", (_request, response, next) => { response.set("Cache-Control", "no-store, private"); next(); });
  app.use("/api/bookings", (_request, response, next) => { response.set("Cache-Control", "no-store, private"); next(); });

  app.get("/api/booking/services", (_request, response) => {
    response.json({ services: services.map((service) => publicService(service, depositConfiguration)), quoteRequestPath: "#quote",
      timezone: config.businessTimezone, policyStatus: "development_placeholder" });
  });

  app.get("/api/booking/availability", async (request, response, next) => {
    try {
      if (config.paymentSessionSecret.length < 32) { response.status(503).json({ error: "Online booking is not configured yet." }); return; }
      const parsed = availabilityQuerySchema.safeParse(request.query);
      if (!parsed.success) { response.status(400).json({ error: "Choose a valid service." }); return; }
      const service = services.find((item) => item.id === parsed.data.serviceId);
      if (!service) { response.status(404).json({ error: "Service not found." }); return; }
      if (!service.directlyBookable || service.price.kind !== "fixed") { response.status(409).json({ error: "This service requires a quote before scheduling.", quoteRequestPath: "#quote" }); return; }
      const slots = await generateAvailability(db, service, { timezone: config.businessTimezone, secret: config.paymentSessionSecret, now: dependencies.now?.() ?? new Date(), days: parsed.data.days });
      response.json({ serviceId: service.id, timezone: config.businessTimezone, canonicalSlotMinutes: service.durationMinutes, slots });
    } catch (error) { next(error); }
  });

  app.post("/api/booking/checkout-session", bookingLimiter, async (request, response, next) => {
    try {
      if (config.paymentSessionSecret.length < 32) { response.status(503).json({ error: "Online booking is not configured yet." }); return; }
      const parsed = checkoutSchema.safeParse(request.body);
      if (!parsed.success) { response.status(400).json({ error: "Check the booking details and try again.", fields: parsed.error.flatten().fieldErrors }); return; }
      const service = services.find((item) => item.id === parsed.data.serviceId);
      if (!service) { response.status(404).json({ error: "Service not found." }); return; }
      if (!service.directlyBookable || service.price.kind !== "fixed") { response.status(409).json({ error: "This service requires a quote before scheduling.", quoteRequestPath: "#quote" }); return; }
      const current = dependencies.now?.() ?? new Date();
      const slot = verifySession<SlotSession>(parsed.data.slotId, config.paymentSessionSecret, "slot", current);
      if (slot.serviceId !== service.id || slot.timezone !== config.businessTimezone) throw new SignedSessionError("mismatch");
      const canonical = await generateAvailability(db, service, { timezone: config.businessTimezone, secret: config.paymentSessionSecret, now: current });
      if (!canonical.some((item) => item.start === slot.start && item.end === slot.end)) { response.status(409).json({ error: "That appointment is no longer available. Please choose another time." }); return; }
      const result = await createCheckout(db, { service, slot, name: parsed.data.name, email: parsed.data.email || undefined,
        phone: parsed.data.phone, address: parsed.data.address, notes: parsed.data.notes, now: current,
        holdMinutes: config.bookingHoldMinutes, paymentSessionMinutes: config.paymentSessionMinutes,
        secret: config.paymentSessionSecret, depositConfiguration });
      response.status(201).json({ ...result, payment: config.square?.environment === "sandbox" ? {
        environment: "sandbox", applicationId: config.square.applicationId, locationId: config.square.locationId,
        sdkUrl: "https://sandbox.web.squarecdn.com/v1/square.js"
      } : null });
    } catch (error) { next(error); }
  });

  app.get("/api/booking/session/:token/status", async (request, response, next) => {
    try {
      if (config.paymentSessionSecret.length < 32) { response.status(503).json({ error: "Online booking is not configured yet." }); return; }
      const parsed = paymentTokenSchema.safeParse(request.params.token); if (!parsed.success) { response.status(403).json({ error: "This booking link is invalid." }); return; }
      const current = dependencies.now?.() ?? new Date();
      const session = verifySession<PaymentSession>(parsed.data, config.paymentSessionSecret, "payment", current);
      const booking = await db.selectFrom("bookings").select(["customer_id", "service_type"]).where("id", "=", session.bookingId).executeTakeFirst();
      if (!booking || booking.customer_id !== session.customerId) throw new SignedSessionError("mismatch");
      const service = services.find((item) => item.id === booking.service_type); if (!service) { response.status(404).json({ error: "Booking service not found." }); return; }
      const state = await customerBookingState(db, session.bookingId, service, depositConfiguration, current.toISOString());
      response.json(state);
    } catch (error) { next(error); }
  });

  app.post("/api/bookings/:bookingId/deposit-payment", paymentLimiter, async (request, response, next) => {
    try {
      if (!dependencies.paymentProvider) {
        response.status(503).json({ error: "Deposit payments are not configured." });
        return;
      }
      const bookingId = bookingIdSchema.safeParse(request.params.bookingId);
      const body = depositPaymentSchema.safeParse(request.body);
      if (!bookingId.success || !body.success) {
        response.status(400).json({ error: "Check the payment request and try again." });
        return;
      }
      if (config.paymentSessionSecret.length < 32) { response.status(503).json({ error: "Online booking is not configured yet." }); return; }
      const session = verifySession<PaymentSession>(body.data.paymentSessionToken, config.paymentSessionSecret, "payment", dependencies.now?.() ?? new Date());
      if (session.bookingId !== bookingId.data) throw new SignedSessionError("mismatch");
      const ownedBooking = await db.selectFrom("bookings").select("customer_id").where("id", "=", bookingId.data).executeTakeFirst();
      if (!ownedBooking || ownedBooking.customer_id !== session.customerId) throw new SignedSessionError("mismatch");
      const result = await processDepositPayment(db, dependencies.paymentProvider, {
        bookingId: bookingId.data,
        sourceToken: body.data.sourceToken,
        requestId: body.data.requestId,
        verificationToken: body.data.verificationToken,
        depositConfiguration,
        now: now()
      });
      if (result.status === "failed") {
        response.status(402).json({ paymentId: result.paymentId, status: "failed", error: "The payment was declined. Please try another payment method." });
        return;
      }
      response.status(result.status === "paid" ? 200 : 202).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/service-requests", submissionLimiter, async (request, response, next) => {
    try {
      const parsed = serviceRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({
          error: "Please check the highlighted request details.",
          fields: parsed.error.flatten().fieldErrors
        });
        return;
      }
      const now = new Date().toISOString();
      const id = randomUUID();
      const data = parsed.data;
      await db.insertInto("service_requests").values({
        id,
        created_at: now,
        customer_name: data.name,
        phone: data.phone,
        email: data.email || null,
        service_address: data.address,
        issue_description: data.issue,
        preferred_contact_method: data.contactMethod,
        preferred_service_date: data.appointmentDate,
        requested_arrival_window: data.arrivalWindow,
        submitted_at: data.submissionTimestamp || now,
        status: "New",
        private_note: null,
        updated_at: now
      }).executeTakeFirstOrThrow();
      response.status(201).json({ id, status: "New", createdAt: now });
    } catch (error) {
      next(error);
    }
  });

  const adminAuth = createAdminAuth(config);
  app.use("/api/admin", adminAuth);

  app.get("/api/admin/service-requests", async (_request, response, next) => {
    try {
      const rows = await db.selectFrom("service_requests").selectAll()
        .orderBy((expression) => expression.case().when("status", "=", "New").then(0).else(1).end())
        .orderBy("created_at", "desc")
        .execute();
      response.json({ requests: rows.map((row) => publicRequest(row as unknown as Record<string, unknown>)) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/service-requests/:id", async (request, response, next) => {
    try {
      const row = await db.selectFrom("service_requests").selectAll().where("id", "=", request.params.id).executeTakeFirst();
      if (!row) {
        response.status(404).json({ error: "Request not found." });
        return;
      }
      response.json({ request: publicRequest(row as unknown as Record<string, unknown>) });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/admin/service-requests/:id", async (request, response, next) => {
    try {
      const parsed = adminUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: "Check the status or private note." });
        return;
      }
      const changes: { status?: typeof parsed.data.status; private_note?: string; updated_at: string } = { updated_at: new Date().toISOString() };
      if (parsed.data.status !== undefined) changes.status = parsed.data.status;
      if (parsed.data.privateNote !== undefined) changes.private_note = parsed.data.privateNote;
      const result = await db.updateTable("service_requests").set(changes).where("id", "=", request.params.id).executeTakeFirst();
      if (Number(result.numUpdatedRows) === 0) {
        response.status(404).json({ error: "Request not found." });
        return;
      }
      const row = await db.selectFrom("service_requests").selectAll().where("id", "=", request.params.id).executeTakeFirstOrThrow();
      response.json({ request: publicRequest(row as unknown as Record<string, unknown>) });
    } catch (error) {
      next(error);
    }
  });

  app.use("/admin", adminAuth, express.static(adminDirectory, { index: "index.html", dotfiles: "deny" }));

  if (dependencies.customerDirectory) app.use(express.static(dependencies.customerDirectory, { dotfiles: "deny", index: "index.html" }));
  app.use((_request, response) => response.status(404).json({ error: "Not found." }));
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof SyntaxError) {
      response.status(400).json({ error: "The request body is not valid JSON." });
      return;
    }
    if (error instanceof Error && error.message === "Origin not allowed.") {
      response.status(403).json({ error: "This website is not allowed to access the service." });
      return;
    }
    if (error instanceof PaymentWorkflowError) {
      response.status(error.statusCode).json({ error: error.message });
      return;
    }
    if (error instanceof PaymentProviderError) {
      response.status(error.retryable ? 503 : 402).json({ error: error.message });
      return;
    }
    if (error instanceof SlotUnavailableError) { response.status(409).json({ error: error.message }); return; }
    if (error instanceof SignedSessionError) {
      response.status(error.reason === "expired" ? 410 : 403).json({ error: error.reason === "expired" ? "This booking session has expired. Please choose another appointment." : "This booking session is invalid." });
      return;
    }
    if (config.nodeEnv !== "test") console.error("TaskCore API error", error);
    response.status(500).json({ error: "The request could not be completed. Please try again or text TaskCore." });
  });
  return app;
}
