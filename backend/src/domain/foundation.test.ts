import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, initializeDatabase } from "../database.js";
import { loadConfig } from "../config.js";
import type { TaskCoreDatabase } from "../types.js";
import { createBookingHold, createCustomer, createPendingBookingFromHold, SlotUnavailableError, transitionBooking } from "./booking.js";
import { calculateDepositCents, calculateRemainingBalanceCents } from "./money.js";
import { createPayment, enqueueIntegration, recordPaymentEvent, transitionPayment } from "./payments.js";

const databases: ReturnType<typeof createDatabase>[] = [];
const now = "2026-08-15T18:00:00.000Z";
const start = "2026-08-20T17:00:00.000Z";
const end = "2026-08-20T19:00:00.000Z";

async function freshDatabase() {
  const db = createDatabase(loadConfig({ nodeEnv: "test", sqlitePath: ":memory:" }));
  databases.push(db);
  await initializeDatabase(db);
  return db;
}

async function customerAndBooking(db: ReturnType<typeof createDatabase>) {
  const customerId = await createCustomer(db, { name: "Jordan Customer", email: null, phone: "7605550123", serviceAddress: "123 Palm Ave" }, now);
  const holdId = await createBookingHold(db, { customerId, serviceType: "installation", requestedStart: start, requestedEnd: end,
    timezone: "America/Los_Angeles", expiresAt: "2026-08-15T18:15:00.000Z" }, now);
  const bookingId = await createPendingBookingFromHold(db, holdId, null, now);
  return { customerId, bookingId };
}

afterEach(async () => { await Promise.all(databases.splice(0).map((db) => db.destroy())); });

describe("versioned migration foundation", () => {
  it("migrates a fresh SQLite database and records ordered migrations", async () => {
    const db = await freshDatabase();
    const tables = await db.introspection.getTables();
    expect(tables.map((table) => table.name)).toEqual(expect.arrayContaining([
      "service_requests", "customers", "booking_holds", "bookings", "jobs", "payments",
      "payment_events", "integration_outbox", "slot_reservations"
    ]));
    const history = await sql<{ name: string }>`select name from kysely_migration order by timestamp`.execute(db);
    expect(history.rows.map((row) => row.name)).toEqual([
      "001_existing_service_requests", "002_booking_payment_foundation", "003_square_payment_foundation"
    ]);
  });

  it("adopts the pre-Phase-4 service_requests table without losing data", async () => {
    const db = createDatabase(loadConfig({ nodeEnv: "test", sqlitePath: ":memory:" }));
    databases.push(db);
    await db.schema.createTable("service_requests")
      .addColumn("id", "varchar(36)", (column) => column.primaryKey())
      .addColumn("created_at", "varchar(30)", (column) => column.notNull())
      .addColumn("customer_name", "varchar(100)", (column) => column.notNull())
      .addColumn("phone", "varchar(30)", (column) => column.notNull())
      .addColumn("email", "varchar(254)").addColumn("service_address", "varchar(250)", (column) => column.notNull())
      .addColumn("issue_description", "text", (column) => column.notNull())
      .addColumn("preferred_contact_method", "varchar(10)", (column) => column.notNull())
      .addColumn("preferred_service_date", "varchar(10)", (column) => column.notNull())
      .addColumn("requested_arrival_window", "varchar(30)", (column) => column.notNull())
      .addColumn("submitted_at", "varchar(30)", (column) => column.notNull())
      .addColumn("status", "varchar(20)", (column) => column.notNull().defaultTo("New"))
      .addColumn("private_note", "text").addColumn("updated_at", "varchar(30)", (column) => column.notNull()).execute();
    await db.insertInto("service_requests").values({ id: randomUUID(), created_at: now, customer_name: "Existing Customer",
      phone: "7605550100", email: null, service_address: "Existing Address", issue_description: "Existing request data",
      preferred_contact_method: "Text", preferred_service_date: "2026-08-20", requested_arrival_window: "Flexible",
      submitted_at: now, status: "Contacted", private_note: "Preserve me", updated_at: now }).execute();
    await initializeDatabase(db);
    const rows = await db.selectFrom("service_requests").selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ customer_name: "Existing Customer", status: "Contacted", private_note: "Preserve me" });
  });
});

describe("customers, holds, and bookings", () => {
  it("creates a customer and an active hold", async () => {
    const db = await freshDatabase();
    const customerId = await createCustomer(db, { name: "Jessie", phone: "7605550111", serviceAddress: "Palm Desert" }, now);
    const holdId = await createBookingHold(db, { customerId, serviceType: "support", requestedStart: start, requestedEnd: end,
      timezone: "America/Los_Angeles", expiresAt: "2026-08-15T18:15:00.000Z" }, now);
    expect(await db.selectFrom("customers").select("email").where("id", "=", customerId).executeTakeFirst()).toEqual({ email: null });
    expect(await db.selectFrom("booking_holds").select("status").where("id", "=", holdId).executeTakeFirst()).toEqual({ status: "active" });
  });

  it("rejects a conflicting active hold", async () => {
    const db = await freshDatabase();
    const customerId = await createCustomer(db, { name: "Jessie", phone: "7605550111", serviceAddress: "Palm Desert" }, now);
    const input = { customerId, serviceType: "support", requestedStart: start, requestedEnd: end,
      timezone: "America/Los_Angeles", expiresAt: "2026-08-15T18:15:00.000Z" };
    await createBookingHold(db, input, now);
    await expect(createBookingHold(db, input, now)).rejects.toBeInstanceOf(SlotUnavailableError);
  });

  it("expires a stale hold and releases its slot", async () => {
    const db = await freshDatabase();
    const customerId = await createCustomer(db, { name: "Jessie", phone: "7605550111", serviceAddress: "Palm Desert" }, now);
    const input = { customerId, serviceType: "support", requestedStart: start, requestedEnd: end,
      timezone: "America/Los_Angeles", expiresAt: "2026-08-15T18:15:00.000Z" };
    const oldHold = await createBookingHold(db, input, now);
    await expect(createBookingHold(db, { ...input, expiresAt: "2026-08-15T19:00:00.000Z" }, "2026-08-15T18:16:00.000Z")).resolves.toBeTruthy();
    expect(await db.selectFrom("booking_holds").select("status").where("id", "=", oldHold).executeTakeFirst()).toEqual({ status: "expired" });
  });

  it("enforces booking transitions and keeps confirmed slots exclusive", async () => {
    const db = await freshDatabase();
    const { customerId, bookingId } = await customerAndBooking(db);
    await transitionBooking(db, bookingId, "confirmed", now);
    await expect(createBookingHold(db, { customerId, serviceType: "other", requestedStart: start, requestedEnd: end,
      timezone: "America/Los_Angeles", expiresAt: "2026-08-15T18:15:00.000Z" }, now)).rejects.toBeInstanceOf(SlotUnavailableError);
    await transitionBooking(db, bookingId, "cancelled", now);
    await expect(transitionBooking(db, bookingId, "confirmed", now)).rejects.toThrow(/Invalid booking transition/);
  });
});

describe("payments and integrations", () => {
  it("enforces payment transitions and idempotency uniqueness", async () => {
    const db = await freshDatabase();
    const { customerId, bookingId } = await customerAndBooking(db);
    const input = { bookingId, customerId, provider: "square", type: "deposit" as const, amountCents: 5_000, currency: "usd", idempotencyKey: "booking-deposit-1" };
    const paymentId = await createPayment(db, input, now);
    await transitionPayment(db, paymentId, "paid", now);
    await expect(transitionPayment(db, paymentId, "failed", now)).rejects.toThrow(/Invalid payment transition/);
    await expect(createPayment(db, input, now)).rejects.toThrow();
  });

  it("treats duplicate provider events idempotently", async () => {
    const db = await freshDatabase();
    const first = await recordPaymentEvent(db, { provider: "square", providerEventId: "event-1", eventType: "payment.updated" }, now);
    const duplicate = await recordPaymentEvent(db, { provider: "square", providerEventId: "event-1", eventType: "payment.updated" }, now);
    expect(first.created).toBe(true); expect(duplicate).toEqual({ id: first.id, created: false });
  });

  it("stores an integration outbox record without changing booking truth", async () => {
    const db = await freshDatabase();
    const { bookingId } = await customerAndBooking(db);
    const outboxId = await enqueueIntegration(db, { aggregateType: "booking", aggregateId: bookingId, integration: "google_calendar", action: "create_event" }, now);
    expect(await db.selectFrom("integration_outbox").select(["status", "retry_count"]).where("id", "=", outboxId).executeTakeFirst())
      .toEqual({ status: "pending", retry_count: 0 });
  });
});

describe("integer-cent deposit rules", () => {
  it("calculates a fixed deposit", () => expect(calculateDepositCents(20_000, "default", { defaultRule: { kind: "fixed", amountCents: 5_000 } })).toBe(5_000));
  it("rounds percentage deposits to integer cents", () => expect(calculateDepositCents(10_005, "default", { defaultRule: { kind: "percentage", basisPoints: 2_500 } })).toBe(2_501));
  it("applies service-specific overrides", () => expect(calculateDepositCents(20_000, "installation", { defaultRule: { kind: "fixed", amountCents: 2_500 }, serviceOverrides: { installation: { kind: "percentage", basisPoints: 5_000 } } })).toBe(10_000));
  it("calculates remaining balance without floats or negative balances", () => {
    expect(calculateRemainingBalanceCents(20_000, 5_000)).toBe(15_000);
    expect(calculateRemainingBalanceCents(20_000, 25_000)).toBe(0);
    expect(() => calculateRemainingBalanceCents(20_000.5, 5_000)).toThrow(/integer/);
  });
});
