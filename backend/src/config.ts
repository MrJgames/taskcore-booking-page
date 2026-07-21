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
    trustProxy: process.env.TRUST_PROXY === "true"
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
}
