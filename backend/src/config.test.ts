import { describe, expect, it } from "vitest";
import { assertProductionConfig, loadConfig } from "./config.js";

const secureAdmin = {
  adminUsername: "jay",
  adminPassword: "test-only-not-a-secret-value"
};

describe("production database configuration", () => {
  it("accepts PostgreSQL in production", () => {
    const config = loadConfig({
      ...secureAdmin,
      nodeEnv: "production",
      databaseUrl: "postgresql://internal-host/taskcore",
      publicBaseUrl: "https://api.taskcorepros.com",
      mediaStorageMode: "s3",
      s3Bucket: "taskcore-inspections",
      s3AccessKeyId: "test-access-key",
      s3SecretAccessKey: "test-secret-key"
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
