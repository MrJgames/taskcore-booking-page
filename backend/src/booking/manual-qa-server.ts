import path from "node:path";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { createDatabase, initializeDatabase } from "../database.js";
import { PaymentProviderError, type CreateProviderPaymentInput, type PaymentProvider } from "../payments/provider.js";

// Local visual QA only. It uses an in-memory database and never contacts Square.
class ManualQaProvider implements PaymentProvider {
  readonly name = "square";
  async createPayment(input: CreateProviderPaymentInput) {
    if (input.sourceToken === "mock-network") throw new PaymentProviderError("Mocked network interruption.", true);
    const failed = input.sourceToken === "mock-decline";
    return { providerPaymentId: `manual-${input.idempotencyKey}`, status: failed ? "failed" as const : "paid" as const,
      amountCents: input.amountCents, currency: input.currency, refundedAmountCents: 0 };
  }
  async verifyWebhookSignature() { return false; }
}

const config = loadConfig({ port: 8000, nodeEnv: "test", sqlitePath: ":memory:", adminUsername: "manual-qa",
  adminPassword: "manual-qa-password-not-for-production", paymentSessionSecret: "manual-qa-session-secret-never-production",
  corsOrigins: ["http://127.0.0.1:8000", "http://localhost:8000"], rateLimitMax: 100,
  square: { environment: "sandbox", accessToken: "manual-qa-only", applicationId: "manual-qa-app", locationId: "manual-qa-location",
    webhookSignatureKey: "manual-qa-only", webhookNotificationUrl: "http://127.0.0.1:8000/api/webhooks/square" } });
const db = createDatabase(config); await initializeDatabase(db);
const customerDirectory = path.resolve(process.cwd(), "..");
const server = createApp(config, db, { paymentProvider: new ManualQaProvider(), customerDirectory }).listen(config.port, "127.0.0.1", () => {
  console.log("TaskCore mocked booking QA available at http://127.0.0.1:8000/?mockSquare=success#book");
});
async function close() { server.close(async () => { await db.destroy(); process.exit(0); }); }
process.on("SIGINT", close); process.on("SIGTERM", close);
