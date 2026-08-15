export const config = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL,
  bootstrapApiKey: process.env.MYHTMLS_BOOTSTRAP_API_KEY,
  publicBaseUrl: process.env.MYHTMLS_PUBLIC_BASE_URL,
  maxHtmlBytes: Number(process.env.MAX_HTML_BYTES || 512 * 1024),
  // Upstream postplan accepts anonymous uploads. myhtmls requires an API key
  // unless this is explicitly flipped on: it runs on a personal Vercel/Neon
  // budget, and the per-instance in-memory rate limiter is a much weaker
  // backstop on serverless than on a single long-lived Railway process.
  allowAnonymousUploads: process.env.MYHTMLS_ALLOW_ANONYMOUS_UPLOADS === "1",
  // Web sign-in (dashboard). Absent MYHTMLS_SESSION_SECRET, all web-auth
  // routes respond 503 and the API/serving paths are unaffected.
  sessionSecret: process.env.MYHTMLS_SESSION_SECRET,
  shooBaseUrl: (process.env.SHOO_BASE_URL || "https://shoo.dev").replace(/\/+$/, "")
};

export function requireEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
