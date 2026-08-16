import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { DepositConfiguration } from "../domain/money.js";
import { calculateDepositCents, calculateRemainingBalanceCents } from "../domain/money.js";
import type { TaskCoreDatabase } from "../types.js";
import { exclusiveSlotKey, SlotUnavailableError } from "../domain/booking.js";
import { releaseExpiredReservations } from "./availability.js";
import type { BookableService } from "./services.js";
import { publicService } from "./services.js";
import { signSession, type PaymentSession, type SlotSession } from "./session.js";

export const DEVELOPMENT_POLICY_TEXT = "Development placeholder only: TaskCore must approve the final deposit and cancellation policy before production use.";

function uniqueViolation(error: unknown): boolean { return /unique|duplicate|primary key/i.test(error instanceof Error ? error.message : String(error)); }

export async function createCheckout(db: Kysely<TaskCoreDatabase>, input: {
  service: BookableService; slot: SlotSession; name: string; email?: string; phone: string; address: string; notes?: string;
  now: Date; holdMinutes: number; paymentSessionMinutes: number; secret: string; depositConfiguration: DepositConfiguration;
}) {
  if (!input.service.directlyBookable || input.service.price.kind !== "fixed") throw new Error("quote_required");
  const totalCents = input.service.price.totalCents;
  const now = input.now.toISOString();
  await releaseExpiredReservations(db, now);
  const holdExpires = new Date(input.now.getTime() + input.holdMinutes * 60_000).toISOString();
  const customerId = randomUUID(); const holdId = randomUUID(); const bookingId = randomUUID();
  try {
    await db.transaction().execute(async (trx) => {
      const existing = await trx.selectFrom("customers").selectAll().where("phone", "=", input.phone)
        .where("email", "=", input.email ?? null).executeTakeFirst();
      const effectiveCustomerId = existing?.id ?? customerId;
      if (existing) await trx.updateTable("customers").set({ name: input.name, service_address: input.address, updated_at: now }).where("id", "=", existing.id).execute();
      else await trx.insertInto("customers").values({ id: customerId, name: input.name, email: input.email ?? null, phone: input.phone, service_address: input.address, created_at: now, updated_at: now }).execute();
      await trx.insertInto("booking_holds").values({ id: holdId, customer_id: effectiveCustomerId, service_type: input.service.id,
        requested_start: input.slot.start, requested_end: input.slot.end, timezone: input.slot.timezone, status: "consumed",
        expires_at: holdExpires, created_at: now, updated_at: now }).execute();
      await trx.insertInto("bookings").values({ id: bookingId, customer_id: effectiveCustomerId, booking_hold_id: holdId,
        service_type: input.service.id, requested_start: input.slot.start, requested_end: input.slot.end, timezone: input.slot.timezone,
        status: "pending_payment", notes: input.notes ?? null, quoted_total_cents: totalCents, created_at: now, updated_at: now }).execute();
      await trx.insertInto("slot_reservations").values({ slot_key: exclusiveSlotKey(input.slot.start, input.slot.end, input.slot.timezone),
        hold_id: holdId, booking_id: bookingId, expires_at: holdExpires, created_at: now, updated_at: now }).execute();
    });
  } catch (error) { if (uniqueViolation(error)) throw new SlotUnavailableError(); throw error; }
  const row = await db.selectFrom("bookings").select("customer_id").where("id", "=", bookingId).executeTakeFirstOrThrow();
  const paymentExpiresAt = new Date(Math.min(new Date(holdExpires).getTime(), input.now.getTime() + input.paymentSessionMinutes * 60_000));
  const token = signSession({ type: "payment", bookingId, customerId: row.customer_id, exp: Math.floor(paymentExpiresAt.getTime() / 1000) } satisfies PaymentSession, input.secret);
  return { paymentSessionToken: token, ...(await customerBookingState(db, bookingId, input.service, input.depositConfiguration, now)),
    paymentSessionExpiresAt: paymentExpiresAt.toISOString() };
}

export async function customerBookingState(db: Kysely<TaskCoreDatabase>, bookingId: string, service: BookableService,
  depositConfiguration: DepositConfiguration, now = new Date().toISOString()) {
  await releaseExpiredReservations(db, now);
  const booking = await db.selectFrom("bookings").selectAll().where("id", "=", bookingId).executeTakeFirst();
  if (!booking) return null;
  const customer = await db.selectFrom("customers").selectAll().where("id", "=", booking.customer_id).executeTakeFirstOrThrow();
  const reservation = await db.selectFrom("slot_reservations").selectAll().where("booking_id", "=", booking.id).executeTakeFirst();
  const payment = await db.selectFrom("payments").selectAll().where("booking_id", "=", booking.id).orderBy("created_at", "desc").executeTakeFirst();
  const totalCents = booking.quoted_total_cents ?? 0; const depositCents = calculateDepositCents(totalCents, booking.service_type, depositConfiguration);
  const state = booking.status === "confirmed" ? "confirmed" : booking.status === "expired" || !reservation ? "expired" :
    payment?.status === "pending" && payment.provider_payment_id ? "processing" : payment?.status === "failed" ? "failed" : "awaiting_payment";
  return { bookingId: booking.id, reference: `TC-${booking.id.slice(0, 8).toUpperCase()}`, state,
    service: publicService(service, depositConfiguration), customer: { name: customer.name }, address: customer.service_address,
    appointment: { start: booking.requested_start, end: booking.requested_end, timezone: booking.timezone },
    money: { currency: "USD", totalCents, depositCents, dueTodayCents: depositCents, remainingBalanceCents: calculateRemainingBalanceCents(totalCents, depositCents), paidDepositCents: booking.status === "confirmed" ? depositCents : 0 },
    policyText: DEVELOPMENT_POLICY_TEXT, holdExpiresAt: reservation?.expires_at ?? null };
}
