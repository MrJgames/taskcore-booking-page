import { createHash, randomUUID } from "node:crypto";
import type { Kysely, Transaction } from "kysely";
import type { DepositConfiguration } from "../domain/money.js";
import { calculateDepositCents, calculateRemainingBalanceCents } from "../domain/money.js";
import { createPayment } from "../domain/payments.js";
import type { PaymentStatus, TaskCoreDatabase } from "../types.js";
import type { PaymentProvider, ProviderPaymentResult } from "./provider.js";

export class PaymentWorkflowError extends Error {
  constructor(message: string, readonly statusCode = 409) { super(message); }
}

function stableIdempotencyKey(bookingId: string, requestId: string): string {
  return `tcdep_${createHash("sha256").update(`${bookingId}:${requestId}`).digest("hex").slice(0, 32)}`;
}

function uniqueViolation(error: unknown): boolean {
  return /unique|duplicate|primary key/i.test(error instanceof Error ? error.message : String(error));
}

async function getOrCreatePendingPayment(db: Kysely<TaskCoreDatabase>, input: {
  bookingId: string; customerId: string; amountCents: number; idempotencyKey: string;
}, now: string) {
  const existing = await db.selectFrom("payments").selectAll().where("provider", "=", "square")
    .where("idempotency_key", "=", input.idempotencyKey).executeTakeFirst();
  if (existing) return existing;
  const id = randomUUID();
  try {
    await createPayment(db, { bookingId: input.bookingId, customerId: input.customerId, provider: "square",
      type: "deposit", amountCents: input.amountCents, currency: "USD", idempotencyKey: input.idempotencyKey }, now, id);
  } catch (error) {
    if (!uniqueViolation(error)) throw error;
  }
  return db.selectFrom("payments").selectAll().where("provider", "=", "square")
    .where("idempotency_key", "=", input.idempotencyKey).executeTakeFirstOrThrow();
}

async function upsertCalendarOutbox(trx: Transaction<TaskCoreDatabase>, bookingId: string, now: string): Promise<string> {
  const dedupeKey = `google_calendar:booking:${bookingId}:create_event`;
  const id = randomUUID();
  await trx.insertInto("integration_outbox").values({ id, aggregate_type: "booking", aggregate_id: bookingId,
    integration: "google_calendar", action: "create_event", dedupe_key: dedupeKey, status: "pending",
    external_id: null, retry_count: 0, last_error_summary: null, available_at: now,
    created_at: now, updated_at: now }).onConflict((conflict) => conflict.column("dedupe_key").doNothing()).execute();
  return (await trx.selectFrom("integration_outbox").select("id").where("dedupe_key", "=", dedupeKey).executeTakeFirstOrThrow()).id;
}

export async function confirmBookingAfterPaidDeposit(db: Kysely<TaskCoreDatabase>, input: {
  paymentId: string; providerPaymentId: string; providerAmountCents: number; currency: string;
  depositConfiguration: DepositConfiguration; now?: string;
}): Promise<{ bookingId: string; jobId: string; outboxId: string; remainingBalanceCents: number }> {
  const now = input.now ?? new Date().toISOString();
  return db.transaction().execute(async (trx) => {
    const payment = await trx.selectFrom("payments").selectAll().where("id", "=", input.paymentId).executeTakeFirstOrThrow();
    const booking = await trx.selectFrom("bookings").selectAll().where("id", "=", payment.booking_id).executeTakeFirstOrThrow();
    const customer = await trx.selectFrom("customers").selectAll().where("id", "=", payment.customer_id).executeTakeFirstOrThrow();
    if (booking.customer_id !== payment.customer_id || payment.type !== "deposit") throw new PaymentWorkflowError("Payment does not match this booking.");
    if (booking.quoted_total_cents === null) throw new PaymentWorkflowError("This booking is not ready for payment.");
    const requiredDeposit = calculateDepositCents(booking.quoted_total_cents, booking.service_type, input.depositConfiguration);
    if (payment.amount_cents !== requiredDeposit || input.providerAmountCents !== requiredDeposit || input.currency.toUpperCase() !== payment.currency) {
      throw new PaymentWorkflowError("The verified payment amount does not match the required deposit.");
    }
    if (payment.status !== "pending" && payment.status !== "paid") throw new PaymentWorkflowError("This payment cannot confirm the booking.");
    if (booking.status !== "pending_payment" && booking.status !== "confirmed") throw new PaymentWorkflowError("This booking cannot be confirmed from its current state.");
    const reservation = await trx.selectFrom("slot_reservations").selectAll().where("booking_id", "=", booking.id).executeTakeFirst();
    if (!reservation) throw new PaymentWorkflowError("The appointment reservation is unavailable.");
    if (booking.status === "pending_payment" && reservation.expires_at !== null && reservation.expires_at <= now) {
      throw new PaymentWorkflowError("The appointment reservation has expired.", 409);
    }

    await trx.updateTable("payments").set({ provider_payment_id: input.providerPaymentId, status: "paid", updated_at: now })
      .where("id", "=", payment.id).execute();
    if (booking.status === "pending_payment") {
      await trx.updateTable("bookings").set({ status: "confirmed", updated_at: now }).where("id", "=", booking.id).execute();
    }
    await trx.updateTable("slot_reservations").set({ expires_at: null, updated_at: now }).where("booking_id", "=", booking.id).execute();

    const remainingBalanceCents = calculateRemainingBalanceCents(booking.quoted_total_cents, requiredDeposit);
    const proposedJobId = randomUUID();
    await trx.insertInto("jobs").values({ id: proposedJobId, customer_id: customer.id, booking_id: booking.id,
      service: booking.service_type, address: customer.service_address, scheduled_start: booking.requested_start,
      scheduled_end: booking.requested_end, status: "scheduled", quoted_total_cents: booking.quoted_total_cents,
      deposit_amount_cents: requiredDeposit, remaining_balance_cents: remainingBalanceCents,
      payment_status: "paid", created_at: now, updated_at: now })
      .onConflict((conflict) => conflict.column("booking_id").doUpdateSet({
        deposit_amount_cents: requiredDeposit, remaining_balance_cents: remainingBalanceCents,
        payment_status: "paid", updated_at: now
      })).execute();
    const jobId = (await trx.selectFrom("jobs").select("id").where("booking_id", "=", booking.id).executeTakeFirstOrThrow()).id;
    const outboxId = await upsertCalendarOutbox(trx, booking.id, now);
    return { bookingId: booking.id, jobId, outboxId, remainingBalanceCents };
  });
}

export async function processDepositPayment(db: Kysely<TaskCoreDatabase>, provider: PaymentProvider, input: {
  bookingId: string; sourceToken: string; requestId: string; verificationToken?: string;
  depositConfiguration: DepositConfiguration; now?: string;
}) {
  const now = input.now ?? new Date().toISOString();
  const booking = await db.selectFrom("bookings").selectAll().where("id", "=", input.bookingId).executeTakeFirst();
  if (!booking) throw new PaymentWorkflowError("Booking not found.", 404);
  if (booking.quoted_total_cents === null) throw new PaymentWorkflowError("This booking is not ready for payment.");
  if (booking.status !== "pending_payment" && booking.status !== "confirmed") throw new PaymentWorkflowError("This booking is not eligible for a deposit payment.");
  const reservation = await db.selectFrom("slot_reservations").selectAll().where("booking_id", "=", booking.id).executeTakeFirst();
  if (!reservation || (booking.status === "pending_payment" && reservation.expires_at !== null && reservation.expires_at <= now)) {
    throw new PaymentWorkflowError("The appointment reservation has expired.");
  }
  const amountCents = calculateDepositCents(booking.quoted_total_cents, booking.service_type, input.depositConfiguration);
  const idempotencyKey = stableIdempotencyKey(booking.id, input.requestId);
  const localPayment = await getOrCreatePendingPayment(db, { bookingId: booking.id, customerId: booking.customer_id, amountCents, idempotencyKey }, now);

  if (localPayment.status === "paid" && localPayment.provider_payment_id) {
    const confirmation = await confirmBookingAfterPaidDeposit(db, { paymentId: localPayment.id,
      providerPaymentId: localPayment.provider_payment_id, providerAmountCents: localPayment.amount_cents,
      currency: localPayment.currency, depositConfiguration: input.depositConfiguration, now });
    return { paymentId: localPayment.id, status: "paid" as const, ...confirmation };
  }
  if (localPayment.status === "failed") return { paymentId: localPayment.id, status: "failed" as const };

  const result = await provider.createPayment({ sourceToken: input.sourceToken, idempotencyKey, amountCents,
    currency: "USD", referenceId: localPayment.id, verificationToken: input.verificationToken });
  if (result.amountCents !== amountCents || result.currency.toUpperCase() !== "USD") {
    throw new PaymentWorkflowError("The payment processor returned an unexpected amount.");
  }
  if (result.status === "failed") {
    await db.updateTable("payments").set({ provider_payment_id: result.providerPaymentId, status: "failed", updated_at: now })
      .where("id", "=", localPayment.id).execute();
    return { paymentId: localPayment.id, status: "failed" as const };
  }
  if (result.status === "pending") {
    await db.updateTable("payments").set({ provider_payment_id: result.providerPaymentId, updated_at: now })
      .where("id", "=", localPayment.id).execute();
    return { paymentId: localPayment.id, status: "pending" as const };
  }
  if (result.status !== "paid") throw new PaymentWorkflowError("This payment state cannot confirm a new booking.");
  const confirmation = await confirmBookingAfterPaidDeposit(db, { paymentId: localPayment.id,
    providerPaymentId: result.providerPaymentId, providerAmountCents: result.amountCents,
    currency: result.currency, depositConfiguration: input.depositConfiguration, now });
  return { paymentId: localPayment.id, status: "paid" as const, ...confirmation };
}

export async function applyProviderRefundTotal(db: Kysely<TaskCoreDatabase>, paymentId: string, refundedAmountCents: number, now = new Date().toISOString()): Promise<PaymentStatus> {
  if (!Number.isSafeInteger(refundedAmountCents) || refundedAmountCents < 0) throw new PaymentWorkflowError("Invalid refund amount.");
  return db.transaction().execute(async (trx) => {
    const payment = await trx.selectFrom("payments").selectAll().where("id", "=", paymentId).executeTakeFirstOrThrow();
    const effectiveRefund = Math.max(payment.refunded_amount_cents, refundedAmountCents);
    const status: PaymentStatus = effectiveRefund >= payment.amount_cents ? "refunded" : effectiveRefund > 0 ? "partially_refunded" : payment.status;
    await trx.updateTable("payments").set({ refunded_amount_cents: effectiveRefund, status, updated_at: now }).where("id", "=", payment.id).execute();
    if (status === "refunded" || status === "partially_refunded") {
      await trx.updateTable("jobs").set({ payment_status: status, updated_at: now }).where("booking_id", "=", payment.booking_id).execute();
    }
    return status;
  });
}
