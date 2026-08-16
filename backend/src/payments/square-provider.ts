import { Currency, SquareClient, SquareEnvironment, WebhooksHelper } from "square";
import type { SquareConfig } from "../config.js";
import { PaymentProviderError, type PaymentProvider, type ProviderPaymentResult } from "./provider.js";

export function normalizeSquarePayment(input: {
  id?: string; status?: string; amountMoney?: { amount?: bigint | null; currency?: string };
  refundedMoney?: { amount?: bigint | null };
}): ProviderPaymentResult {
  if (!input.id || input.amountMoney?.amount === undefined || !input.amountMoney.currency) {
    throw new PaymentProviderError("The payment processor returned an incomplete response.", true);
  }
  const amountCents = Number(input.amountMoney.amount);
  const refundedAmountCents = Number(input.refundedMoney?.amount ?? 0n);
  if (!Number.isSafeInteger(amountCents) || !Number.isSafeInteger(refundedAmountCents)) {
    throw new PaymentProviderError("The payment processor returned an unsupported amount.", true);
  }
  let status: ProviderPaymentResult["status"];
  switch (input.status) {
    case "COMPLETED": status = refundedAmountCents >= amountCents ? "refunded" : refundedAmountCents > 0 ? "partially_refunded" : "paid"; break;
    case "APPROVED":
    case "PENDING": status = "pending"; break;
    case "CANCELED":
    case "FAILED": status = "failed"; break;
    default: throw new PaymentProviderError("The payment processor returned an unknown state.", true);
  }
  return { providerPaymentId: input.id, status, amountCents, currency: input.amountMoney.currency, refundedAmountCents };
}

export class SquarePaymentProvider implements PaymentProvider {
  readonly name = "square";
  private readonly client: SquareClient;
  constructor(private readonly config: SquareConfig) {
    this.client = new SquareClient({
      token: config.accessToken,
      environment: config.environment === "sandbox" ? SquareEnvironment.Sandbox : SquareEnvironment.Production,
      maxRetries: 2
    });
  }

  async createPayment(input: Parameters<PaymentProvider["createPayment"]>[0]): Promise<ProviderPaymentResult> {
    try {
      if (input.currency.toUpperCase() !== "USD") throw new PaymentProviderError("Unsupported payment currency.");
      const response = await this.client.payments.create({
        sourceId: input.sourceToken,
        idempotencyKey: input.idempotencyKey,
        amountMoney: { amount: BigInt(input.amountCents), currency: Currency.Usd },
        autocomplete: true,
        locationId: this.config.locationId,
        referenceId: input.referenceId,
        verificationToken: input.verificationToken,
        note: "TaskCore booking deposit"
      });
      if (!response.payment) throw new PaymentProviderError("The payment could not be processed.");
      return normalizeSquarePayment(response.payment);
    } catch (error) {
      if (error instanceof PaymentProviderError) throw error;
      throw new PaymentProviderError("The payment service is temporarily unavailable. Please try again.", true);
    }
  }

  verifyWebhookSignature(rawBody: string, signature: string): Promise<boolean> {
    return WebhooksHelper.verifySignature({
      requestBody: rawBody,
      signatureHeader: signature,
      signatureKey: this.config.webhookSignatureKey,
      notificationUrl: this.config.webhookNotificationUrl
    });
  }
}
