import { describe, expect, it } from "vitest";
import { assertProductionConfig, loadConfig } from "./config.js";

const secureAdmin = {
  adminUsername: "jay",
  adminPassword: "test-only-not-a-secret-value",
  paymentSessionSecret: "test-payment-session-secret-32-characters"
};

describe("production database configuration", () => {
  it("accepts PostgreSQL in production", () => {
    const config = loadConfig({
      ...secureAdmin,
      nodeEnv: "production",
      databaseUrl: "postgresql://internal-host/taskcore"
    });
    expect(() => assertProductionConfig(config)).not.toThrow();
  });

  it("rejects SQLite fallback in production", () => {
    const config = loadConfig({ ...secureAdmin, nodeEnv: "production", databaseUrl: undefined });
    expect(() => assertProductionConfig(config)).toThrow(/DATABASE_URL is required in production/);
  });

  it("rejects a non-PostgreSQL DATABASE_URL", () => {
    const config = loadConfig({ ...secureAdmin, nodeEnv: "production", databaseUrl: "sqlite://taskcore.db" });
    expect(() => assertProductionConfig(config)).toThrow(/PostgreSQL connection string/);
  });
});

describe("Square environment boundaries", () => {
  const square = {
    environment: "sandbox" as const,
    accessToken: "sandbox-token-placeholder",
    applicationId: "sandbox-app-placeholder",
    locationId: "sandbox-location-placeholder",
    webhookSignatureKey: "sandbox-signature-placeholder",
    webhookNotificationUrl: "https://example.test/api/webhooks/square"
  };

  it("allows Square Sandbox in local development", () => {
    const config = loadConfig({ ...secureAdmin, nodeEnv: "development", square });
    expect(() => assertProductionConfig(config)).not.toThrow();
  });

  it("rejects Square Sandbox when NODE_ENV is production", () => {
    const config = loadConfig({ ...secureAdmin, nodeEnv: "production", databaseUrl: "postgresql://internal-host/taskcore", square });
    expect(() => assertProductionConfig(config)).toThrow(/Sandbox configuration cannot run/);
  });

  it("rejects Square production configuration outside production", () => {
    const config = loadConfig({ ...secureAdmin, nodeEnv: "development", square: { ...square, environment: "production" } });
    expect(() => assertProductionConfig(config)).toThrow(/production configuration cannot run/);
  });
});
