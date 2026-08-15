import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { config } from "./config.js";
import { randomToken } from "./crypto.js";

// shoo (shoo.dev) protocol facts, extracted from its source:
// - Clients are auto-registered by redirect_uri origin; client_id is always
//   derived as `origin:<origin>` and never needs a secret.
// - /authorize requires redirect_uri, state, code_challenge (S256 only).
// - /token takes application/x-www-form-urlencoded, and redirect_uri must be
//   byte-identical to the one sent to /authorize. Codes are single-use, 120s.
// - The id_token is ES256; aud is `origin:<origin>`; the stable per-site user
//   id is `pairwise_sub` (deterministic, survives revoke + re-auth).
// - The only error shoo redirects back is ?error=access_denied — everything
//   else renders on shoo itself.

let jwksCache = null;
let issuerCache = null;

export function buildPkce() {
  const verifier = randomToken(32);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge, state: randomToken(24) };
}

export function buildAuthorizeUrl({ redirectUri, state, challenge }) {
  const url = new URL(`${config.shooBaseUrl}/authorize`);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  // Request profile claims (email/email_verified/name/picture/pii_sub). shoo
  // shows a one-time consent screen per user; declining it denies the sign-in.
  url.searchParams.set("pii", "true");
  return url.toString();
}

export async function exchangeCode({ code, verifier, redirectUri }) {
  const response = await fetch(`${config.shooBaseUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
      code_verifier: verifier
    }),
    signal: AbortSignal.timeout(10_000)
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`shoo token exchange failed: ${body.error || response.status}`);
  }
  if (typeof body.id_token !== "string") {
    throw new Error("shoo token exchange returned no id_token.");
  }
  return body;
}

// Verifies the ES256 id_token against shoo's JWKS and returns its claims.
// audOrigin must be this deployment's public origin (e.g. https://myhtmls.dev).
export async function verifyIdToken(idToken, { audOrigin }) {
  const audience = `origin:${new URL(audOrigin).origin}`;
  const { payload } = await jwtVerify(idToken, getJwks(), {
    issuer: await getIssuer(),
    audience,
    algorithms: ["ES256"]
  });
  if (typeof payload.pairwise_sub !== "string" || !payload.pairwise_sub) {
    throw new Error("shoo id_token is missing pairwise_sub.");
  }
  return payload;
}

function getJwks() {
  jwksCache ||= createRemoteJWKSet(
    new URL(`${config.shooBaseUrl}/.well-known/jwks.json`)
  );
  return jwksCache;
}

// The issuer string is whatever shoo's discovery document says (it may differ
// from the base URL), so fetch it once instead of assuming.
async function getIssuer() {
  issuerCache ||= (async () => {
    const response = await fetch(
      `${config.shooBaseUrl}/.well-known/openid-configuration`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!response.ok) {
      throw new Error(`shoo discovery failed: ${response.status}`);
    }
    const body = await response.json();
    if (typeof body.issuer !== "string") {
      throw new Error("shoo discovery document has no issuer.");
    }
    return body.issuer;
  })().catch((error) => {
    issuerCache = null;
    throw error;
  });
  return issuerCache;
}

// Test hook: reset module caches (jwks/issuer) between test servers.
export function resetShooCaches() {
  jwksCache = null;
  issuerCache = null;
}
