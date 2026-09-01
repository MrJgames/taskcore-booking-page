import fs from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { Kysely, PostgresDialect, SqliteDialect } from "kysely";
import { Pool } from "pg";
import type { AppConfig } from "./config.js";
import {
  PENDING_PROPERTY_ASSIGNMENT,
  SYSTEM_UNASSIGNED_CLIENT_ID,
  type TaskCoreDatabase,
} from "./types.js";

export function createDatabase(config: AppConfig): Kysely<TaskCoreDatabase> {
  if (config.databaseUrl) {
    return new Kysely<TaskCoreDatabase>({
      dialect: new PostgresDialect({
        pool: new Pool({ connectionString: config.databaseUrl }),
      }),
    });
  }

  if (config.sqlitePath !== ":memory:") {
    fs.mkdirSync(path.dirname(config.sqlitePath), { recursive: true });
  }
  const sqlite = new BetterSqlite3(config.sqlitePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return new Kysely<TaskCoreDatabase>({
    dialect: new SqliteDialect({ database: sqlite }),
  });
}

export async function initializeDatabase(
  db: Kysely<TaskCoreDatabase>,
): Promise<void> {
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
    .addColumn("preferred_contact_method", "varchar(10)", (column) =>
      column.notNull(),
    )
    .addColumn("preferred_service_date", "varchar(10)", (column) =>
      column.notNull(),
    )
    .addColumn("requested_arrival_window", "varchar(30)", (column) =>
      column.notNull(),
    )
    .addColumn("submitted_at", "varchar(30)", (column) => column.notNull())
    .addColumn("status", "varchar(20)", (column) =>
      column.notNull().defaultTo("New"),
    )
    .addColumn("private_note", "text")
    .addColumn("updated_at", "varchar(30)", (column) => column.notNull())
    .execute();

  await db.schema
    .createIndex("service_requests_status_created_idx")
    .ifNotExists()
    .on("service_requests")
    .columns(["status", "created_at"])
    .execute();

  await db.schema
    .createTable("clients")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (column) => column.primaryKey())
    .addColumn("company_name", "varchar(140)", (column) => column.notNull())
    .addColumn("contact_name", "varchar(100)", (column) => column.notNull())
    .addColumn("email", "varchar(254)", (column) => column.notNull())
    .addColumn("phone", "varchar(30)")
    .addColumn("created_at", "varchar(30)", (column) => column.notNull())
    .execute();

  await db.schema
    .createTable("properties")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (column) => column.primaryKey())
    .addColumn("client_id", "varchar(36)", (column) =>
      column.notNull().references("clients.id"),
    )
    .addColumn("name", "varchar(140)", (column) => column.notNull())
    .addColumn("address", "varchar(250)", (column) => column.notNull())
    .addColumn("active", "integer", (column) => column.notNull().defaultTo(1))
    .addColumn("created_at", "varchar(30)", (column) => column.notNull())
    .execute();

  await db.schema
    .createTable("technicians")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (column) => column.primaryKey())
    .addColumn("name", "varchar(100)", (column) => column.notNull())
    .addColumn("email", "varchar(254)", (column) => column.notNull().unique())
    .addColumn("password_hash", "varchar(300)", (column) => column.notNull())
    .addColumn("active", "integer", (column) => column.notNull().defaultTo(1))
    .addColumn("created_at", "varchar(30)", (column) => column.notNull())
    .execute();

  await db.schema
    .createTable("technician_sessions")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (column) => column.primaryKey())
    .addColumn("technician_id", "varchar(36)", (column) =>
      column.notNull().references("technicians.id"),
    )
    .addColumn("token_hash", "varchar(64)", (column) =>
      column.notNull().unique(),
    )
    .addColumn("expires_at", "varchar(30)", (column) => column.notNull())
    .addColumn("created_at", "varchar(30)", (column) => column.notNull())
    .execute();

  await db.schema
    .createTable("inspections")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (column) => column.primaryKey())
    .addColumn("property_id", "varchar(36)", (column) =>
      column.notNull().references("properties.id"),
    )
    .addColumn("technician_id", "varchar(36)", (column) =>
      column.notNull().references("technicians.id"),
    )
    .addColumn("inspection_type", "varchar(40)", (column) => column.notNull())
    .addColumn("status", "varchar(20)", (column) =>
      column.notNull().defaultTo("Draft"),
    )
    .addColumn("checklist_json", "text", (column) =>
      column.notNull().defaultTo("[]"),
    )
    .addColumn("summary", "text", (column) => column.notNull().defaultTo(""))
    .addColumn("review_note", "text", (column) =>
      column.notNull().defaultTo(""),
    )
    .addColumn("submitted_at", "varchar(30)")
    .addColumn("reviewed_at", "varchar(30)")
    .addColumn("published_at", "varchar(30)")
    .addColumn("report_token_hash", "varchar(64)")
    .addColumn("report_expires_at", "varchar(30)")
    .addColumn("created_at", "varchar(30)", (column) => column.notNull())
    .addColumn("updated_at", "varchar(30)", (column) => column.notNull())
    .execute();

  await db.schema
    .createTable("inspection_media")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (column) => column.primaryKey())
    .addColumn("inspection_id", "varchar(36)", (column) =>
      column.notNull().references("inspections.id"),
    )
    .addColumn("kind", "varchar(20)", (column) => column.notNull())
    .addColumn("category", "varchar(60)", (column) => column.notNull())
    .addColumn("caption", "varchar(240)", (column) =>
      column.notNull().defaultTo(""),
    )
    .addColumn("storage_key", "varchar(160)", (column) => column.notNull())
    .addColumn("file_name", "varchar(180)", (column) => column.notNull())
    .addColumn("mime_type", "varchar(100)", (column) => column.notNull())
    .addColumn("size_bytes", "integer", (column) => column.notNull())
    .addColumn("created_at", "varchar(30)", (column) => column.notNull())
    .execute();

  await db.schema
    .createTable("inspection_findings")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (column) => column.primaryKey())
    .addColumn("inspection_id", "varchar(36)", (column) =>
      column.notNull().references("inspections.id"),
    )
    .addColumn("title", "varchar(160)", (column) => column.notNull())
    .addColumn("details", "text", (column) => column.notNull())
    .addColumn("priority", "varchar(20)", (column) => column.notNull())
    .addColumn("requires_approval", "integer", (column) =>
      column.notNull().defaultTo(1),
    )
    .addColumn("quote_description", "text", (column) =>
      column.notNull().defaultTo(""),
    )
    .addColumn("quote_amount_cents", "integer")
    .addColumn("decision", "varchar(20)", (column) =>
      column.notNull().defaultTo("Pending"),
    )
    .addColumn("client_comment", "text", (column) =>
      column.notNull().defaultTo(""),
    )
    .addColumn("decided_at", "varchar(30)")
    .addColumn("created_at", "varchar(30)", (column) => column.notNull())
    .addColumn("updated_at", "varchar(30)", (column) => column.notNull())
    .execute();

  await db.schema
    .createTable("notifications")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (column) => column.primaryKey())
    .addColumn("inspection_id", "varchar(36)", (column) =>
      column.notNull().references("inspections.id"),
    )
    .addColumn("message", "varchar(300)", (column) => column.notNull())
    .addColumn("delivery_status", "varchar(40)", (column) => column.notNull())
    .addColumn("read_at", "varchar(30)")
    .addColumn("created_at", "varchar(30)", (column) => column.notNull())
    .execute();

  await db.schema
    .createTable("inspection_decision_events")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (column) => column.primaryKey())
    .addColumn("finding_id", "varchar(36)", (column) =>
      column.notNull().references("inspection_findings.id"),
    )
    .addColumn("decision", "varchar(20)", (column) => column.notNull())
    .addColumn("client_comment", "text", (column) =>
      column.notNull().defaultTo(""),
    )
    .addColumn("created_at", "varchar(30)", (column) => column.notNull())
    .execute();

  await db
    .insertInto("clients")
    .values({
      id: SYSTEM_UNASSIGNED_CLIENT_ID,
      company_name: "Unassigned / Owner Review",
      contact_name: "System record — not a customer",
      email: "unassigned@invalid.taskcore.local",
      phone: null,
      created_at: new Date().toISOString(),
    })
    .onConflict((conflict) => conflict.column("id").doNothing())
    .execute();

  await db.schema
    .createTable("technician_activity_events")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (column) => column.primaryKey())
    .addColumn("technician_id", "varchar(36)", (column) =>
      column.notNull().references("technicians.id"),
    )
    .addColumn("inspection_id", "varchar(36)")
    .addColumn("event_type", "varchar(60)", (column) => column.notNull())
    .addColumn("created_at", "varchar(30)", (column) => column.notNull())
    .execute();

  await db.schema
    .createTable("technician_operations")
    .ifNotExists()
    .addColumn("id", "varchar(100)", (column) => column.primaryKey())
    .addColumn("technician_id", "varchar(36)", (column) =>
      column.notNull().references("technicians.id"),
    )
    .addColumn("inspection_id", "varchar(36)")
    .addColumn("operation_type", "varchar(40)", (column) => column.notNull())
    .addColumn("response_json", "text", (column) =>
      column.notNull().defaultTo("{}"),
    )
    .addColumn("created_at", "varchar(30)", (column) => column.notNull())
    .execute();

  await db.schema
    .createTable("inspection_media_links")
    .ifNotExists()
    .addColumn("media_id", "varchar(36)", (column) =>
      column.primaryKey().references("inspection_media.id").onDelete("cascade"),
    )
    .addColumn("question_key", "varchar(80)")
    .addColumn("finding_id", "varchar(36)", (column) =>
      column.references("inspection_findings.id").onDelete("set null"),
    )
    .execute();

  await db.schema
    .createTable("maintenance_finding_details")
    .ifNotExists()
    .addColumn("finding_id", "varchar(36)", (column) =>
      column
        .primaryKey()
        .references("inspection_findings.id")
        .onDelete("cascade"),
    )
    .addColumn("category", "varchar(80)", (column) =>
      column.notNull().defaultTo("General"),
    )
    .addColumn("immediate_safety_actions", "text", (column) =>
      column.notNull().defaultTo(""),
    )
    .addColumn("recommended_next_steps", "text", (column) =>
      column.notNull().defaultTo(""),
    )
    .addColumn("materials_needed", "text", (column) =>
      column.notNull().defaultTo(""),
    )
    .addColumn("review_status", "varchar(40)", (column) =>
      column.notNull().defaultTo("Pending owner review"),
    )
    .execute();

  await db.schema
    .createTable("maintenance_finding_events")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (column) => column.primaryKey())
    .addColumn("finding_id", "varchar(36)", (column) => column.notNull())
    .addColumn("actor_type", "varchar(20)", (column) => column.notNull())
    .addColumn("action", "varchar(60)", (column) => column.notNull())
    .addColumn("snapshot_json", "text", (column) => column.notNull())
    .addColumn("created_at", "varchar(30)", (column) => column.notNull())
    .execute();

  await db.schema
    .createTable("property_audit_events")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (column) => column.primaryKey())
    .addColumn("property_id", "varchar(36)", (column) =>
      column.notNull().references("properties.id"),
    )
    .addColumn("actor_type", "varchar(20)", (column) => column.notNull())
    .addColumn("actor_id", "varchar(100)", (column) => column.notNull())
    .addColumn("action", "varchar(20)", (column) => column.notNull())
    .addColumn("details_json", "text", (column) =>
      column.notNull().defaultTo("{}"),
    )
    .addColumn("created_at", "varchar(30)", (column) => column.notNull())
    .execute();

  await db.schema
    .createTable("property_notifications")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (column) => column.primaryKey())
    .addColumn("property_id", "varchar(36)", (column) =>
      column.notNull().references("properties.id"),
    )
    .addColumn("message", "varchar(300)", (column) => column.notNull())
    .addColumn("delivery_status", "varchar(40)", (column) => column.notNull())
    .addColumn("read_at", "varchar(30)")
    .addColumn("created_at", "varchar(30)", (column) => column.notNull())
    .execute();

  await db.schema
    .createTable("property_assignment_status")
    .ifNotExists()
    .addColumn("property_id", "varchar(36)", (column) =>
      column.primaryKey().references("properties.id").onDelete("cascade"),
    )
    .addColumn("status", "varchar(40)", (column) =>
      column.notNull().defaultTo(PENDING_PROPERTY_ASSIGNMENT),
    )
    .addColumn("created_by_technician_id", "varchar(36)", (column) =>
      column.notNull().references("technicians.id"),
    )
    .addColumn("inspection_id", "varchar(36)", (column) =>
      column.notNull().references("inspections.id"),
    )
    .addColumn("created_at", "varchar(30)", (column) => column.notNull())
    .execute();

  await db.schema
    .createTable("organizations")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (c) => c.primaryKey())
    .addColumn("client_id", "varchar(36)", (c) =>
      c.notNull().unique().references("clients.id"),
    )
    .addColumn("name", "varchar(140)", (c) => c.notNull())
    .addColumn("active", "integer", (c) => c.notNull().defaultTo(1))
    .addColumn("created_at", "varchar(30)", (c) => c.notNull())
    .addColumn("updated_at", "varchar(30)", (c) => c.notNull())
    .execute();
  await db.schema
    .createTable("organization_users")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (c) => c.primaryKey())
    .addColumn("organization_id", "varchar(36)", (c) =>
      c.notNull().references("organizations.id"),
    )
    .addColumn("role", "varchar(30)", (c) => c.notNull())
    .addColumn("name", "varchar(100)", (c) => c.notNull())
    .addColumn("email", "varchar(254)", (c) => c.notNull().unique())
    .addColumn("password_hash", "varchar(300)", (c) => c.notNull())
    .addColumn("active", "integer", (c) => c.notNull().defaultTo(1))
    .addColumn("created_at", "varchar(30)", (c) => c.notNull())
    .addColumn("updated_at", "varchar(30)", (c) => c.notNull())
    .execute();
  await db.schema
    .createTable("vendors")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (c) => c.primaryKey())
    .addColumn("business_name", "varchar(140)", (c) => c.notNull())
    .addColumn("contact_name", "varchar(100)", (c) => c.notNull())
    .addColumn("email", "varchar(254)", (c) => c.notNull().unique())
    .addColumn("phone", "varchar(30)")
    .addColumn("password_hash", "varchar(300)", (c) => c.notNull())
    .addColumn("status", "varchar(30)", (c) =>
      c.notNull().defaultTo("Approved"),
    )
    .addColumn("active", "integer", (c) => c.notNull().defaultTo(1))
    .addColumn("w9_status", "varchar(30)", (c) =>
      c.notNull().defaultTo("Not reviewed"),
    )
    .addColumn("insurance_status", "varchar(30)", (c) =>
      c.notNull().defaultTo("Not reviewed"),
    )
    .addColumn("license_status", "varchar(30)", (c) =>
      c.notNull().defaultTo("Not reviewed"),
    )
    .addColumn("license_number", "varchar(80)", (c) =>
      c.notNull().defaultTo(""),
    )
    .addColumn("license_type", "varchar(100)", (c) => c.notNull().defaultTo(""))
    .addColumn("license_expires_at", "varchar(30)")
    .addColumn("insurance_expires_at", "varchar(30)")
    .addColumn("internal_notes", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("created_at", "varchar(30)", (c) => c.notNull())
    .addColumn("updated_at", "varchar(30)", (c) => c.notNull())
    .execute();
  await db.schema
    .createTable("operations_sessions")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (c) => c.primaryKey())
    .addColumn("principal_type", "varchar(30)", (c) => c.notNull())
    .addColumn("principal_id", "varchar(36)", (c) => c.notNull())
    .addColumn("token_hash", "varchar(64)", (c) => c.notNull().unique())
    .addColumn("expires_at", "varchar(30)", (c) => c.notNull())
    .addColumn("created_at", "varchar(30)", (c) => c.notNull())
    .execute();
  await db.schema
    .createTable("work_channels")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (c) => c.primaryKey())
    .addColumn("name", "varchar(100)", (c) => c.notNull().unique())
    .addColumn("description", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("sort_order", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("active", "integer", (c) => c.notNull().defaultTo(1))
    .addColumn("compliance_review_recommended", "integer", (c) =>
      c.notNull().defaultTo(0),
    )
    .addColumn("created_at", "varchar(30)", (c) => c.notNull())
    .addColumn("updated_at", "varchar(30)", (c) => c.notNull())
    .execute();
  await db.schema
    .createTable("technician_channels")
    .ifNotExists()
    .addColumn("technician_id", "varchar(36)", (c) =>
      c.notNull().references("technicians.id"),
    )
    .addColumn("channel_id", "varchar(36)", (c) =>
      c.notNull().references("work_channels.id"),
    )
    .addPrimaryKeyConstraint("technician_channels_pk", [
      "technician_id",
      "channel_id",
    ])
    .execute();
  await db.schema
    .createTable("vendor_channels")
    .ifNotExists()
    .addColumn("vendor_id", "varchar(36)", (c) =>
      c.notNull().references("vendors.id"),
    )
    .addColumn("channel_id", "varchar(36)", (c) =>
      c.notNull().references("work_channels.id"),
    )
    .addPrimaryKeyConstraint("vendor_channels_pk", ["vendor_id", "channel_id"])
    .execute();
  await db.schema
    .createTable("operations_service_requests")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (c) => c.primaryKey())
    .addColumn("request_number", "varchar(30)", (c) => c.notNull().unique())
    .addColumn("organization_id", "varchar(36)", (c) =>
      c.notNull().references("organizations.id"),
    )
    .addColumn("property_id", "varchar(36)", (c) =>
      c.notNull().references("properties.id"),
    )
    .addColumn("created_by_user_id", "varchar(36)")
    .addColumn("inspection_id", "varchar(36)")
    .addColumn("finding_id", "varchar(36)")
    .addColumn("title", "varchar(160)", (c) => c.notNull())
    .addColumn("category", "varchar(100)", (c) => c.notNull())
    .addColumn("description", "text", (c) => c.notNull())
    .addColumn("priority", "varchar(20)", (c) => c.notNull())
    .addColumn("status", "varchar(40)", (c) => c.notNull())
    .addColumn("permission_to_enter", "integer", (c) =>
      c.notNull().defaultTo(0),
    )
    .addColumn("occupancy_status", "varchar(80)", (c) => c.notNull())
    .addColumn("preferred_service_date", "varchar(10)")
    .addColumn("preferred_service_window", "varchar(80)", (c) =>
      c.notNull().defaultTo(""),
    )
    .addColumn("spending_limit_cents", "integer")
    .addColumn("access_instructions", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("customer_notes", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("internal_notes", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("technician_notes", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("channel_id", "varchar(36)")
    .addColumn("assigned_technician_id", "varchar(36)")
    .addColumn("assigned_vendor_id", "varchar(36)")
    .addColumn("scheduled_at", "varchar(30)")
    .addColumn("created_at", "varchar(30)", (c) => c.notNull())
    .addColumn("updated_at", "varchar(30)", (c) => c.notNull())
    .execute();
  await db.schema
    .createTable("operations_request_media")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (c) => c.primaryKey())
    .addColumn("request_id", "varchar(36)", (c) =>
      c.notNull().references("operations_service_requests.id"),
    )
    .addColumn("inspection_media_id", "varchar(36)")
    .addColumn("storage_key", "varchar(180)")
    .addColumn("kind", "varchar(20)", (c) => c.notNull())
    .addColumn("purpose", "varchar(40)", (c) =>
      c.notNull().defaultTo("Request"),
    )
    .addColumn("file_name", "varchar(180)", (c) => c.notNull())
    .addColumn("mime_type", "varchar(100)", (c) => c.notNull())
    .addColumn("size_bytes", "integer", (c) => c.notNull())
    .addColumn("visibility", "varchar(20)", (c) => c.notNull())
    .addColumn("created_at", "varchar(30)", (c) => c.notNull())
    .execute();
  await db.schema
    .createTable("technician_task_details")
    .ifNotExists()
    .addColumn("request_id", "varchar(36)", (c) =>
      c.primaryKey().references("operations_service_requests.id"),
    )
    .addColumn("task_type", "varchar(40)", (c) => c.notNull())
    .addColumn("findings", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("measurements_notes", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("recommended_repair", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("specialist_needed", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("estimated_labor_hours", "real")
    .addColumn("estimated_materials", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("estimated_material_cost_cents", "integer")
    .addColumn("proposed_labor_cents", "integer")
    .addColumn("proposed_total_cents", "integer")
    .addColumn("customer_price_cents", "integer")
    .addColumn("review_status", "varchar(40)", (c) => c.notNull().defaultTo("Draft"))
    .addColumn("operation_id", "varchar(100)")
    .addColumn("submitted_at", "varchar(30)")
    .addColumn("created_at", "varchar(30)", (c) => c.notNull())
    .addColumn("updated_at", "varchar(30)", (c) => c.notNull())
    .execute();
  await db.schema
    .createTable("operations_request_history")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (c) => c.primaryKey())
    .addColumn("request_id", "varchar(36)", (c) =>
      c.notNull().references("operations_service_requests.id"),
    )
    .addColumn("actor_type", "varchar(30)", (c) => c.notNull())
    .addColumn("actor_id", "varchar(100)", (c) => c.notNull())
    .addColumn("action", "varchar(100)", (c) => c.notNull())
    .addColumn("from_status", "varchar(40)")
    .addColumn("to_status", "varchar(40)")
    .addColumn("details_json", "text", (c) => c.notNull().defaultTo("{}"))
    .addColumn("customer_visible", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("created_at", "varchar(30)", (c) => c.notNull())
    .execute();
  await db.schema
    .createTable("operations_comments")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (c) => c.primaryKey())
    .addColumn("request_id", "varchar(36)", (c) =>
      c.notNull().references("operations_service_requests.id"),
    )
    .addColumn("actor_type", "varchar(30)", (c) => c.notNull())
    .addColumn("actor_id", "varchar(36)", (c) => c.notNull())
    .addColumn("body", "text", (c) => c.notNull())
    .addColumn("visibility", "varchar(20)", (c) => c.notNull())
    .addColumn("created_at", "varchar(30)", (c) => c.notNull())
    .execute();
  await db.schema
    .createTable("estimates")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (c) => c.primaryKey())
    .addColumn("request_id", "varchar(36)", (c) =>
      c.notNull().references("operations_service_requests.id"),
    )
    .addColumn("status", "varchar(30)", (c) => c.notNull())
    .addColumn("current_revision", "integer", (c) => c.notNull())
    .addColumn("created_at", "varchar(30)", (c) => c.notNull())
    .addColumn("updated_at", "varchar(30)", (c) => c.notNull())
    .execute();
  await db.schema
    .createTable("estimate_revisions")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (c) => c.primaryKey())
    .addColumn("estimate_id", "varchar(36)", (c) =>
      c.notNull().references("estimates.id"),
    )
    .addColumn("revision_number", "integer", (c) => c.notNull())
    .addColumn("amount_cents", "integer", (c) => c.notNull())
    .addColumn("scope", "text", (c) => c.notNull())
    .addColumn("customer_note", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("created_by", "varchar(100)", (c) => c.notNull())
    .addColumn("created_at", "varchar(30)", (c) => c.notNull())
    .execute();
  await db.schema
    .createTable("estimate_approvals")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (c) => c.primaryKey())
    .addColumn("estimate_id", "varchar(36)", (c) =>
      c.notNull().references("estimates.id"),
    )
    .addColumn("organization_user_id", "varchar(36)", (c) =>
      c.notNull().references("organization_users.id"),
    )
    .addColumn("decision", "varchar(30)", (c) => c.notNull())
    .addColumn("comment", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("created_at", "varchar(30)", (c) => c.notNull())
    .execute();
  await db.schema
    .createTable("contractor_offers")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (c) => c.primaryKey())
    .addColumn("request_id", "varchar(36)", (c) =>
      c.notNull().references("operations_service_requests.id"),
    )
    .addColumn("vendor_id", "varchar(36)", (c) =>
      c.notNull().references("vendors.id"),
    )
    .addColumn("scope", "text", (c) => c.notNull())
    .addColumn("offered_compensation_cents", "integer", (c) => c.notNull())
    .addColumn("service_window", "varchar(100)", (c) => c.notNull())
    .addColumn("status", "varchar(20)", (c) => c.notNull())
    .addColumn("responded_at", "varchar(30)")
    .addColumn("created_at", "varchar(30)", (c) => c.notNull())
    .addColumn("updated_at", "varchar(30)", (c) => c.notNull())
    .execute();
  await db.schema
    .createTable("job_completion_reports")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (c) => c.primaryKey())
    .addColumn("request_id", "varchar(36)", (c) =>
      c.notNull().references("operations_service_requests.id"),
    )
    .addColumn("vendor_id", "varchar(36)")
    .addColumn("technician_id", "varchar(36)")
    .addColumn("completion_notes", "text", (c) => c.notNull())
    .addColumn("customer_completion_notes", "text", (c) =>
      c.notNull().defaultTo(""),
    )
    .addColumn("materials_notes", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("material_cost_notes", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("time_spent_minutes", "integer")
    .addColumn("invoice_amount_cents", "integer")
    .addColumn("status", "varchar(30)", (c) => c.notNull())
    .addColumn("reviewed_at", "varchar(30)")
    .addColumn("published_at", "varchar(30)")
    .addColumn("created_at", "varchar(30)", (c) => c.notNull())
    .addColumn("updated_at", "varchar(30)", (c) => c.notNull())
    .execute();
  await db.schema
    .createTable("technician_job_updates")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (c) => c.primaryKey())
    .addColumn("request_id", "varchar(36)", (c) =>
      c.notNull().references("operations_service_requests.id"),
    )
    .addColumn("technician_id", "varchar(36)", (c) =>
      c.notNull().references("technicians.id"),
    )
    .addColumn("update_type", "varchar(40)", (c) => c.notNull())
    .addColumn("notes", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("materials_used", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("material_cost_notes", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("time_spent_minutes", "integer")
    .addColumn("created_at", "varchar(30)", (c) => c.notNull())
    .execute();
  await db.schema
    .createTable("operations_notifications")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (c) => c.primaryKey())
    .addColumn("organization_id", "varchar(36)")
    .addColumn("organization_user_id", "varchar(36)")
    .addColumn("vendor_id", "varchar(36)")
    .addColumn("technician_id", "varchar(36)")
    .addColumn("request_id", "varchar(36)")
    .addColumn("event_type", "varchar(60)", (c) => c.notNull())
    .addColumn("message", "varchar(300)", (c) => c.notNull())
    .addColumn("read_at", "varchar(30)")
    .addColumn("created_at", "varchar(30)", (c) => c.notNull())
    .execute();
  await db.schema
    .createTable("property_activity")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (c) => c.primaryKey())
    .addColumn("property_id", "varchar(36)", (c) =>
      c.notNull().references("properties.id"),
    )
    .addColumn("request_id", "varchar(36)")
    .addColumn("inspection_id", "varchar(36)")
    .addColumn("event_type", "varchar(60)", (c) => c.notNull())
    .addColumn("summary", "varchar(300)", (c) => c.notNull())
    .addColumn("visibility", "varchar(20)", (c) => c.notNull())
    .addColumn("created_at", "varchar(30)", (c) => c.notNull())
    .execute();

  const channelNow = new Date().toISOString();
  for (const [sortOrder, name, compliance] of [
    [10, "Handyman", 0],
    [20, "Plumbing", 1],
    [30, "Electrical", 1],
    [40, "HVAC", 1],
    [50, "Pool", 1],
    [60, "Smart Home / IT", 0],
    [70, "Painting / Finish", 0],
    [80, "Cleaning", 0],
    [90, "Inspection", 0],
    [100, "Licensed Contractor", 1],
    [110, "Owner Review", 0],
  ] as const) {
    await db
      .insertInto("work_channels")
      .values({
        id: `channel-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        name,
        description: "",
        sort_order: sortOrder,
        active: 1,
        compliance_review_recommended: compliance,
        created_at: channelNow,
        updated_at: channelNow,
      })
      .onConflict((c) => c.column("name").doNothing())
      .execute();
  }

  for (const [name, table, columns] of [
    ["properties_client_idx", "properties", ["client_id"]],
    [
      "tech_sessions_token_idx",
      "technician_sessions",
      ["token_hash", "expires_at"],
    ],
    [
      "technician_activity_idx",
      "technician_activity_events",
      ["technician_id", "created_at"],
    ],
    ["inspections_status_idx", "inspections", ["status", "updated_at"]],
    ["inspection_media_inspection_idx", "inspection_media", ["inspection_id"]],
    [
      "inspection_findings_inspection_idx",
      "inspection_findings",
      ["inspection_id"],
    ],
    [
      "maintenance_finding_events_idx",
      "maintenance_finding_events",
      ["finding_id", "created_at"],
    ],
    ["notifications_read_idx", "notifications", ["read_at", "created_at"]],
    [
      "inspection_decisions_finding_idx",
      "inspection_decision_events",
      ["finding_id", "created_at"],
    ],
    [
      "property_audit_property_idx",
      "property_audit_events",
      ["property_id", "created_at"],
    ],
    [
      "property_notifications_read_idx",
      "property_notifications",
      ["read_at", "created_at"],
    ],
    [
      "property_assignment_status_idx",
      "property_assignment_status",
      ["status", "created_at"],
    ],
    [
      "organization_users_org_idx",
      "organization_users",
      ["organization_id", "active"],
    ],
    [
      "operations_sessions_token_idx",
      "operations_sessions",
      ["token_hash", "expires_at"],
    ],
    [
      "operations_requests_org_status_idx",
      "operations_service_requests",
      ["organization_id", "status", "updated_at"],
    ],
    [
      "operations_requests_property_idx",
      "operations_service_requests",
      ["property_id", "created_at"],
    ],
    [
      "operations_history_request_idx",
      "operations_request_history",
      ["request_id", "created_at"],
    ],
    [
      "contractor_offers_vendor_idx",
      "contractor_offers",
      ["vendor_id", "status", "created_at"],
    ],
    [
      "operations_notifications_target_idx",
      "operations_notifications",
      ["organization_id", "vendor_id", "read_at"],
    ],
    [
      "property_activity_property_idx",
      "property_activity",
      ["property_id", "created_at"],
    ],
    [
      "technician_job_updates_request_idx",
      "technician_job_updates",
      ["request_id", "created_at"],
    ],
  ] as const) {
    await db.schema
      .createIndex(name)
      .ifNotExists()
      .on(table)
      .columns([...columns])
      .execute();
  }
}
