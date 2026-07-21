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
}
