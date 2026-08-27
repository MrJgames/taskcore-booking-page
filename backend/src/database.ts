import fs from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { Kysely, PostgresDialect, SqliteDialect } from "kysely";
import { Pool } from "pg";
import type { AppConfig } from "./config.js";
import type { TaskCoreDatabase } from "./types.js";

export function createDatabase(config: AppConfig): Kysely<TaskCoreDatabase> {
  if (config.databaseUrl) {
    return new Kysely<TaskCoreDatabase>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: config.databaseUrl }) })
    });
  }

  if (config.sqlitePath !== ":memory:") {
    fs.mkdirSync(path.dirname(config.sqlitePath), { recursive: true });
  }
  const sqlite = new BetterSqlite3(config.sqlitePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return new Kysely<TaskCoreDatabase>({ dialect: new SqliteDialect({ database: sqlite }) });
}

export async function initializeDatabase(db: Kysely<TaskCoreDatabase>): Promise<void> {
  await db.schema
    .createTable("service_requests")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (column) => column.primaryKey())
    .addColumn("created_at", "varchar(30)", (column) => column.notNull())
    .addColumn("customer_name", "varchar(100)", (column) => column.notNull())
    .addColumn("phone", "varchar(30)", (column) => column.notNull())
    .addColumn("email", "varchar(254)")
    .addColumn("service_address", "varchar(250)", (column) => column.notNull())
    .addColumn("issue_description", "text", (column) => column.notNull())
    .addColumn("preferred_contact_method", "varchar(10)", (column) => column.notNull())
    .addColumn("preferred_service_date", "varchar(10)", (column) => column.notNull())
    .addColumn("requested_arrival_window", "varchar(30)", (column) => column.notNull())
    .addColumn("submitted_at", "varchar(30)", (column) => column.notNull())
    .addColumn("status", "varchar(20)", (column) => column.notNull().defaultTo("New"))
    .addColumn("private_note", "text")
    .addColumn("updated_at", "varchar(30)", (column) => column.notNull())
    .execute();

  await db.schema
    .createIndex("service_requests_status_created_idx")
    .ifNotExists()
    .on("service_requests")
    .columns(["status", "created_at"])
    .execute();

  await db.schema.createTable("clients").ifNotExists()
    .addColumn("id", "varchar(36)", (column) => column.primaryKey())
    .addColumn("company_name", "varchar(140)", (column) => column.notNull())
    .addColumn("contact_name", "varchar(100)", (column) => column.notNull())
    .addColumn("email", "varchar(254)", (column) => column.notNull())
    .addColumn("phone", "varchar(30)")
    .addColumn("created_at", "varchar(30)", (column) => column.notNull())
    .execute();

  await db.schema.createTable("properties").ifNotExists()
    .addColumn("id", "varchar(36)", (column) => column.primaryKey())
    .addColumn("client_id", "varchar(36)", (column) => column.notNull().references("clients.id"))
    .addColumn("name", "varchar(140)", (column) => column.notNull())
    .addColumn("address", "varchar(250)", (column) => column.notNull())
    .addColumn("active", "integer", (column) => column.notNull().defaultTo(1))
    .addColumn("created_at", "varchar(30)", (column) => column.notNull())
    .execute();

  await db.schema.createTable("technicians").ifNotExists()
    .addColumn("id", "varchar(36)", (column) => column.primaryKey())
    .addColumn("name", "varchar(100)", (column) => column.notNull())
    .addColumn("email", "varchar(254)", (column) => column.notNull().unique())
    .addColumn("password_hash", "varchar(300)", (column) => column.notNull())
    .addColumn("active", "integer", (column) => column.notNull().defaultTo(1))
    .addColumn("created_at", "varchar(30)", (column) => column.notNull())
    .execute();

  await db.schema.createTable("technician_sessions").ifNotExists()
    .addColumn("id", "varchar(36)", (column) => column.primaryKey())
    .addColumn("technician_id", "varchar(36)", (column) => column.notNull().references("technicians.id"))
    .addColumn("token_hash", "varchar(64)", (column) => column.notNull().unique())
    .addColumn("expires_at", "varchar(30)", (column) => column.notNull())
    .addColumn("created_at", "varchar(30)", (column) => column.notNull())
    .execute();

  await db.schema.createTable("inspections").ifNotExists()
    .addColumn("id", "varchar(36)", (column) => column.primaryKey())
    .addColumn("property_id", "varchar(36)", (column) => column.notNull().references("properties.id"))
    .addColumn("technician_id", "varchar(36)", (column) => column.notNull().references("technicians.id"))
    .addColumn("inspection_type", "varchar(40)", (column) => column.notNull())
    .addColumn("status", "varchar(20)", (column) => column.notNull().defaultTo("Draft"))
    .addColumn("checklist_json", "text", (column) => column.notNull().defaultTo("[]"))
    .addColumn("summary", "text", (column) => column.notNull().defaultTo(""))
    .addColumn("review_note", "text", (column) => column.notNull().defaultTo(""))
    .addColumn("submitted_at", "varchar(30)")
    .addColumn("reviewed_at", "varchar(30)")
    .addColumn("published_at", "varchar(30)")
    .addColumn("report_token_hash", "varchar(64)")
    .addColumn("report_expires_at", "varchar(30)")
    .addColumn("created_at", "varchar(30)", (column) => column.notNull())
    .addColumn("updated_at", "varchar(30)", (column) => column.notNull())
    .execute();

  await db.schema.createTable("inspection_media").ifNotExists()
    .addColumn("id", "varchar(36)", (column) => column.primaryKey())
    .addColumn("inspection_id", "varchar(36)", (column) => column.notNull().references("inspections.id"))
    .addColumn("kind", "varchar(20)", (column) => column.notNull())
    .addColumn("category", "varchar(60)", (column) => column.notNull())
    .addColumn("caption", "varchar(240)", (column) => column.notNull().defaultTo(""))
    .addColumn("storage_key", "varchar(160)", (column) => column.notNull())
    .addColumn("file_name", "varchar(180)", (column) => column.notNull())
    .addColumn("mime_type", "varchar(100)", (column) => column.notNull())
    .addColumn("size_bytes", "integer", (column) => column.notNull())
    .addColumn("created_at", "varchar(30)", (column) => column.notNull())
    .execute();

  await db.schema.createTable("inspection_findings").ifNotExists()
    .addColumn("id", "varchar(36)", (column) => column.primaryKey())
    .addColumn("inspection_id", "varchar(36)", (column) => column.notNull().references("inspections.id"))
    .addColumn("title", "varchar(160)", (column) => column.notNull())
    .addColumn("details", "text", (column) => column.notNull())
    .addColumn("priority", "varchar(20)", (column) => column.notNull())
    .addColumn("requires_approval", "integer", (column) => column.notNull().defaultTo(1))
    .addColumn("quote_description", "text", (column) => column.notNull().defaultTo(""))
    .addColumn("quote_amount_cents", "integer")
    .addColumn("decision", "varchar(20)", (column) => column.notNull().defaultTo("Pending"))
    .addColumn("client_comment", "text", (column) => column.notNull().defaultTo(""))
    .addColumn("decided_at", "varchar(30)")
    .addColumn("created_at", "varchar(30)", (column) => column.notNull())
    .addColumn("updated_at", "varchar(30)", (column) => column.notNull())
    .execute();

  await db.schema.createTable("notifications").ifNotExists()
    .addColumn("id", "varchar(36)", (column) => column.primaryKey())
    .addColumn("inspection_id", "varchar(36)", (column) => column.notNull().references("inspections.id"))
    .addColumn("message", "varchar(300)", (column) => column.notNull())
    .addColumn("delivery_status", "varchar(40)", (column) => column.notNull())
    .addColumn("read_at", "varchar(30)")
    .addColumn("created_at", "varchar(30)", (column) => column.notNull())
    .execute();

  await db.schema.createTable("inspection_decision_events").ifNotExists()
    .addColumn("id", "varchar(36)", (column) => column.primaryKey())
    .addColumn("finding_id", "varchar(36)", (column) => column.notNull().references("inspection_findings.id"))
    .addColumn("decision", "varchar(20)", (column) => column.notNull())
    .addColumn("client_comment", "text", (column) => column.notNull().defaultTo(""))
    .addColumn("created_at", "varchar(30)", (column) => column.notNull())
    .execute();

  await db.schema.createTable("property_audit_events").ifNotExists()
    .addColumn("id", "varchar(36)", (column) => column.primaryKey())
    .addColumn("property_id", "varchar(36)", (column) => column.notNull().references("properties.id"))
    .addColumn("actor_type", "varchar(20)", (column) => column.notNull())
    .addColumn("actor_id", "varchar(100)", (column) => column.notNull())
    .addColumn("action", "varchar(20)", (column) => column.notNull())
    .addColumn("details_json", "text", (column) => column.notNull().defaultTo("{}"))
    .addColumn("created_at", "varchar(30)", (column) => column.notNull())
    .execute();

  await db.schema.createTable("property_notifications").ifNotExists()
    .addColumn("id", "varchar(36)", (column) => column.primaryKey())
    .addColumn("property_id", "varchar(36)", (column) => column.notNull().references("properties.id"))
    .addColumn("message", "varchar(300)", (column) => column.notNull())
    .addColumn("delivery_status", "varchar(40)", (column) => column.notNull())
    .addColumn("read_at", "varchar(30)")
    .addColumn("created_at", "varchar(30)", (column) => column.notNull())
    .execute();

  for (const [name, table, columns] of [
    ["properties_client_idx", "properties", ["client_id"]],
    ["tech_sessions_token_idx", "technician_sessions", ["token_hash", "expires_at"]],
    ["inspections_status_idx", "inspections", ["status", "updated_at"]],
    ["inspection_media_inspection_idx", "inspection_media", ["inspection_id"]],
    ["inspection_findings_inspection_idx", "inspection_findings", ["inspection_id"]],
    ["notifications_read_idx", "notifications", ["read_at", "created_at"]],
    ["inspection_decisions_finding_idx", "inspection_decision_events", ["finding_id", "created_at"]],
    ["property_audit_property_idx", "property_audit_events", ["property_id", "created_at"]],
    ["property_notifications_read_idx", "property_notifications", ["read_at", "created_at"]]
  ] as const) {
    await db.schema.createIndex(name).ifNotExists().on(table).columns([...columns]).execute();
  }
}
