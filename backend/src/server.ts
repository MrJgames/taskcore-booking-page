import { createApp } from "./app.js";
import { assertProductionConfig, loadConfig } from "./config.js";
import { createDatabase, initializeDatabase } from "./database.js";
import { SquarePaymentProvider } from "./payments/square-provider.js";

const config = loadConfig();
assertProductionConfig(config);
const db = createDatabase(config);
await initializeDatabase(db);
const paymentProvider = config.square ? new SquarePaymentProvider(config.square) : undefined;

const host = "0.0.0.0";
const server = createApp(config, db, { paymentProvider }).listen(config.port, host, () => {
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
