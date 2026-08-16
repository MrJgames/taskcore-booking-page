import { loadConfig } from "./config.js";
import { createDatabase, initializeDatabase } from "./database.js";
import { rollbackLastMigration } from "./migrations.js";

const direction = process.argv[2] ?? "up";
const config = loadConfig();
if (config.nodeEnv === "production") throw new Error("This local migration command refuses to run with NODE_ENV=production.");
const db = createDatabase(config);
try {
  if (direction === "up") await initializeDatabase(db);
  else if (direction === "down") await rollbackLastMigration(db);
  else throw new Error("Use migrate-cli.ts with 'up' or 'down'.");
  console.log(`Local migration ${direction} completed.`);
} finally {
  await db.destroy();
}
