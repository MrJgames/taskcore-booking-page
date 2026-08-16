import { Kysely, PostgresDialect } from "kysely";
import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { orderedMigrations } from "./migrations.js";
import type { TaskCoreDatabase } from "./types.js";

describe("PostgreSQL initialization", () => {
  it("creates the complete schema on a new PostgreSQL-compatible database", async () => {
    // pg-mem can execute this PostgreSQL DDL but does not model every column
    // constraint, so AST coverage is disabled for this compatibility test.
    const memoryPostgres = newDb({ noAstCoverageCheck: true });
    const adapter = memoryPostgres.adapters.createPg();
    const db = new Kysely<TaskCoreDatabase>({
      dialect: new PostgresDialect({ pool: new adapter.Pool() })
    });

    try {
      for (const migration of Object.values(orderedMigrations)) await migration.up(db);
      const requests = await db.selectFrom("service_requests").selectAll().execute();
      expect(requests).toEqual([]);
    } finally {
      await db.destroy();
    }
  });
});
