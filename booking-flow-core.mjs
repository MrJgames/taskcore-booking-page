export function formatMoney(cents, currency = "USD") {
  if (!Number.isSafeInteger(cents)) throw new TypeError("Money must be integer cents.");
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export class PaymentAttemptController {
  constructor(uuid = () => crypto.randomUUID()) { this.uuid = uuid; this.requestId = null; this.processing = false; this.terminal = false; }
  begin() {
    if (this.processing) return null;
    if (!this.requestId || this.terminal) this.requestId = this.uuid();
    this.processing = true; this.terminal = false; return this.requestId;
  }
  interrupted() { this.processing = false; }
  pending() { this.processing = false; }
  declined() { this.processing = false; this.terminal = true; }
  confirmed() { this.processing = false; this.terminal = true; }
}

export function safeCustomerState(state) {
  return ["awaiting_payment", "processing", "failed", "expired", "confirmed"].includes(state) ? state : "processing";
}
