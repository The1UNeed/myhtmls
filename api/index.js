import { createApp } from "../src/api.js";

// One Express app instance per lambda instance. Schema setup does NOT run
// here — that is `npm run migrate`, a one-shot script — so cold starts do no
// DDL and the request path is pure reads/writes.
const app = createApp();

export default app;
