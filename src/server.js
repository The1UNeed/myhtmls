import { createApp } from "./api.js";
import { config } from "./config.js";
import { ensureBootstrapApiKey, initDb } from "./db.js";
import { assertStorageConfigured } from "./storage.js";

async function main() {
  assertStorageConfigured();
  await initDb();
  await ensureBootstrapApiKey();

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`myhtmls listening on port ${config.port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
