import { afterEach, describe, expect, it, vi } from "vitest";
import { assertProductionConfig, loadConfig } from "./config.js";

const secureAdmin = {
  adminUsername: "jay",
  adminPassword: "test-only-not-a-secret-value"
};

afterEach(() => vi.unstubAllEnvs());

it("selects S3 from MEDIA_STORAGE_MODE without a local fallback", () => {
  vi.stubEnv("MEDIA_STORAGE_MODE", "s3");
  expect(loadConfig().mediaStorageMode).toBe("s3");
});

it("rejects local media and missing remote credentials in production", () => {
  const config = loadConfig({ ...secureAdmin, nodeEnv: "production", databaseUrl: "postgresql://internal-host/taskcore", publicBaseUrl: "https://example.invalid", mediaStorageMode: "local" });
  expect(() => assertProductionConfig(config)).toThrow(/MEDIA_STORAGE_MODE=s3 is required/);
  expect(() => assertProductionConfig({ ...config, mediaStorageMode: "s3", s3AccessKeyId: undefined, s3SecretAccessKey: undefined })).toThrow(/required for S3 media storage/);
});

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
