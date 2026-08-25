import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { sql, type Kysely } from "kysely";
import type { AppConfig } from "./config.js";
import { createAdminAuth } from "./auth.js";
import type { TaskCoreDatabase } from "./types.js";
import { adminUpdateSchema, serviceRequestSchema } from "./validation.js";
import { registerInspectionRoutes } from "./inspections.js";

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

export function createApp(config: AppConfig, db: Kysely<TaskCoreDatabase>) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
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
    allowedHeaders: ["Content-Type", "Authorization", "X-File-Name"]
  }));
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

  registerInspectionRoutes(app, config, db);

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
    if (config.nodeEnv !== "test") console.error("TaskCore API error", error);
    response.status(500).json({ error: "The request could not be completed. Please try again or text TaskCore." });
  });
  return app;
}
