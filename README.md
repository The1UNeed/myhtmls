# myhtmls

myhtmls is a small service and CLI for publishing static HTML drafts from agents, at [myhtmls.dev](https://myhtmls.dev). It is a fork of [postplan](https://www.npmjs.com/package/postplan) by t3dotgg (MIT), ported from Railway (Express + Postgres + S3) to Vercel (Functions + Neon + Vercel Blob).

## CLI

Upload a draft (requires an API key — see below):

```sh
npx myhtmls upload ./plan.html
```

Attach an optional stable description (a short label shown in your dashboard and `myhtmls list`). Re-running with `--description` updates it; omitting it leaves the existing one untouched:

```sh
npx myhtmls upload ./plan.html --description "Q3 warehouse migration plan"
```

The CLI defaults to `https://myhtmls.dev`. Use `--api-url http://localhost:3000` for a local or custom deployment.

Log in interactively (opens a browser page that mints a key you paste back — works over SSH, no localhost redirect):

```sh
npx myhtmls auth login
```

Or set a key directly:

```sh
npx myhtmls auth set <api-key>
```

List the drafts published to your account:

```sh
npx myhtmls list
```

The CLI stores credentials and draft mappings in `~/.myhtmls`.

## Differences from postplan

- **Uploads require an API key.** Upstream accepts anonymous public uploads; myhtmls returns 401 without a key unless `MYHTMLS_ALLOW_ANONYMOUS_UPLOADS=1` restores upstream behavior.
- **Inline scripts run, sandboxed.** Upstream serves drafts with `script-src 'none'`. myhtmls serves a CSP `sandbox` without `allow-same-origin`: inline classic scripts execute, but the document has an opaque origin — storage throws, fetch/XHR are blocked, forms and frames stay dead. Upload-time validation (no external/module scripts, no event handlers, no forms/iframes, etc.) is unchanged from upstream. The CSP is per-version: drafts containing inline script also lose network images/fonts (`img-src data:`) and silent popups, closing the image-beacon exfiltration channel — scripts and arbitrary-host images are never available together.
- **Server packages live in `devDependencies`** so `npx myhtmls` installs ~2 MB instead of ~40 MB. Vercel installs devDependencies at build time and bundles what the function imports (this is the supported deployment). If you instead run `src/server.js` on a host that does `npm install --omit=dev`, do a full `npm install`.
- **Draft responses carry `X-Robots-Tag: noindex, nofollow`** and the apex serves a disallow-all `robots.txt`.
- **Storage/infra:** Postgres via `@neondatabase/serverless`, HTML bytes in Vercel Blob (`object_key` stores the blob URL), one Vercel Function serving every route. Schema setup is `npm run migrate`, not on-boot.

## Environment

Required:

- `DATABASE_URL` (Neon)
- `BLOB_READ_WRITE_TOKEN` (Vercel Blob)
- `MYHTMLS_BOOTSTRAP_API_KEY`

Optional:

- `MYHTMLS_PUBLIC_BASE_URL` — set to a wildcard URL such as `https://*.myhtmls.dev` for draft subdomains, or a normal base URL for `/d/<draft-id>` URLs.
- `MYHTMLS_SESSION_SECRET` — together with `MYHTMLS_PUBLIC_BASE_URL`, enables web sign-in (the dashboard and `/cli/auth`). If either is absent, those routes return 503 and uploads/serving are unaffected.
- `SHOO_BASE_URL` — identity broker for web sign-in (default `https://shoo.dev`).
- `MYHTMLS_ALLOW_ANONYMOUS_UPLOADS` — `1` restores upstream postplan's anonymous uploads.
- `MYHTMLS_PRIVATE_READS` — `1` makes draft reads owner-only: viewers must present a Bearer API key or a web session belonging to the draft's account. Browsers are redirected through sign-in and back; other clients get 401. Off by default (upstream's anyone-with-the-link model).
- `MAX_HTML_BYTES`, `UPLOAD_IP_RATE_LIMIT_WINDOW_MS`, `UPLOAD_IP_RATE_LIMIT_MAX`, `UPLOAD_RATE_LIMIT_WINDOW_MS`, `UPLOAD_RATE_LIMIT_MAX`

## Serving

Every draft URL serves the exact uploaded HTML, byte for byte, to every client — browsers, `curl`, agent fetch tools, and HTTP libraries alike. There is no browser detection, no wrapper page, and no consent interstitial. Responses carry `X-Myhtmls-Draft-Id` and `X-Myhtmls-Draft-Version` headers.

URL forms (wildcard base URL configured):

- `https://<draft-id>.myhtmls.dev/` (or `/raw`)
- `https://<draft-id>.myhtmls.dev/v/<n>/raw`
- `https://myhtmls.dev/d/<draft-id>/raw`
- `https://myhtmls.dev/d/<draft-id>/v/<n>/raw`

## Deploying

```sh
npm install
vercel link          # project: myhtmls-dev
npm run migrate      # once, with DATABASE_URL set
vercel deploy --prod
```

Create a named key from the bootstrap key:

```sh
curl -X POST "https://myhtmls.dev/api/api-keys" \
  -H "Authorization: Bearer $MYHTMLS_BOOTSTRAP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"local-cli"}'
```
