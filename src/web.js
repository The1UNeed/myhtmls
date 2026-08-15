import { config } from "./config.js";
import { findOrCreateAccountForIdentity, pool } from "./db.js";
import { newInternalId } from "./ids.js";
import { clientIp } from "./client-ip.js";
import { createRateLimiter } from "./rate-limit.js";
import { randomToken, sha256 } from "./crypto.js";
import { getAccountDraftWithVersions, listAccountDrafts } from "./drafts.js";
import { getDraftIdFromHost, getHomeUrl, getRequestBaseUrl } from "./public-url.js";
import { buildAuthorizeUrl, buildPkce, exchangeCode, verifyIdToken } from "./shoo.js";
import {
  clearAuthStateCookie,
  clearSessionCookie,
  createAuthStateCookie,
  createSessionCookie,
  readAuthState,
  readSession
} from "./web-auth.js";
import {
  renderAuthError,
  renderCliAuth,
  renderCliAuthKey,
  renderDashboard,
  renderDraftDetail,
  renderSignIn
} from "./render-web.js";

// Server-rendered web UI: shoo sign-in, the drafts dashboard, and the /cli/auth
// key page. Apex-domain only — on draft subdomains these paths fall through to
// the 404 handler so a draft origin can never serve dashboard UI.
export function registerWebRoutes(app) {
  const web = [onlyApex, requireConfigured];
  const keyMintRateLimit = createRateLimiter({
    windowMs: Number(process.env.KEY_MINT_RATE_LIMIT_WINDOW_MS || 3_600_000),
    max: Number(process.env.KEY_MINT_RATE_LIMIT_MAX || 10),
    keyPrefix: "key-mint",
    key: (req) => readSession(req)?.accountId || clientIp(req) || "anonymous"
  });

  app.get("/auth/sign-in", ...web, (req, res) => {
    const { verifier, challenge, state } = buildPkce();
    const next = safeNextPath(req.query.next);
    res.append(
      "Set-Cookie",
      createAuthStateCookie({ state, verifier, next })
    );
    res.redirect(buildAuthorizeUrl({ redirectUri: callbackUrl(), state, challenge }));
  });

  app.get("/auth/callback", ...web, async (req, res, next) => {
    try {
      res.append("Set-Cookie", clearAuthStateCookie());

      // The only error shoo redirects back is user consent denial.
      if (req.query.error === "access_denied") {
        return res
          .status(403)
          .type("html")
          .send(
            renderAuthError({
              message:
                "Sign-in was cancelled or consent was declined. myhtmls uses your email and profile picture to identify your account — retry and approve to continue."
            })
          );
      }

      const authState = readAuthState(req);
      const { code, state } = req.query;
      if (!authState || typeof state !== "string" || state !== authState.state) {
        return res
          .status(400)
          .type("html")
          .send(renderAuthError({ message: "Sign-in expired or state mismatch. Please retry." }));
      }
      if (typeof code !== "string" || !code) {
        return res
          .status(400)
          .type("html")
          .send(renderAuthError({ message: "Missing authorization code." }));
      }

      // Exchange/verification failures are expected OAuth outcomes (expired
      // or replayed 120s codes, shoo hiccups) — render a retryable page, not
      // the JSON 500 handler.
      let claims;
      try {
        const tokens = await exchangeCode({
          code,
          verifier: authState.verifier,
          redirectUri: callbackUrl()
        });
        claims = await verifyIdToken(tokens.id_token, { audOrigin: webOrigin() });
      } catch (error) {
        console.error("shoo sign-in failed:", error.message);
        return res
          .status(502)
          .type("html")
          .send(renderAuthError({ message: "Sign-in could not be completed. Please retry." }));
      }

      const account = await findOrCreateAccountForIdentity({
        provider: "shoo",
        subject: claims.pairwise_sub,
        // Profile claims are present only with pii consent, and each is
        // individually optional (depends on the Google profile). Blank or
        // whitespace-only strings mean "absent", never a stored value.
        profile: {
          email: claimText(claims.email),
          emailVerified: typeof claims.email_verified === "boolean" ? claims.email_verified : null,
          displayName: claimText(claims.name),
          pictureUrl: claimText(claims.picture),
          piiSubject: claimText(claims.pii_sub)
        }
      });

      res.append("Set-Cookie", createSessionCookie(account));
      res.redirect(safeNextPath(authState.next));
    } catch (error) {
      next(error);
    }
  });

  app.post("/auth/sign-out", onlyApex, (req, res) => {
    res.append("Set-Cookie", clearSessionCookie());
    res.redirect("/");
  });

  app.get("/dashboard", ...web, async (req, res, next) => {
    try {
      const session = readSession(req);
      if (!session) {
        return res.type("html").send(renderSignIn({ next: "/dashboard" }));
      }
      const drafts = await listAccountDrafts(session.accountId, {
        requestBaseUrl: getRequestBaseUrl(req)
      });
      res.type("html").send(renderDashboard({ session, drafts }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/dashboard/drafts/:draftId", ...web, async (req, res, next) => {
    try {
      const session = readSession(req);
      if (!session) {
        return res.type("html").send(renderSignIn({ next: "/dashboard" }));
      }
      const result = await getAccountDraftWithVersions(session.accountId, req.params.draftId, {
        requestBaseUrl: getRequestBaseUrl(req)
      });
      if (!result) return next();
      res.type("html").send(
        renderDraftDetail({
          session,
          draft: result.draft,
          versions: result.versions
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/cli/auth", ...web, async (req, res, next) => {
    try {
      const session = readSession(req);
      if (!session) {
        return res.type("html").send(renderSignIn({ next: "/cli/auth" }));
      }
      res.type("html").send(
        renderCliAuth({
          session,
          keys: await listAccountApiKeys(session.accountId)
        })
      );
    } catch (error) {
      next(error);
    }
  });

  // Mints a fresh named key for the signed-in account and shows it once.
  // POST + SameSite=Lax session cookie keeps cross-site requests out.
  app.post("/cli/auth/keys", ...web, keyMintRateLimit, async (req, res, next) => {
    try {
      const session = readSession(req);
      if (!session) {
        return res.type("html").send(renderSignIn({ next: "/cli/auth" }));
      }

      const token = `pp_${randomToken(32)}`;
      const keyName = `CLI · ${new Date().toISOString().slice(0, 10)}`;
      await pool.query(
        "INSERT INTO api_keys (id, account_id, name, key_hash) VALUES ($1, $2, $3, $4)",
        [newInternalId(), session.accountId, keyName, sha256(token)]
      );

      res.type("html").send(
        renderCliAuthKey({ session, token, keyName })
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/cli/auth/keys/:apiKeyId/revoke", ...web, async (req, res, next) => {
    try {
      const session = readSession(req);
      if (!session) {
        return res.type("html").send(renderSignIn({ next: "/cli/auth" }));
      }
      await pool.query(
        `
          UPDATE api_keys
          SET revoked_at = now()
          WHERE id = $1 AND account_id = $2 AND revoked_at IS NULL
        `,
        [req.params.apiKeyId, session.accountId]
      );
      res.redirect("/cli/auth");
    } catch (error) {
      next(error);
    }
  });
}

async function listAccountApiKeys(accountId) {
  const result = await pool.query(
    `
      SELECT id, name, created_at, last_used_at
      FROM api_keys
      WHERE account_id = $1 AND revoked_at IS NULL
      ORDER BY created_at DESC
    `,
    [accountId]
  );
  return result.rows;
}

// Web sign-in needs a session secret and a configured public base URL (the
// shoo redirect_uri must be a stable, exact string — never request-derived).
function requireConfigured(req, res, next) {
  if (!config.sessionSecret || !config.publicBaseUrl) {
    return res
      .status(503)
      .type("html")
      .send(
        renderAuthError({
          message:
            "Web sign-in is not configured on this deployment (MYHTMLS_SESSION_SECRET / MYHTMLS_PUBLIC_BASE_URL)."
        })
      );
  }
  next();
}

function onlyApex(req, res, next) {
  const draftId = getDraftIdFromHost({
    publicBaseUrl: config.publicBaseUrl,
    host: req.hostname || req.get("host")
  });
  if (draftId) return next("route");
  next();
}

function webOrigin() {
  return getHomeUrl({ publicBaseUrl: config.publicBaseUrl, requestBaseUrl: "" });
}

function callbackUrl() {
  return `${webOrigin()}/auth/callback`;
}

function claimText(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

// Only allow same-site relative paths as post-login destinations, so the
// `next` param can never become an open redirect.
function safeNextPath(value) {
  if (typeof value !== "string") return "/dashboard";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/dashboard";
  }
  return value;
}
