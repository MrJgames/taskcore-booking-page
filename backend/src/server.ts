import { createApp } from "./app.js";
import { assertProductionConfig, loadConfig } from "./config.js";
import { createDatabase, initializeDatabase } from "./database.js";

const config = loadConfig();
assertProductionConfig(config);
const db = createDatabase(config);
await initializeDatabase(db);

const server = createApp(config, db).listen(config.port, () => {
  console.log(`TaskCore API listening on http://localhost:${config.port}`);
});

async function shutdown() {
  server.close(async () => {
    await db.destroy();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
