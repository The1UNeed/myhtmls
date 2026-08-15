// Vercel's edge sets `x-vercel-forwarded-for` to the client's remote address
// and does not let clients supply it, so it is the trustworthy client-IP
// source behind Vercel. Express's `req.ip` (with `trust proxy` enabled) reads
// the LEFT-MOST `X-Forwarded-For` entry, which a client can spoof by
// prepending a fake value — so it must not be used for abuse logging or
// rate-limit keys. `x-real-ip` (also edge-set) is the secondary source, and
// `req.ip` is only a fallback for local runs where the edge headers are absent.
export function clientIp(req) {
  for (const header of ["x-vercel-forwarded-for", "x-real-ip"]) {
    const value = req.get?.(header);
    if (typeof value === "string" && value.trim()) {
      return value.split(",")[0].trim();
    }
  }
  return req.ip || null;
}
