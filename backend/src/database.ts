import fs from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { Kysely, PostgresDialect, SqliteDialect } from "kysely";
import { Pool } from "pg";
import type { AppConfig } from "./config.js";
import { migrateToLatest } from "./migrations.js";
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
  await migrateToLatest(db);
}
