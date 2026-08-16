import { sql } from "kysely";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { createDatabase, initializeDatabase } from "../database.js";
import { createBookingHold, createCustomer, createPendingBookingFromHold, transitionBooking } from "../domain/booking.js";
import { signSession } from "../booking/session.js";
import type { DepositConfiguration } from "../domain/money.js";
import { PaymentProviderError, type CreateProviderPaymentInput, type PaymentProvider, type ProviderPaymentResult } from "./provider.js";

const databases: ReturnType<typeof createDatabase>[] = [];
const now = "2026-08-15T18:01:00.000Z";
const depositConfig: DepositConfiguration = { defaultRule: { kind: "fixed", amountCents: 5_000 } };
const sessionSecret = "phase-six-test-payment-session-secret";

class MockProvider implements PaymentProvider {
  readonly name = "square";
  readonly calls: CreateProviderPaymentInput[] = [];
  signatureValid = true;
  results: Array<ProviderPaymentResult | Error> = [];
  async createPayment(input: CreateProviderPaymentInput) {
    this.calls.push(input);
    const result = this.results.shift();
    if (result instanceof Error) throw result;
    return result ?? { providerPaymentId: "sq-default", status: "paid", amountCents: input.amountCents, currency: input.currency, refundedAmountCents: 0 };
  }
  async verifyWebhookSignature() { return this.signatureValid; }
}

async function setup(provider = new MockProvider()) {
  const config = loadConfig({ nodeEnv: "test", sqlitePath: ":memory:", adminUsername: "jay",
    adminPassword: "test-password-long-enough", corsOrigins: ["http://localhost:8000"], rateLimitMax: 100,
    paymentSessionSecret: sessionSecret });
  const db = createDatabase(config);
  databases.push(db);
  await initializeDatabase(db);
  const customerId = await createCustomer(db, { name: "Payment Customer", email: "buyer@example.com",
    phone: "7605550123", serviceAddress: "123 Palm Avenue" }, now);
  const holdId = await createBookingHold(db, { customerId, serviceType: "installation",
    requestedStart: "2026-08-20T17:00:00.000Z", requestedEnd: "2026-08-20T19:00:00.000Z",
    timezone: "America/Los_Angeles", expiresAt: "2026-08-15T18:15:00.000Z" }, "2026-08-15T18:00:00.000Z");
  const bookingId = await createPendingBookingFromHold(db, holdId, null, "2026-08-15T18:00:30.000Z");
  await db.updateTable("bookings").set({ quoted_total_cents: 20_000 }).where("id", "=", bookingId).execute();
  const app = createApp(config, db, { paymentProvider: provider, depositConfiguration: depositConfig, now: () => new Date(now) });
  const paymentSessionToken = signSession({ type: "payment", bookingId, customerId, exp: Math.floor(new Date(now).getTime() / 1000) + 600 }, sessionSecret);
  return { app, db, provider, bookingId, customerId, paymentSessionToken };
}

function paymentBody(paymentSessionToken: string, requestId = "request_123456") { return { sourceToken: "sandbox-source-token", requestId, paymentSessionToken }; }
function webhookBody(eventId: string, payment: Record<string, unknown>) {
  return JSON.stringify({ event_id: eventId, type: "payment.updated", data: { object: { payment } } });
}

afterEach(async () => { await Promise.all(databases.splice(0).map((db) => db.destroy())); });

describe("deposit payment endpoint", () => {
  it("confirms a valid deposit and creates exactly one job and outbox item", async () => {
    const { app, db, provider, bookingId, paymentSessionToken } = await setup();
    provider.results.push({ providerPaymentId: "sq-paid-1", status: "paid", amountCents: 5_000, currency: "USD", refundedAmountCents: 0 });
    const response = await request(app).post(`/api/bookings/${bookingId}/deposit-payment`).send(paymentBody(paymentSessionToken)).expect(200);
    expect(response.body).toMatchObject({ status: "paid", bookingId, remainingBalanceCents: 15_000 });
    expect(await db.selectFrom("bookings").select("status").where("id", "=", bookingId).executeTakeFirst()).toEqual({ status: "confirmed" });
    expect(await db.selectFrom("jobs").selectAll().execute()).toHaveLength(1);
    expect(await db.selectFrom("integration_outbox").selectAll().execute()).toHaveLength(1);
  });

  it("does not confirm or create downstream records after a decline", async () => {
    const { app, db, provider, bookingId, paymentSessionToken } = await setup();
    provider.results.push({ providerPaymentId: "sq-failed", status: "failed", amountCents: 5_000, currency: "USD", refundedAmountCents: 0 });
    await request(app).post(`/api/bookings/${bookingId}/deposit-payment`).send(paymentBody(paymentSessionToken)).expect(402);
    expect(await db.selectFrom("bookings").select("status").where("id", "=", bookingId).executeTakeFirst()).toEqual({ status: "pending_payment" });
    expect(await db.selectFrom("jobs").selectAll().execute()).toEqual([]);
    expect(await db.selectFrom("integration_outbox").selectAll().execute()).toEqual([]);
  });

  it("rejects browser-supplied authoritative amounts", async () => {
    const { app, provider, bookingId, paymentSessionToken } = await setup();
    await request(app).post(`/api/bookings/${bookingId}/deposit-payment`).send({ ...paymentBody(paymentSessionToken), amountCents: 1 }).expect(400);
    expect(provider.calls).toHaveLength(0);
  });

  it("replays the same request without a second provider charge, job, or outbox item", async () => {
    const { app, db, provider, bookingId, paymentSessionToken } = await setup();
    provider.results.push({ providerPaymentId: "sq-replay", status: "paid", amountCents: 5_000, currency: "USD", refundedAmountCents: 0 });
    await request(app).post(`/api/bookings/${bookingId}/deposit-payment`).send(paymentBody(paymentSessionToken)).expect(200);
    await request(app).post(`/api/bookings/${bookingId}/deposit-payment`).send(paymentBody(paymentSessionToken)).expect(200);
    expect(provider.calls).toHaveLength(1);
    expect(await db.selectFrom("payments").selectAll().execute()).toHaveLength(1);
    expect(await db.selectFrom("jobs").selectAll().execute()).toHaveLength(1);
    expect(await db.selectFrom("integration_outbox").selectAll().execute()).toHaveLength(1);
  });

  it("retries a provider network failure with the same Square idempotency key and local payment", async () => {
    const { app, db, provider, bookingId, paymentSessionToken } = await setup();
    provider.results.push(new PaymentProviderError("Temporary payment outage.", true));
    provider.results.push({ providerPaymentId: "sq-retry", status: "paid", amountCents: 5_000, currency: "USD", refundedAmountCents: 0 });
    await request(app).post(`/api/bookings/${bookingId}/deposit-payment`).send(paymentBody(paymentSessionToken)).expect(503);
    await request(app).post(`/api/bookings/${bookingId}/deposit-payment`).send(paymentBody(paymentSessionToken)).expect(200);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0]?.idempotencyKey).toBe(provider.calls[1]?.idempotencyKey);
    expect(await db.selectFrom("payments").selectAll().execute()).toHaveLength(1);
  });

  it("keeps a failed payment retryable with a new logical request while the slot is valid", async () => {
    const { app, db, provider, bookingId, paymentSessionToken } = await setup();
    provider.results.push({ providerPaymentId: "sq-decline-1", status: "failed", amountCents: 5_000, currency: "USD", refundedAmountCents: 0 });
    provider.results.push({ providerPaymentId: "sq-success-2", status: "paid", amountCents: 5_000, currency: "USD", refundedAmountCents: 0 });
    await request(app).post(`/api/bookings/${bookingId}/deposit-payment`).send(paymentBody(paymentSessionToken, "request_decline_1")).expect(402);
    await request(app).post(`/api/bookings/${bookingId}/deposit-payment`).send(paymentBody(paymentSessionToken, "request_retry_2")).expect(200);
    expect(await db.selectFrom("payments").selectAll().execute()).toHaveLength(2);
    expect(await db.selectFrom("bookings").select("status").where("id", "=", bookingId).executeTakeFirst()).toEqual({ status: "confirmed" });
  });

  it("rejects an expired reservation before contacting the provider", async () => {
    const { app, db, provider, bookingId, paymentSessionToken } = await setup();
    await db.updateTable("slot_reservations").set({ expires_at: "2026-08-15T18:00:00.000Z" }).where("booking_id", "=", bookingId).execute();
    await request(app).post(`/api/bookings/${bookingId}/deposit-payment`).send(paymentBody(paymentSessionToken)).expect(409);
    expect(provider.calls).toHaveLength(0);
  });

  it("rejects invalid booking state", async () => {
    const { app, provider, db, bookingId, paymentSessionToken } = await setup();
    await transitionBooking(db, bookingId, "cancelled", now);
    await request(app).post(`/api/bookings/${bookingId}/deposit-payment`).send(paymentBody(paymentSessionToken)).expect(409);
    expect(provider.calls).toHaveLength(0);
  });

  it("does not confirm a provider response with the wrong amount", async () => {
    const { app, db, provider, bookingId, paymentSessionToken } = await setup();
    provider.results.push({ providerPaymentId: "sq-wrong", status: "paid", amountCents: 1, currency: "USD", refundedAmountCents: 0 });
    await request(app).post(`/api/bookings/${bookingId}/deposit-payment`).send(paymentBody(paymentSessionToken)).expect(409);
    expect(await db.selectFrom("bookings").select("status").where("id", "=", bookingId).executeTakeFirst()).toEqual({ status: "pending_payment" });
  });

  it("never persists the source token or raw card fields", async () => {
    const { app, db, provider, bookingId, paymentSessionToken } = await setup();
    await request(app).post(`/api/bookings/${bookingId}/deposit-payment`).send({ ...paymentBody(paymentSessionToken), cardNumber: "4111111111111111", cvv: "123" }).expect(400);
    expect(provider.calls).toHaveLength(0);
    expect(JSON.stringify(await db.selectFrom("payments").selectAll().execute())).not.toContain("4111111111111111");
  });
});

describe("Square webhook processing", () => {
  it("rejects an invalid signature before parsing or recording an event", async () => {
    const provider = new MockProvider(); provider.signatureValid = false;
    const { app, db } = await setup(provider);
    await request(app).post("/api/webhooks/square").set("Content-Type", "application/json")
      .set("x-square-hmacsha256-signature", "invalid").send("not-json").expect(403);
    expect(await db.selectFrom("payment_events").selectAll().execute()).toEqual([]);
  });

  it("processes a valid webhook and deduplicates its replay", async () => {
    const { app, db, provider, bookingId, paymentSessionToken } = await setup();
    provider.results.push({ providerPaymentId: "sq-pending", status: "pending", amountCents: 5_000, currency: "USD", refundedAmountCents: 0 });
    const pending = await request(app).post(`/api/bookings/${bookingId}/deposit-payment`).send(paymentBody(paymentSessionToken)).expect(202);
    const body = webhookBody("event-paid-1", { id: "sq-pending", reference_id: pending.body.paymentId,
      status: "COMPLETED", amount_money: { amount: 5_000, currency: "USD" }, refunded_money: { amount: 0, currency: "USD" } });
    await request(app).post("/api/webhooks/square").set("Content-Type", "application/json")
      .set("x-square-hmacsha256-signature", "valid").send(body).expect(200);
    await request(app).post("/api/webhooks/square").set("Content-Type", "application/json")
      .set("x-square-hmacsha256-signature", "valid").send(body).expect(200);
    expect(await db.selectFrom("bookings").select("status").where("id", "=", bookingId).executeTakeFirst()).toEqual({ status: "confirmed" });
    expect(await db.selectFrom("payment_events").selectAll().execute()).toHaveLength(1);
    expect(await db.selectFrom("jobs").selectAll().execute()).toHaveLength(1);
    expect(await db.selectFrom("integration_outbox").selectAll().execute()).toHaveLength(1);
  });

  it("recovers through a webhook after Square succeeds but the first DB confirmation rolls back", async () => {
    const { app, db, provider, bookingId, paymentSessionToken } = await setup();
    provider.results.push({ providerPaymentId: "sq-recovery", status: "paid", amountCents: 5_000, currency: "USD", refundedAmountCents: 0 });
    await sql`create trigger fail_job_insert before insert on jobs begin select raise(fail, 'simulated job failure'); end`.execute(db);
    await request(app).post(`/api/bookings/${bookingId}/deposit-payment`).send(paymentBody(paymentSessionToken)).expect(500);
    const local = await db.selectFrom("payments").selectAll().executeTakeFirstOrThrow();
    expect(local.status).toBe("pending");
    await sql`drop trigger fail_job_insert`.execute(db);
    const body = webhookBody("event-recovery", { id: "sq-recovery", reference_id: local.id,
      status: "COMPLETED", amount_money: { amount: 5_000, currency: "USD" }, refunded_money: { amount: 0, currency: "USD" } });
    await request(app).post("/api/webhooks/square").set("Content-Type", "application/json")
      .set("x-square-hmacsha256-signature", "valid").send(body).expect(200);
    expect(await db.selectFrom("bookings").select("status").where("id", "=", bookingId).executeTakeFirst()).toEqual({ status: "confirmed" });
    expect(await db.selectFrom("jobs").selectAll().execute()).toHaveLength(1);
  });

  it("normalizes partial and full refunds without cancelling the booking", async () => {
    const { app, db, provider, bookingId, paymentSessionToken } = await setup();
    provider.results.push({ providerPaymentId: "sq-refund", status: "paid", amountCents: 5_000, currency: "USD", refundedAmountCents: 0 });
    const paid = await request(app).post(`/api/bookings/${bookingId}/deposit-payment`).send(paymentBody(paymentSessionToken)).expect(200);
    for (const [eventId, refunded] of [["event-partial", 2_000], ["event-full", 5_000]] as const) {
      const body = webhookBody(eventId, { id: "sq-refund", reference_id: paid.body.paymentId,
        status: "COMPLETED", amount_money: { amount: 5_000, currency: "USD" }, refunded_money: { amount: refunded, currency: "USD" } });
      await request(app).post("/api/webhooks/square").set("Content-Type", "application/json")
        .set("x-square-hmacsha256-signature", "valid").send(body).expect(200);
    }
    expect(await db.selectFrom("payments").select(["status", "refunded_amount_cents"]).where("id", "=", paid.body.paymentId).executeTakeFirst())
      .toEqual({ status: "refunded", refunded_amount_cents: 5_000 });
    expect(await db.selectFrom("bookings").select("status").where("id", "=", bookingId).executeTakeFirst()).toEqual({ status: "confirmed" });
  });
});
