export function renderHome({ publicBaseUrl }) {
  return htmlPage({
    title: "myhtmls",
    body: `
      <main class="home">
        <h1>myhtmls</h1>
        <p>Authenticated static HTML draft publishing for agents.</p>
        <pre>npx myhtmls upload ./plan.html</pre>
        <p><a href="/dashboard">My drafts</a> · <a href="/cli/auth">CLI setup</a></p>
        <p>Health: <a href="/healthz">/healthz</a></p>
        <p>Public base URL: ${escapeHtml(publicBaseUrl || "not configured")}</p>
      </main>
    `
  });
}

export function renderNotFound() {
  return htmlPage({
    title: "Draft not found",
    body: `
      <main class="home">
        <h1>Draft not found</h1>
        <p>The requested draft is unavailable.</p>
      </main>
    `
  });
}

function htmlPage({ title, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body {
      margin: 0;
      background: #f8fafc;
      color: #111827;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .home {
      max-width: 760px;
      margin: 64px auto;
      padding: 0 20px;
    }

    h1 {
      margin: 0 0 12px;
      font-size: 40px;
      line-height: 1.1;
    }

    p {
      color: #374151;
      font-size: 17px;
      line-height: 1.6;
    }

    pre {
      overflow-x: auto;
      padding: 14px;
      border: 1px solid #d1d5db;
      background: #ffffff;
      border-radius: 6px;
    }
  </style>
</head>
<body>${body}</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
