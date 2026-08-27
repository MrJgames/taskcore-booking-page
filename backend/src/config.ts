import "dotenv/config";
import path from "node:path";

export interface AppConfig {
  port: number;
  nodeEnv: string;
  databaseUrl?: string;
  sqlitePath: string;
  adminUsername: string;
  adminPassword: string;
  corsOrigins: string[];
  rateLimitWindowMs: number;
  rateLimitMax: number;
  bodyLimit: string;
  trustProxy: boolean;
  uploadDirectory: string;
  maxPhotoBytes: number;
  maxVideoBytes: number;
  publicBaseUrl: string;
  reportTokenDays: number;
  ownerMobileNumber?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioFromNumber?: string;
  resendApiKey?: string;
  reportFromEmail?: string;
  mediaStorageMode: "local" | "s3";
  s3Endpoint?: string;
  s3Region: string;
  s3Bucket?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3ForcePathStyle: boolean;
  technicianIdleSessionMs: number;
  technicianAbsoluteSessionMs: number;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const databaseUrl = process.env.DATABASE_URL?.trim() || undefined;
  const config: AppConfig = {
    port: positiveInteger(process.env.PORT, 3000),
    nodeEnv: process.env.NODE_ENV || "development",
    databaseUrl,
    sqlitePath: path.resolve(process.cwd(), process.env.SQLITE_PATH || "./data/taskcore.db"),
    adminUsername: process.env.ADMIN_USERNAME || "",
    adminPassword: process.env.ADMIN_PASSWORD || "",
    corsOrigins: (process.env.CORS_ORIGINS || "http://localhost:8000,https://mrjgames.github.io")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    rateLimitWindowMs: positiveInteger(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    rateLimitMax: positiveInteger(process.env.RATE_LIMIT_MAX, 5),
    bodyLimit: process.env.BODY_LIMIT || "32kb",
    trustProxy: process.env.TRUST_PROXY === "true",
    uploadDirectory: path.resolve(process.cwd(), process.env.UPLOAD_DIRECTORY || "./data/inspection-media"),
    maxPhotoBytes: positiveInteger(process.env.MAX_PHOTO_BYTES, 15 * 1024 * 1024),
    maxVideoBytes: positiveInteger(process.env.MAX_VIDEO_BYTES, 250 * 1024 * 1024),
    publicBaseUrl: (process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/$/, ""),
    reportTokenDays: positiveInteger(process.env.REPORT_TOKEN_DAYS, 30),
    ownerMobileNumber: process.env.OWNER_MOBILE_NUMBER?.trim() || undefined,
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID?.trim() || undefined,
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN?.trim() || undefined,
    twilioFromNumber: process.env.TWILIO_FROM_NUMBER?.trim() || undefined,
    resendApiKey: process.env.RESEND_API_KEY?.trim() || undefined,
    reportFromEmail: process.env.REPORT_FROM_EMAIL?.trim() || undefined,
    mediaStorageMode: process.env.MEDIA_STORAGE_MODE === "s3" ? "s3" : "local",
    s3Endpoint: process.env.S3_ENDPOINT?.trim() || undefined,
    s3Region: process.env.S3_REGION?.trim() || "auto",
    s3Bucket: process.env.S3_BUCKET?.trim() || undefined,
    s3AccessKeyId: process.env.S3_ACCESS_KEY_ID?.trim() || undefined,
    s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY?.trim() || undefined,
    s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    technicianIdleSessionMs: positiveInteger(process.env.TECHNICIAN_IDLE_SESSION_MS, 50 * 60 * 1000),
    technicianAbsoluteSessionMs: positiveInteger(process.env.TECHNICIAN_ABSOLUTE_SESSION_MS, 12 * 60 * 60 * 1000)
  };
  return { ...config, ...overrides };
}

export function assertProductionConfig(config: AppConfig): void {
  if (!config.adminUsername || config.adminPassword.length < 16 || config.adminPassword === "replace-with-a-long-random-password") {
    throw new Error("ADMIN_USERNAME and an ADMIN_PASSWORD of at least 16 characters are required.");
  }
  if (config.databaseUrl && !/^postgres(?:ql)?:\/\//i.test(config.databaseUrl)) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection string.");
  }
  if (config.nodeEnv === "production" && !config.databaseUrl) {
    throw new Error("DATABASE_URL is required in production. SQLite is for local development only.");
  }
  if (config.nodeEnv === "production" && !config.publicBaseUrl.startsWith("https://")) {
    throw new Error("PUBLIC_BASE_URL must use HTTPS in production.");
  }
  if (config.nodeEnv === "production" && config.mediaStorageMode !== "s3") {
    throw new Error("MEDIA_STORAGE_MODE=s3 is required in production so inspection evidence is durable.");
  }
  if (config.mediaStorageMode === "s3" && (!config.s3Bucket || !config.s3AccessKeyId || !config.s3SecretAccessKey)) {
    throw new Error("S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY are required for S3 media storage.");
  }
}
