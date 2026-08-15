// One-shot schema setup. Upstream postplan runs initDb() before app.listen();
// on Vercel that would re-run DDL on every cold start, so it lives here and
// runs once per deploy (or by hand): `npm run migrate`.
import { ensureBootstrapApiKey, initDb, pool } from "../src/db.js";

await initDb();
await ensureBootstrapApiKey();
await pool.end();
console.log("Database schema is up to date.");
