import { type Kysely, type Migration, Migrator, sql } from "kysely";
import type { TaskCoreDatabase } from "./types.js";

const initialServiceRequests: Migration = {
  async up(db) {
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
  },
  async down() {
    // Intentionally non-destructive: this migration adopts the pre-migration
    // production table, so rollback must never drop historical customer requests.
  }
};

const bookingPaymentFoundation: Migration = {
  async up(db) {
    await db.schema.createTable("customers").ifNotExists()
      .addColumn("id", "varchar(36)", (column) => column.primaryKey())
      .addColumn("name", "varchar(100)", (column) => column.notNull())
      .addColumn("email", "varchar(254)")
      .addColumn("phone", "varchar(30)", (column) => column.notNull())
      .addColumn("service_address", "varchar(250)", (column) => column.notNull())
      .addColumn("created_at", "varchar(30)", (column) => column.notNull())
      .addColumn("updated_at", "varchar(30)", (column) => column.notNull())
      .execute();

    await db.schema.createTable("booking_holds").ifNotExists()
      .addColumn("id", "varchar(36)", (column) => column.primaryKey())
      .addColumn("customer_id", "varchar(36)", (column) => column.notNull().references("customers.id").onDelete("restrict"))
      .addColumn("service_type", "varchar(100)", (column) => column.notNull())
      .addColumn("requested_start", "varchar(30)", (column) => column.notNull())
      .addColumn("requested_end", "varchar(30)", (column) => column.notNull())
      .addColumn("timezone", "varchar(100)", (column) => column.notNull())
      .addColumn("status", "varchar(20)", (column) => column.notNull())
      .addColumn("expires_at", "varchar(30)", (column) => column.notNull())
      .addColumn("created_at", "varchar(30)", (column) => column.notNull())
      .addColumn("updated_at", "varchar(30)", (column) => column.notNull())
      .execute();

    await db.schema.createTable("bookings").ifNotExists()
      .addColumn("id", "varchar(36)", (column) => column.primaryKey())
      .addColumn("customer_id", "varchar(36)", (column) => column.notNull().references("customers.id").onDelete("restrict"))
      .addColumn("booking_hold_id", "varchar(36)", (column) => column.references("booking_holds.id").onDelete("set null"))
      .addColumn("service_type", "varchar(100)", (column) => column.notNull())
      .addColumn("requested_start", "varchar(30)", (column) => column.notNull())
      .addColumn("requested_end", "varchar(30)", (column) => column.notNull())
      .addColumn("timezone", "varchar(100)", (column) => column.notNull())
      .addColumn("status", "varchar(30)", (column) => column.notNull())
      .addColumn("notes", "text")
      .addColumn("created_at", "varchar(30)", (column) => column.notNull())
      .addColumn("updated_at", "varchar(30)", (column) => column.notNull())
      .execute();

    await db.schema.createTable("jobs").ifNotExists()
      .addColumn("id", "varchar(36)", (column) => column.primaryKey())
      .addColumn("customer_id", "varchar(36)", (column) => column.notNull().references("customers.id").onDelete("restrict"))
      .addColumn("booking_id", "varchar(36)", (column) => column.notNull().unique().references("bookings.id").onDelete("restrict"))
      .addColumn("service", "varchar(100)", (column) => column.notNull())
      .addColumn("address", "varchar(250)", (column) => column.notNull())
      .addColumn("scheduled_start", "varchar(30)", (column) => column.notNull())
      .addColumn("scheduled_end", "varchar(30)", (column) => column.notNull())
      .addColumn("status", "varchar(30)", (column) => column.notNull())
      .addColumn("quoted_total_cents", "integer", (column) => column.notNull())
      .addColumn("deposit_amount_cents", "integer", (column) => column.notNull())
      .addColumn("remaining_balance_cents", "integer", (column) => column.notNull())
      .addColumn("payment_status", "varchar(30)", (column) => column.notNull())
      .addColumn("created_at", "varchar(30)", (column) => column.notNull())
      .addColumn("updated_at", "varchar(30)", (column) => column.notNull())
      .execute();

    await db.schema.createTable("payments").ifNotExists()
      .addColumn("id", "varchar(36)", (column) => column.primaryKey())
      .addColumn("booking_id", "varchar(36)", (column) => column.notNull().references("bookings.id").onDelete("restrict"))
      .addColumn("customer_id", "varchar(36)", (column) => column.notNull().references("customers.id").onDelete("restrict"))
      .addColumn("provider", "varchar(30)", (column) => column.notNull())
      .addColumn("provider_payment_id", "varchar(100)")
      .addColumn("type", "varchar(20)", (column) => column.notNull())
      .addColumn("amount_cents", "integer", (column) => column.notNull())
      .addColumn("currency", "varchar(3)", (column) => column.notNull())
      .addColumn("status", "varchar(30)", (column) => column.notNull())
      .addColumn("idempotency_key", "varchar(100)", (column) => column.notNull())
      .addColumn("created_at", "varchar(30)", (column) => column.notNull())
      .addColumn("updated_at", "varchar(30)", (column) => column.notNull())
      .execute();
    await db.schema.createIndex("payments_provider_idempotency_unique").ifNotExists()
      .unique().on("payments").columns(["provider", "idempotency_key"]).execute();
    await db.schema.createIndex("payments_provider_payment_unique").ifNotExists()
      .unique().on("payments").columns(["provider", "provider_payment_id"]).execute();

    await db.schema.createTable("payment_events").ifNotExists()
      .addColumn("id", "varchar(36)", (column) => column.primaryKey())
      .addColumn("provider", "varchar(30)", (column) => column.notNull())
      .addColumn("provider_event_id", "varchar(100)", (column) => column.notNull())
      .addColumn("event_type", "varchar(100)", (column) => column.notNull())
      .addColumn("payment_id", "varchar(36)", (column) => column.references("payments.id").onDelete("set null"))
      .addColumn("processing_status", "varchar(20)", (column) => column.notNull())
      .addColumn("error_summary", "varchar(500)")
      .addColumn("received_at", "varchar(30)", (column) => column.notNull())
      .addColumn("processed_at", "varchar(30)")
      .addColumn("created_at", "varchar(30)", (column) => column.notNull())
      .addColumn("updated_at", "varchar(30)", (column) => column.notNull())
      .execute();
    await db.schema.createIndex("payment_events_provider_event_unique").ifNotExists()
      .unique().on("payment_events").columns(["provider", "provider_event_id"]).execute();

    await db.schema.createTable("integration_outbox").ifNotExists()
      .addColumn("id", "varchar(36)", (column) => column.primaryKey())
      .addColumn("aggregate_type", "varchar(30)", (column) => column.notNull())
      .addColumn("aggregate_id", "varchar(36)", (column) => column.notNull())
      .addColumn("integration", "varchar(50)", (column) => column.notNull())
      .addColumn("action", "varchar(50)", (column) => column.notNull())
      .addColumn("status", "varchar(20)", (column) => column.notNull())
      .addColumn("external_id", "varchar(255)")
      .addColumn("retry_count", "integer", (column) => column.notNull().defaultTo(0))
      .addColumn("last_error_summary", "varchar(500)")
      .addColumn("available_at", "varchar(30)", (column) => column.notNull())
      .addColumn("created_at", "varchar(30)", (column) => column.notNull())
      .addColumn("updated_at", "varchar(30)", (column) => column.notNull())
      .execute();
    await db.schema.createIndex("integration_outbox_pending_idx").ifNotExists()
      .on("integration_outbox").columns(["status", "available_at"]).execute();

    await db.schema.createTable("slot_reservations").ifNotExists()
      .addColumn("slot_key", "varchar(300)", (column) => column.primaryKey())
      .addColumn("hold_id", "varchar(36)", (column) => column.references("booking_holds.id").onDelete("cascade"))
      .addColumn("booking_id", "varchar(36)", (column) => column.references("bookings.id").onDelete("cascade"))
      .addColumn("expires_at", "varchar(30)")
      .addColumn("created_at", "varchar(30)", (column) => column.notNull())
      .addColumn("updated_at", "varchar(30)", (column) => column.notNull())
      .execute();

    await db.schema.createIndex("booking_holds_expiry_idx").ifNotExists()
      .on("booking_holds").columns(["status", "expires_at"]).execute();
    await db.schema.createIndex("bookings_slot_idx").ifNotExists()
      .on("bookings").columns(["requested_start", "requested_end", "timezone", "status"]).execute();

    // Keep money integer-only even when callers bypass TypeScript.
    await sql`create index if not exists jobs_customer_idx on jobs (customer_id)`.execute(db);
  },
  async down(db) {
    await db.schema.dropTable("slot_reservations").ifExists().execute();
    await db.schema.dropTable("integration_outbox").ifExists().execute();
    await db.schema.dropTable("payment_events").ifExists().execute();
    await db.schema.dropTable("payments").ifExists().execute();
    await db.schema.dropTable("jobs").ifExists().execute();
    await db.schema.dropTable("bookings").ifExists().execute();
    await db.schema.dropTable("booking_holds").ifExists().execute();
    await db.schema.dropTable("customers").ifExists().execute();
  }
};

const squarePaymentFoundation: Migration = {
  async up(db) {
    await db.schema.alterTable("bookings").addColumn("quoted_total_cents", "integer").execute();
    await db.schema.alterTable("payments").addColumn("refunded_amount_cents", "integer", (column) => column.notNull().defaultTo(0)).execute();
    await db.schema.alterTable("integration_outbox").addColumn("dedupe_key", "varchar(255)").execute();
    await db.schema.createIndex("integration_outbox_dedupe_unique").unique().on("integration_outbox").column("dedupe_key").execute();
  },
  async down(db) {
    await db.schema.dropIndex("integration_outbox_dedupe_unique").ifExists().execute();
    await db.schema.alterTable("integration_outbox").dropColumn("dedupe_key").execute();
    await db.schema.alterTable("payments").dropColumn("refunded_amount_cents").execute();
    await db.schema.alterTable("bookings").dropColumn("quoted_total_cents").execute();
  }
};

export const orderedMigrations: Record<string, Migration> = {
  "001_existing_service_requests": initialServiceRequests,
  "002_booking_payment_foundation": bookingPaymentFoundation,
  "003_square_payment_foundation": squarePaymentFoundation
};

export function createMigrator(db: Kysely<TaskCoreDatabase>): Migrator {
  return new Migrator({ db, provider: { async getMigrations() { return orderedMigrations; } } });
}

export async function migrateToLatest(db: Kysely<TaskCoreDatabase>): Promise<void> {
  const { error, results } = await createMigrator(db).migrateToLatest();
  if (error) throw error;
  const failed = results?.find((result) => result.status === "Error");
  if (failed) throw new Error(`Migration ${failed.migrationName} failed.`);
}

export async function rollbackLastMigration(db: Kysely<TaskCoreDatabase>): Promise<void> {
  const { error, results } = await createMigrator(db).migrateDown();
  if (error) throw error;
  const failed = results?.find((result) => result.status === "Error");
  if (failed) throw new Error(`Rollback ${failed.migrationName} failed.`);
}
