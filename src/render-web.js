// Server-rendered dashboard pages. These are myhtmls's own UI (apex domain
// only) — unlike draft serving they may use inline styles/JS freely; the
// draft-serving CSP never applies here.

export function renderSignIn({ next }) {
  const target = `/auth/sign-in?next=${encodeURIComponent(next || "/dashboard")}`;
  return webPage({
    title: "Sign in — myhtmls",
    body: `
      <main class="narrow center">
        <h1>myhtmls</h1>
        <p class="muted">Sign in to see the drafts you've published.</p>
        <p><a class="button" href="${escapeHtml(target)}">Continue with shoo</a></p>
        <p class="muted small">Publishing from the CLI stays anonymous unless you attach a key.</p>
      </main>
    `
  });
}

export function renderAuthError({ message }) {
  return webPage({
    title: "Sign-in problem — myhtmls",
    body: `
      <main class="narrow center">
        <h1>Sign-in problem</h1>
        <p class="muted">${escapeHtml(message)}</p>
        <p><a class="button" href="/auth/sign-in">Try again</a></p>
      </main>
    `
  });
}

export function renderDashboard({ session, drafts }) {
  const groups = groupByRepo(drafts);
  const sections = groups
    .map(
      (group) => `
        <section>
          <h2>${escapeHtml(group.label)}${
            group.href
              ? ` <a class="small repo-link" href="${escapeHtml(group.href)}" target="_blank" rel="noopener noreferrer">GitHub ↗</a>`
              : ""
          }</h2>
          ${group.drafts.map(renderDraftRow).join("\n")}
        </section>
      `
    )
    .join("\n");

  return webPage({
    title: "My drafts — myhtmls",
    header: pageHeader({ session, active: "dashboard" }),
    body: `
      <main>
        <h1>My drafts</h1>
        ${
          drafts.length
            ? sections
            : `<p class="muted">No drafts yet. Publish one with <code>myhtmls upload plan.html</code> using a key from <a href="/cli/auth">CLI setup</a>.</p>`
        }
      </main>
    `
  });
}

export function renderDraftDetail({ session, draft, versions }) {
  const rows = versions
    .map(
      (v) => `
        <tr>
          <td><a href="${escapeHtml(draft.publicUrl)}/v/${Number(v.version_number)}" target="_blank" rel="noopener noreferrer">v${Number(v.version_number)}</a></td>
          <td>${escapeHtml(v.git_commit_subject || "")}${v.git_dirty ? ' <span class="pill warn">dirty</span>' : ""}</td>
          <td class="muted">${escapeHtml(v.git_branch || "")} ${escapeHtml((v.git_commit_sha || "").slice(0, 7))}</td>
          <td class="muted">${escapeHtml(formatDate(v.created_at))}</td>
        </tr>
      `
    )
    .join("\n");

  return webPage({
    title: `${draft.title} — myhtmls`,
    header: pageHeader({ session, active: "dashboard" }),
    body: `
      <main>
        <p class="small"><a href="/dashboard">← My drafts</a></p>
        <h1>${escapeHtml(draft.title)}</h1>
        ${draft.description ? `<p class="muted">${escapeHtml(draft.description)}</p>` : ""}
        <p>
          ${
            draft.isPublic
              ? '<span class="pill">public</span> Anyone with the link can read this draft.'
              : '<span class="pill warn">private</span> Owner-only while private reads are on.'
          }
        </p>
        <form method="post" action="/dashboard/drafts/${escapeHtml(draft.draftId)}/visibility/${draft.isPublic ? "private" : "public"}">
          <button class="button" type="submit">${draft.isPublic ? "Make private" : "Make public"}</button>
        </form>
        <p><a href="${escapeHtml(draft.publicUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(draft.publicUrl)}</a></p>
        <table>
          <tr><th>Version</th><th>Commit</th><th>Ref</th><th>Published</th></tr>
          ${rows}
        </table>
      </main>
    `
  });
}

export function renderCliAuth({ session, keys = [] }) {
  const keyRows = keys
    .map(
      (key) => `
        <tr>
          <td>${escapeHtml(key.name)}</td>
          <td class="muted">${escapeHtml(formatDate(key.created_at))}</td>
          <td class="muted">${key.last_used_at ? escapeHtml(formatDate(key.last_used_at)) : "never used"}</td>
          <td>
            <form method="post" action="/cli/auth/keys/${escapeHtml(key.id)}/revoke">
              <button class="linklike" type="submit">Revoke</button>
            </form>
          </td>
        </tr>
      `
    )
    .join("\n");

  return webPage({
    title: "CLI setup — myhtmls",
    header: pageHeader({ session, active: "cli" }),
    body: `
      <main class="narrow">
        <h1>Connect your CLI</h1>
        <p class="muted">Generate a key, then paste it into the waiting <code>myhtmls auth login</code> prompt in your terminal.</p>
        <form method="post" action="/cli/auth/keys">
          <button class="button" type="submit">Generate a new API key</button>
        </form>
        <p class="muted small">Each visit can mint a fresh key. Keys are shown once.</p>
        ${
          keys.length
            ? `<h2>Active keys</h2>
        <table>
          <tr><th>Name</th><th>Created</th><th>Last used</th><th></th></tr>
          ${keyRows}
        </table>`
            : ""
        }
      </main>
    `
  });
}

export function renderCliAuthKey({ session, token, keyName }) {
  return webPage({
    title: "Your new API key — myhtmls",
    header: pageHeader({ session, active: "cli" }),
    body: `
      <main class="narrow">
        <h1>Your new API key</h1>
        <p class="muted">Named <strong>${escapeHtml(keyName)}</strong>. Shown once — copy it now and paste it into your terminal.</p>
        <div class="keybox">
          <code id="key">${escapeHtml(token)}</code>
          <button class="button" id="copy" type="button">Copy</button>
        </div>
        <p class="muted small">Terminal: <code>myhtmls auth login</code> (or <code>myhtmls auth set &lt;key&gt;</code>).</p>
        <script>
          document.getElementById("copy").addEventListener("click", async () => {
            await navigator.clipboard.writeText(document.getElementById("key").textContent);
            document.getElementById("copy").textContent = "Copied";
          });
        </script>
      </main>
    `
  });
}

function renderDraftRow(draft) {
  // The title is the one-click "open the plan" action (new tab); the internal
  // detail/version-history screen hangs off the separate Details link.
  return `
    <div class="row">
      <div>
        <a class="row-title" href="${escapeHtml(draft.publicUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(draft.title)}</a>
        ${draft.disabled ? '<span class="pill warn">disabled</span>' : ""}
        ${draft.isPublic ? '<span class="pill">public</span>' : ""}
        ${draft.description ? `<div class="muted small">${escapeHtml(draft.description)}</div>` : ""}
      </div>
      <div class="row-meta muted small">
        <a href="/dashboard/drafts/${escapeHtml(draft.draftId)}">Details</a> ·
        v${draft.latestVersionNumber ?? "—"} · ${draft.versionCount} version${draft.versionCount === 1 ? "" : "s"} · ${escapeHtml(formatDate(draft.updatedAt))}
      </div>
    </div>
  `;
}

function groupByRepo(drafts) {
  const map = new Map();
  for (const draft of drafts) {
    const hasRepo = draft.repoOrg && draft.repoName;
    const key = hasRepo ? `${draft.repoOrg}/${draft.repoName}` : "";
    if (!map.has(key)) {
      // Drafts uploaded by pre-0.0.3 CLIs have no repo_host; default those to
      // github.com so the one-click repo link still works. Any member draft
      // with a recorded host upgrades the group's link below.
      map.set(key, {
        label: hasRepo ? key : "No repository",
        href: hasRepo
          ? `https://${draft.repoHost || "github.com"}/${draft.repoOrg}/${draft.repoName}`
          : null,
        drafts: []
      });
    }
    const group = map.get(key);
    if (hasRepo && draft.repoHost) {
      group.href = `https://${draft.repoHost}/${draft.repoOrg}/${draft.repoName}`;
    }
    group.drafts.push(draft);
  }
  // Repo groups first (already newest-first within), "No repository" last.
  return [...map.entries()].sort(([a], [b]) => (a === "") - (b === "")).map(([, g]) => g);
}

function pageHeader({ session = {}, active }) {
  // Claims arrive via shoo's verified id_token, but only render an avatar for
  // plain https URLs anyway.
  const avatar =
    typeof session.pictureUrl === "string" && session.pictureUrl.startsWith("https://")
      ? `<img class="avatar" src="${escapeHtml(session.pictureUrl)}" alt="" referrerpolicy="no-referrer">`
      : "";
  // The email is PII: render it blurred until hover/focus (shoo's own /me
  // pattern) so it never leaks on screenshares or streams. A user with no
  // Google display name gets their email as the account name — in that case
  // skip the plain name and show only the blurred email.
  const name =
    session.accountName && session.accountName !== session.email
      ? `<span class="muted small">${escapeHtml(session.accountName)}</span>`
      : "";
  const email = session.email
    ? `<span class="muted small pii" tabindex="0" title="Hover to reveal">${escapeHtml(session.email)}</span>`
    : "";

  return `
    <header class="top">
      <nav>
        <a href="/dashboard" class="${active === "dashboard" ? "active" : ""}">My drafts</a>
        <a href="/cli/auth" class="${active === "cli" ? "active" : ""}">CLI setup</a>
      </nav>
      <form method="post" action="/auth/sign-out">
        ${avatar}
        ${name}
        ${email}
        <button class="linklike" type="submit">Sign out</button>
      </form>
    </header>
  `;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 16).replace("T", " ");
}

function webPage({ title, body, header = "" }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; background: #f8fafc; color: #111827; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width: 860px; margin: 32px auto 80px; padding: 0 20px; }
    main.narrow { max-width: 560px; }
    main.center { text-align: center; margin-top: 96px; }
    h1 { font-size: 30px; margin: 0 0 14px; }
    h2 { font-size: 17px; margin: 30px 0 6px; }
    p { line-height: 1.6; }
    a { color: #1d4ed8; }
    code { background: #eef2f7; border: 1px solid #d1d5db; border-radius: 5px; padding: 1px 5px; font-size: 14px; }
    .muted { color: #6b7280; }
    .small { font-size: 13px; }
    .button { display: inline-block; background: #111827; color: #fff; border: 0; border-radius: 8px; padding: 10px 18px; font-size: 15px; text-decoration: none; cursor: pointer; }
    .linklike { background: none; border: 0; color: #1d4ed8; cursor: pointer; font-size: 13px; padding: 0; margin-left: 10px; text-decoration: underline; }
    .top { display: flex; justify-content: space-between; align-items: center; max-width: 860px; margin: 0 auto; padding: 14px 20px; border-bottom: 1px solid #e5e7eb; }
    .top nav a { margin-right: 16px; text-decoration: none; color: #374151; }
    .top nav a.active { color: #111827; font-weight: 600; }
    .top form { display: inline-flex; align-items: center; gap: 8px; }
    .avatar { width: 26px; height: 26px; border-radius: 50%; vertical-align: middle; }
    .repo-link { font-weight: 400; text-decoration: none; margin-left: 6px; }
    .row-meta a { color: #6b7280; }
    .pii { filter: blur(4px); border-radius: 3px; transition: filter .15s ease; cursor: pointer; }
    .pii:hover, .pii:focus { filter: none; outline: none; }
    .row { display: flex; justify-content: space-between; gap: 14px; align-items: baseline; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
    .row-title { font-weight: 600; text-decoration: none; }
    .row-meta { white-space: nowrap; }
    .pill { font-size: 11px; border-radius: 999px; padding: 2px 8px; margin-left: 6px; }
    .pill.warn { background: #fef3c7; color: #92400e; }
    table { width: 100%; border-collapse: collapse; margin-top: 14px; }
    th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #e5e7eb; font-size: 14px; }
    th { color: #6b7280; font-weight: 600; font-size: 12px; text-transform: uppercase; }
    .keybox { display: flex; gap: 10px; align-items: center; background: #fff; border: 1px solid #d1d5db; border-radius: 8px; padding: 14px; margin: 14px 0; }
    .keybox code { flex: 1; word-break: break-all; background: none; border: 0; font-size: 15px; }
  </style>
</head>
<body>${header}${body}</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
