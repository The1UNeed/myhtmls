import * as parse5 from "parse5";

const BLOCKED_TAGS = new Set([
  "form",
  "iframe",
  "object",
  "embed",
  "applet",
  "base",
  "link"
]);

const URL_ATTRS = new Set([
  "href",
  "src",
  "action",
  "formaction",
  "poster",
  "srcdoc",
  "xlink:href"
]);

const BLOCKED_PROTOCOLS = ["javascript:", "vbscript:", "file:"];
const ALLOWED_SCRIPT_TYPES = new Set(["", "text/javascript", "application/javascript"]);

// Far above any real document (browsers themselves flatten around 512), but
// well below where the recursive parse5 serializer used for the framed view
// would overflow the call stack (~2000+ levels).
const MAX_DEPTH = 512;

export function validateHtml(html, options = {}) {
  const maxBytes = options.maxBytes ?? 512 * 1024;
  const errors = [];
  const warnings = [];

  if (typeof html !== "string" || html.trim() === "") {
    errors.push("HTML document is empty.");
    return { ok: false, errors, warnings, title: null, hasScripts: false, stats: emptyStats() };
  }

  const byteLength = Buffer.byteLength(html, "utf8");
  if (byteLength > maxBytes) {
    errors.push(`HTML document is ${byteLength} bytes; maximum is ${maxBytes} bytes.`);
  }

  let document;
  try {
    // scriptingEnabled: false so <noscript> children parse as real elements:
    // the hosted viewer renders drafts in an iframe without allow-scripts
    // unless consented, and the policy must see what that frame shows.
    document = parse5.parse(html, { scriptingEnabled: false });
  } catch {
    errors.push("HTML document could not be parsed.");
    return { ok: false, errors, warnings, title: null, hasScripts: false, stats: emptyStats() };
  }

  let title = null;
  let hasScripts = false;
  const externalImageHosts = new Set();

  function visit(node) {
    if (node.tagName) {
      const tagName = node.tagName.toLowerCase();

      if (BLOCKED_TAGS.has(tagName)) {
        errors.push(`Blocked <${tagName}> tag found.`);
      }

      if (tagName === "script") {
        hasScripts = true;
        const attributes = new Map(
          (node.attrs || []).map((attr) => [attr.name.toLowerCase(), String(attr.value || "").trim()])
        );
        if (attributes.has("src")) {
          errors.push("External script sources are not allowed.");
        }

        const scriptType = (attributes.get("type") || "").toLowerCase();
        if (!ALLOWED_SCRIPT_TYPES.has(scriptType)) {
          errors.push(`Unsupported script type "${scriptType}" found.`);
        }
      }

      for (const attr of node.attrs || []) {
        const name = attr.name.toLowerCase();
        const value = String(attr.value || "").trim();

        if (name.startsWith("on")) {
          errors.push(`Blocked inline event handler attribute "${name}" found.`);
        }

        if (name === "srcdoc") {
          errors.push('Blocked "srcdoc" attribute found.');
        }

        if (URL_ATTRS.has(name)) {
          const normalized = value.replace(/[\u0000-\u0020]+/g, "").toLowerCase();
          if (BLOCKED_PROTOCOLS.some((protocol) => normalized.startsWith(protocol))) {
            errors.push(`Blocked unsafe URL in "${name}" attribute.`);
          }
        }

        if (name === "style" && /expression\s*\(|behavior\s*:|url\s*\(\s*javascript:/i.test(value)) {
          errors.push("Blocked unsafe inline CSS.");
        }
      }

      if (tagName === "meta") {
        const httpEquiv = (node.attrs || []).find((attr) => attr.name.toLowerCase() === "http-equiv");
        if (httpEquiv && httpEquiv.value.trim().toLowerCase() === "refresh") {
          errors.push("Blocked meta refresh tag found.");
        }
      }

      // Images are the one external resource the serving CSP allows (img-src
      // https: data:), so record which hosts a draft pulls from for later review.
      if (tagName === "img") {
        const src = (node.attrs || []).find((attr) => attr.name.toLowerCase() === "src");
        const host = externalHost(src?.value);
        if (host) externalImageHosts.add(host);
      }
    }

    if (node.tagName === "title" && !title) {
      title = collectText(node).trim().slice(0, 140) || null;
    }
  }

  let tooDeep = false;
  const stack = [{ node: document, depth: 0 }];
  while (stack.length) {
    const { node, depth } = stack.pop();
    visit(node);
    if (depth >= MAX_DEPTH) {
      tooDeep = true;
      continue;
    }
    const children = node.childNodes || [];
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({ node: children[i], depth: depth + 1 });
    }
  }
  if (tooDeep) {
    errors.push(`HTML is nested more than ${MAX_DEPTH} levels deep.`);
  }

  if (!title) {
    warnings.push("No <title> found; myhtmls will use a generic title.");
  }

  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    title,
    hasScripts,
    stats: {
      hasInlineScript: hasScripts,
      externalImageHosts: [...externalImageHosts].sort()
    }
  };
}

function emptyStats() {
  return { hasInlineScript: false, externalImageHosts: [] };
}

// Returns the lowercased host of an absolute http(s) (or protocol-relative) URL,
// or null for relative paths, data: URIs, and anything unparseable.
function externalHost(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const candidate = raw.startsWith("//") ? `https:${raw}` : raw;
  try {
    const url = new URL(candidate);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.hostname.toLowerCase();
    }
  } catch {
    // relative path, data: URI, etc. — not an external host
  }
  return null;
}

function collectText(node) {
  let value = "";
  for (const child of node.childNodes || []) {
    if (child.nodeName === "#text") value += child.value || "";
    value += collectText(child);
  }
  return value;
}
