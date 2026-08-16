export type NormalizedProviderPaymentStatus = "pending" | "paid" | "failed" | "refunded" | "partially_refunded";

export interface CreateProviderPaymentInput {
  sourceToken: string;
  idempotencyKey: string;
  amountCents: number;
  currency: string;
  referenceId: string;
  verificationToken?: string;
}

export interface ProviderPaymentResult {
  providerPaymentId: string;
  status: NormalizedProviderPaymentStatus;
  amountCents: number;
  currency: string;
  refundedAmountCents: number;
}

export interface PaymentProvider {
  readonly name: string;
  createPayment(input: CreateProviderPaymentInput): Promise<ProviderPaymentResult>;
  verifyWebhookSignature(rawBody: string, signature: string): Promise<boolean>;
}

export class PaymentProviderError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.retryable = retryable;
  }
}
