import { randomUUID } from "node:crypto";
import type { Kysely, Transaction } from "kysely";
import type { BookingStatus, TaskCoreDatabase } from "../types.js";
import { assertBookingTransition } from "./state-machines.js";

type DatabaseExecutor = Kysely<TaskCoreDatabase> | Transaction<TaskCoreDatabase>;
export class SlotUnavailableError extends Error { constructor() { super("The requested appointment slot is no longer available."); } }
export interface CustomerInput { name: string; email?: string | null; phone: string; serviceAddress: string; }
export interface BookingHoldInput { customerId: string; serviceType: string; requestedStart: string; requestedEnd: string; timezone: string; expiresAt: string; }
export function exclusiveSlotKey(start: string, end: string, timezone: string): string { return `${start}|${end}|${timezone}`; }

export async function createCustomer(db: DatabaseExecutor, input: CustomerInput, now = new Date().toISOString(), id = randomUUID()): Promise<string> {
  await db.insertInto("customers").values({ id, name: input.name, email: input.email ?? null, phone: input.phone,
    service_address: input.serviceAddress, created_at: now, updated_at: now }).executeTakeFirstOrThrow();
  return id;
}
async function expireStaleHolds(trx: Transaction<TaskCoreDatabase>, now: string): Promise<void> {
  const stale = await trx.selectFrom("slot_reservations").select(["slot_key", "hold_id", "booking_id"])
    .where("expires_at", "<=", now).execute();
  const holdIds = stale.flatMap((row) => row.hold_id ? [row.hold_id] : []);
  if (holdIds.length) await trx.updateTable("booking_holds").set({ status: "expired", updated_at: now })
    .where("id", "in", holdIds).where("status", "=", "active").execute();
  const bookingIds = stale.flatMap((row) => row.booking_id ? [row.booking_id] : []);
  if (bookingIds.length) await trx.updateTable("bookings").set({ status: "expired", updated_at: now })
    .where("id", "in", bookingIds).where("status", "=", "pending_payment").execute();
  const keys = stale.map((row) => row.slot_key);
  if (keys.length) await trx.deleteFrom("slot_reservations").where("slot_key", "in", keys).execute();
}
function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error); return /unique|duplicate|primary key/i.test(message);
}
export async function createBookingHold(db: Kysely<TaskCoreDatabase>, input: BookingHoldInput, now = new Date().toISOString(), id = randomUUID()): Promise<string> {
  if (input.requestedEnd <= input.requestedStart) throw new Error("The appointment end must be after its start.");
  if (input.expiresAt <= now) throw new Error("A booking hold must expire in the future.");
  const slotKey = exclusiveSlotKey(input.requestedStart, input.requestedEnd, input.timezone);
  try {
    return await db.transaction().execute(async (trx) => {
      await expireStaleHolds(trx, now);
      await trx.insertInto("booking_holds").values({ id, customer_id: input.customerId, service_type: input.serviceType,
        requested_start: input.requestedStart, requested_end: input.requestedEnd, timezone: input.timezone,
        status: "active", expires_at: input.expiresAt, created_at: now, updated_at: now }).executeTakeFirstOrThrow();
      await trx.insertInto("slot_reservations").values({ slot_key: slotKey, hold_id: id, booking_id: null,
        expires_at: input.expiresAt, created_at: now, updated_at: now }).executeTakeFirstOrThrow();
      return id;
    });
  } catch (error) { if (isUniqueViolation(error)) throw new SlotUnavailableError(); throw error; }
}
export async function createPendingBookingFromHold(db: Kysely<TaskCoreDatabase>, holdId: string, notes: string | null = null, now = new Date().toISOString(), bookingId = randomUUID()): Promise<string> {
  return db.transaction().execute(async (trx) => {
    const hold = await trx.selectFrom("booking_holds").selectAll().where("id", "=", holdId).executeTakeFirstOrThrow();
    if (hold.status !== "active") throw new Error("Only an active hold can create a booking.");
    if (hold.expires_at <= now) {
      await trx.updateTable("booking_holds").set({ status: "expired", updated_at: now }).where("id", "=", holdId).execute();
      await trx.deleteFrom("slot_reservations").where("hold_id", "=", holdId).execute();
      throw new Error("The booking hold has expired.");
    }
    await trx.insertInto("bookings").values({ id: bookingId, customer_id: hold.customer_id, booking_hold_id: hold.id,
      service_type: hold.service_type, requested_start: hold.requested_start, requested_end: hold.requested_end,
      timezone: hold.timezone, status: "pending_payment", notes, quoted_total_cents: null,
      created_at: now, updated_at: now }).executeTakeFirstOrThrow();
    await trx.updateTable("booking_holds").set({ status: "consumed", updated_at: now }).where("id", "=", holdId).execute();
    await trx.updateTable("slot_reservations").set({ booking_id: bookingId, updated_at: now }).where("hold_id", "=", holdId).execute();
    return bookingId;
  });
}
export async function transitionBooking(db: DatabaseExecutor, bookingId: string, nextStatus: BookingStatus, now = new Date().toISOString()): Promise<void> {
  const booking = await db.selectFrom("bookings").select("status").where("id", "=", bookingId).executeTakeFirstOrThrow();
  assertBookingTransition(booking.status, nextStatus);
  await db.updateTable("bookings").set({ status: nextStatus, updated_at: now }).where("id", "=", bookingId).execute();
  if (nextStatus === "confirmed") await db.updateTable("slot_reservations").set({ expires_at: null, updated_at: now }).where("booking_id", "=", bookingId).execute();
  if (["cancelled", "completed", "expired"].includes(nextStatus)) await db.deleteFrom("slot_reservations").where("booking_id", "=", bookingId).execute();
}
