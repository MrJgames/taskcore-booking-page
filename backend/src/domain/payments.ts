import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { PaymentEventStatus, PaymentStatus, PaymentType, TaskCoreDatabase } from "../types.js";
import { assertPaymentTransition } from "./state-machines.js";

function isUniqueViolation(error: unknown): boolean { const message = error instanceof Error ? error.message : String(error); return /unique|duplicate|primary key/i.test(message); }
export async function createPayment(db: Kysely<TaskCoreDatabase>, input: { bookingId: string; customerId: string; provider: string; providerPaymentId?: string | null; type: PaymentType; amountCents: number; currency: string; idempotencyKey: string; }, now = new Date().toISOString(), id = randomUUID()): Promise<string> {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 0) throw new Error("Payment amount must be non-negative integer cents.");
  await db.insertInto("payments").values({ id, booking_id: input.bookingId, customer_id: input.customerId,
    provider: input.provider, provider_payment_id: input.providerPaymentId ?? null, type: input.type,
    amount_cents: input.amountCents, currency: input.currency.toUpperCase(), status: "pending",
    refunded_amount_cents: 0, idempotency_key: input.idempotencyKey, created_at: now, updated_at: now }).executeTakeFirstOrThrow();
  return id;
}
export async function transitionPayment(db: Kysely<TaskCoreDatabase>, paymentId: string, nextStatus: PaymentStatus, now = new Date().toISOString()): Promise<void> {
  const payment = await db.selectFrom("payments").select("status").where("id", "=", paymentId).executeTakeFirstOrThrow();
  assertPaymentTransition(payment.status, nextStatus);
  await db.updateTable("payments").set({ status: nextStatus, updated_at: now }).where("id", "=", paymentId).execute();
}
export async function recordPaymentEvent(db: Kysely<TaskCoreDatabase>, input: { provider: string; providerEventId: string; eventType: string; paymentId?: string | null; processingStatus?: PaymentEventStatus; }, now = new Date().toISOString(), id = randomUUID()): Promise<{ id: string; created: boolean }> {
  try {
    await db.insertInto("payment_events").values({ id, provider: input.provider, provider_event_id: input.providerEventId,
      event_type: input.eventType, payment_id: input.paymentId ?? null, processing_status: input.processingStatus ?? "pending",
      error_summary: null, received_at: now, processed_at: null, created_at: now, updated_at: now }).executeTakeFirstOrThrow();
    return { id, created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await db.selectFrom("payment_events").select("id").where("provider", "=", input.provider)
      .where("provider_event_id", "=", input.providerEventId).executeTakeFirstOrThrow();
    return { id: existing.id, created: false };
  }
}
export async function enqueueIntegration(db: Kysely<TaskCoreDatabase>, input: { aggregateType: string; aggregateId: string; integration: string; action: string; }, now = new Date().toISOString(), id = randomUUID()): Promise<string> {
  const dedupeKey = `${input.integration}:${input.aggregateType}:${input.aggregateId}:${input.action}`;
  try {
    await db.insertInto("integration_outbox").values({ id, aggregate_type: input.aggregateType, aggregate_id: input.aggregateId,
      integration: input.integration, action: input.action, dedupe_key: dedupeKey, status: "pending", external_id: null,
      retry_count: 0, last_error_summary: null, available_at: now, created_at: now, updated_at: now }).executeTakeFirstOrThrow();
    return id;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await db.selectFrom("integration_outbox").select("id").where("dedupe_key", "=", dedupeKey).executeTakeFirstOrThrow();
    return existing.id;
  }
}
