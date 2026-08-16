import type { Kysely } from "kysely";
import { z } from "zod";
import type { DepositConfiguration } from "../domain/money.js";
import { recordPaymentEvent } from "../domain/payments.js";
import type { TaskCoreDatabase } from "../types.js";
import { normalizeSquarePayment } from "./square-provider.js";
import { applyProviderRefundTotal, confirmBookingAfterPaidDeposit, PaymentWorkflowError } from "./workflow.js";

const envelopeSchema = z.object({
  event_id: z.string().min(1),
  type: z.string().min(1),
  data: z.object({ object: z.record(z.unknown()) })
});

function moneyAmount(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return 0;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

async function findLocalPayment(db: Kysely<TaskCoreDatabase>, providerPaymentId: string | undefined, referenceId: string | undefined) {
  if (providerPaymentId) {
    const byProvider = await db.selectFrom("payments").selectAll().where("provider", "=", "square")
      .where("provider_payment_id", "=", providerPaymentId).executeTakeFirst();
    if (byProvider) return byProvider;
  }
  if (referenceId) return db.selectFrom("payments").selectAll().where("id", "=", referenceId).where("provider", "=", "square").executeTakeFirst();
  return undefined;
}

export async function processSquareWebhook(db: Kysely<TaskCoreDatabase>, rawBody: string, depositConfiguration: DepositConfiguration, now = new Date().toISOString()) {
  let envelope: z.infer<typeof envelopeSchema>;
  try { envelope = envelopeSchema.parse(JSON.parse(rawBody)); }
  catch { throw new PaymentWorkflowError("Invalid webhook payload.", 400); }

  const recorded = await recordPaymentEvent(db, { provider: "square", providerEventId: envelope.event_id, eventType: envelope.type }, now);
  const existingEvent = await db.selectFrom("payment_events").selectAll().where("id", "=", recorded.id).executeTakeFirstOrThrow();
  if (!recorded.created && ["processed", "ignored"].includes(existingEvent.processing_status)) {
    return { duplicate: true, status: existingEvent.processing_status };
  }

  try {
    const paymentObject = objectValue(envelope.data.object.payment);
    const refundObject = objectValue(envelope.data.object.refund);
    if (paymentObject) {
      const amountMoney = objectValue(paymentObject.amount_money);
      const refundedMoney = objectValue(paymentObject.refunded_money);
      const providerPaymentId = typeof paymentObject.id === "string" ? paymentObject.id : undefined;
      const referenceId = typeof paymentObject.reference_id === "string" ? paymentObject.reference_id : undefined;
      const local = await findLocalPayment(db, providerPaymentId, referenceId);
      if (!local || !providerPaymentId || !amountMoney) {
        await db.updateTable("payment_events").set({ processing_status: "ignored", processed_at: now, updated_at: now }).where("id", "=", recorded.id).execute();
        return { duplicate: false, status: "ignored" as const };
      }
      await db.updateTable("payment_events").set({ payment_id: local.id, updated_at: now }).where("id", "=", recorded.id).execute();
      const normalized = normalizeSquarePayment({ id: providerPaymentId,
        status: typeof paymentObject.status === "string" ? paymentObject.status : undefined,
        amountMoney: { amount: BigInt(moneyAmount(amountMoney.amount)), currency: typeof amountMoney.currency === "string" ? amountMoney.currency : undefined },
        refundedMoney: { amount: BigInt(moneyAmount(refundedMoney?.amount)) } });
      if (normalized.status === "paid") {
        await confirmBookingAfterPaidDeposit(db, { paymentId: local.id, providerPaymentId,
          providerAmountCents: normalized.amountCents, currency: normalized.currency, depositConfiguration, now });
      } else if (normalized.status === "failed" && local.status === "pending") {
        await db.updateTable("payments").set({ provider_payment_id: providerPaymentId, status: "failed", updated_at: now }).where("id", "=", local.id).execute();
      } else if (normalized.status === "pending") {
        await db.updateTable("payments").set({ provider_payment_id: providerPaymentId, updated_at: now }).where("id", "=", local.id).execute();
      } else if (normalized.status === "partially_refunded" || normalized.status === "refunded") {
        await applyProviderRefundTotal(db, local.id, normalized.refundedAmountCents, now);
      }
    } else if (refundObject) {
      const providerPaymentId = typeof refundObject.payment_id === "string" ? refundObject.payment_id : undefined;
      const refundStatus = typeof refundObject.status === "string" ? refundObject.status : undefined;
      const amountMoney = objectValue(refundObject.amount_money);
      const local = await findLocalPayment(db, providerPaymentId, undefined);
      if (!local || !amountMoney || refundStatus !== "COMPLETED") {
        await db.updateTable("payment_events").set({ processing_status: "ignored", processed_at: now, updated_at: now }).where("id", "=", recorded.id).execute();
        return { duplicate: false, status: "ignored" as const };
      }
      await db.updateTable("payment_events").set({ payment_id: local.id, updated_at: now }).where("id", "=", recorded.id).execute();
      await applyProviderRefundTotal(db, local.id, local.refunded_amount_cents + moneyAmount(amountMoney.amount), now);
    } else {
      await db.updateTable("payment_events").set({ processing_status: "ignored", processed_at: now, updated_at: now }).where("id", "=", recorded.id).execute();
      return { duplicate: false, status: "ignored" as const };
    }
    await db.updateTable("payment_events").set({ processing_status: "processed", processed_at: now, error_summary: null, updated_at: now }).where("id", "=", recorded.id).execute();
    return { duplicate: false, status: "processed" as const };
  } catch (error) {
    await db.updateTable("payment_events").set({ processing_status: "failed",
      error_summary: error instanceof Error ? error.message.slice(0, 500) : "Webhook processing failed.", updated_at: now }).where("id", "=", recorded.id).execute();
    throw error;
  }
}
