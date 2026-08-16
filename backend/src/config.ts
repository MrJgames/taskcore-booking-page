import "dotenv/config";
import path from "node:path";

export interface SquareConfig {
  environment: "sandbox" | "production";
  accessToken: string;
  applicationId: string;
  locationId: string;
  webhookSignatureKey: string;
  webhookNotificationUrl: string;
}

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
  businessTimezone: string;
  paymentSessionSecret: string;
  bookingHoldMinutes: number;
  paymentSessionMinutes: number;
  square?: SquareConfig;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const databaseUrl = process.env.DATABASE_URL?.trim() || undefined;
  const squareValues = {
    environment: process.env.SQUARE_ENVIRONMENT?.trim(),
    accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
    applicationId: process.env.SQUARE_APPLICATION_ID?.trim(),
    locationId: process.env.SQUARE_LOCATION_ID?.trim(),
    webhookSignatureKey: process.env.SQUARE_WEBHOOK_SIGNATURE_KEY?.trim(),
    webhookNotificationUrl: process.env.SQUARE_WEBHOOK_NOTIFICATION_URL?.trim()
  };
  const squareRequested = Object.values(squareValues).some(Boolean);
  let square: SquareConfig | undefined;
  if (squareRequested) {
    if (squareValues.environment !== "sandbox" && squareValues.environment !== "production") {
      throw new Error("SQUARE_ENVIRONMENT must be sandbox or production when Square is enabled.");
    }
    if (!squareValues.accessToken || !squareValues.applicationId || !squareValues.locationId ||
        !squareValues.webhookSignatureKey || !squareValues.webhookNotificationUrl) {
      throw new Error("All Square environment variables are required when Square is enabled.");
    }
    square = {
      environment: squareValues.environment,
      accessToken: squareValues.accessToken,
      applicationId: squareValues.applicationId,
      locationId: squareValues.locationId,
      webhookSignatureKey: squareValues.webhookSignatureKey,
      webhookNotificationUrl: squareValues.webhookNotificationUrl
    };
  }
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
    businessTimezone: process.env.TASKCORE_TIMEZONE || "America/Los_Angeles",
    paymentSessionSecret: process.env.PAYMENT_SESSION_SECRET || "",
    bookingHoldMinutes: positiveInteger(process.env.BOOKING_HOLD_MINUTES, 15),
    paymentSessionMinutes: positiveInteger(process.env.PAYMENT_SESSION_MINUTES, 10),
    square
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
  if (config.nodeEnv === "production" && config.square?.environment === "sandbox") {
    throw new Error("Square Sandbox configuration cannot run with NODE_ENV=production.");
  }
  if (config.nodeEnv !== "production" && config.square?.environment === "production") {
    throw new Error("Square production configuration cannot run outside NODE_ENV=production.");
  }
  if (config.nodeEnv === "production" && config.paymentSessionSecret.length < 32) {
    throw new Error("PAYMENT_SESSION_SECRET of at least 32 characters is required in production.");
  }
  try { new Intl.DateTimeFormat("en-US", { timeZone: config.businessTimezone }).format(); }
  catch { throw new Error("TASKCORE_TIMEZONE must be a valid IANA timezone."); }
}
