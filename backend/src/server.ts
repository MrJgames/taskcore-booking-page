import { createApp } from "./app.js";
import { assertProductionConfig, loadConfig } from "./config.js";
import { createDatabase, initializeDatabase } from "./database.js";
import { logMediaStorage } from "./media.js";

const config = loadConfig();
assertProductionConfig(config);
logMediaStorage(config, "startup");
const db = createDatabase(config);
await initializeDatabase(db);

const host = "0.0.0.0";
const server = createApp(config, db).listen(config.port, host, () => {
  console.log(`TaskCore API listening on ${host}:${config.port}`);
});

async function shutdown() {
  server.close(async () => {
    await db.destroy();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
