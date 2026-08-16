import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { createDatabase, initializeDatabase } from "../database.js";
import { signSession } from "./session.js";
import type { PaymentProvider } from "../payments/provider.js";

const databases: ReturnType<typeof createDatabase>[] = [];
const secret = "phase-six-booking-api-test-secret-value";
const now = new Date("2026-08-17T16:00:00.000Z");
const square = { environment: "sandbox" as const, accessToken: "server-secret-must-not-leak", applicationId: "sandbox-app-id",
  locationId: "sandbox-location-id", webhookSignatureKey: "webhook-secret", webhookNotificationUrl: "https://example.test/api/webhooks/square" };
const unusedProvider: PaymentProvider = { name: "square", async createPayment() { throw new Error("Provider must not be called."); }, async verifyWebhookSignature() { return false; } };

async function setup(clock = now) {
  const config = loadConfig({ nodeEnv: "test", sqlitePath: ":memory:", adminUsername: "test", adminPassword: "test-password-long-enough",
    paymentSessionSecret: secret, businessTimezone: "America/Los_Angeles", rateLimitMax: 100, square });
  const db = createDatabase(config); databases.push(db); await initializeDatabase(db);
  return { app: createApp(config, db, { now: () => clock, paymentProvider: unusedProvider }), db };
}
const customer = { serviceId: "development-demo-appointment", name: "Taylor Customer", phone: "7605550100",
  email: "taylor@example.com", address: "123 Palm Avenue, Palm Desert, CA", notes: "Please text on arrival." };
async function firstSlot(app: ReturnType<typeof createApp>) {
  const response = await request(app).get("/api/booking/availability").query({ serviceId: customer.serviceId }).expect(200);
  return response.body.slots[0] as { id: string; start: string; end: string; timezone: string };
}
afterEach(async () => Promise.all(databases.splice(0).map((db) => db.destroy())));

describe("customer booking APIs", () => {
  it("lists direct and quote-required services from server configuration", async () => {
    const { app } = await setup(); const result = await request(app).get("/api/booking/services").expect(200);
    expect(result.body.services.some((service: { directlyBookable: boolean }) => service.directlyBookable)).toBe(true);
    expect(result.body.services.some((service: { pricing: { kind: string } }) => service.pricing.kind === "quote_required")).toBe(true);
  });
  it("prevents quote-required services from entering availability", async () => {
    const { app } = await setup(); await request(app).get("/api/booking/availability").query({ serviceId: "installation" }).expect(409);
  });
  it("returns canonical, signed, non-overlapping timezone-aware slots", async () => {
    const { app } = await setup(); const result = await request(app).get("/api/booking/availability").query({ serviceId: customer.serviceId }).expect(200);
    expect(result.body.timezone).toBe("America/Los_Angeles"); expect(result.body.slots.length).toBeGreaterThan(0);
    expect(new Set(result.body.slots.map((slot: { start: string }) => slot.start)).size).toBe(result.body.slots.length);
    expect(result.body.slots[0].id.split(".")).toHaveLength(2);
  });
  it("rejects an invented arbitrary slot token", async () => {
    const { app } = await setup(); await request(app).post("/api/booking/checkout-session").send({ ...customer, slotId: "invented-slot-token-that-is-long-enough" }).expect(403);
  });
  it("creates one customer, consumed hold, pending booking, and reservation", async () => {
    const { app, db } = await setup(); const slot = await firstSlot(app);
    const result = await request(app).post("/api/booking/checkout-session").send({ ...customer, slotId: slot.id, totalCents: 1 }).expect(400);
    expect(result.body.error).toMatch(/check/i);
    const created = await request(app).post("/api/booking/checkout-session").send({ ...customer, slotId: slot.id }).expect(201);
    expect(created.body.money).toMatchObject({ totalCents: 20_000, depositCents: 5_000, remainingBalanceCents: 15_000 });
    expect(await db.selectFrom("customers").selectAll().execute()).toHaveLength(1);
    expect(await db.selectFrom("booking_holds").select("status").execute()).toEqual([{ status: "consumed" }]);
    expect(await db.selectFrom("bookings").select("status").execute()).toEqual([{ status: "pending_payment" }]);
    expect(await db.selectFrom("slot_reservations").selectAll().execute()).toHaveLength(1);
  });
  it("removes a reserved canonical slot from availability", async () => {
    const { app } = await setup(); const slot = await firstSlot(app);
    await request(app).post("/api/booking/checkout-session").send({ ...customer, slotId: slot.id }).expect(201);
    const next = await request(app).get("/api/booking/availability").query({ serviceId: customer.serviceId }).expect(200);
    expect(next.body.slots.some((item: { start: string }) => item.start === slot.start)).toBe(false);
  });
  it("releases an expired hold and returns the slot to availability", async () => {
    const { app, db } = await setup(); const slot = await firstSlot(app);
    await request(app).post("/api/booking/checkout-session").send({ ...customer, slotId: slot.id }).expect(201);
    await db.updateTable("slot_reservations").set({ expires_at: "2026-08-17T15:00:00.000Z" }).execute();
    const next = await request(app).get("/api/booking/availability").query({ serviceId: customer.serviceId }).expect(200);
    expect(next.body.slots.some((item: { start: string }) => item.start === slot.start)).toBe(true);
  });
  it("returns only browser-safe Square configuration", async () => {
    const { app } = await setup(); const slot = await firstSlot(app);
    const created = await request(app).post("/api/booking/checkout-session").send({ ...customer, slotId: slot.id }).expect(201);
    expect(created.body.payment).toMatchObject({ environment: "sandbox", applicationId: "sandbox-app-id", locationId: "sandbox-location-id" });
    expect(JSON.stringify(created.body)).not.toContain(square.accessToken); expect(JSON.stringify(created.body)).not.toContain(square.webhookSignatureKey);
  });
  it("rejects a tampered payment session", async () => {
    const { app } = await setup(); const slot = await firstSlot(app);
    const created = await request(app).post("/api/booking/checkout-session").send({ ...customer, slotId: slot.id }).expect(201);
    await request(app).get(`/api/booking/session/${created.body.paymentSessionToken}x/status`).expect(403);
  });
  it("rejects an expired payment session", async () => {
    const { app } = await setup(); const token = signSession({ type: "payment", bookingId: crypto.randomUUID(), customerId: crypto.randomUUID(), exp: Math.floor(now.getTime() / 1000) - 1 }, secret);
    await request(app).get(`/api/booking/session/${token}/status`).expect(410);
  });
  it("returns a sanitized authoritative review and awaiting-payment state", async () => {
    const { app } = await setup(); const slot = await firstSlot(app);
    const created = await request(app).post("/api/booking/checkout-session").send({ ...customer, slotId: slot.id }).expect(201);
    const status = await request(app).get(`/api/booking/session/${created.body.paymentSessionToken}/status`).expect(200);
    expect(status.body).toMatchObject({ state: "awaiting_payment", customer: { name: customer.name }, address: customer.address });
    expect(status.headers["cache-control"]).toContain("no-store");
  });
  it("cannot use a signed session to pay a different booking", async () => {
    const { app } = await setup(); const slot = await firstSlot(app);
    const created = await request(app).post("/api/booking/checkout-session").send({ ...customer, slotId: slot.id }).expect(201);
    await request(app).post(`/api/bookings/${crypto.randomUUID()}/deposit-payment`).send({ sourceToken: "token", requestId: "request_123456", paymentSessionToken: created.body.paymentSessionToken }).expect(403);
  });
});
