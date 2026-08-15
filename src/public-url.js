const DRAFT_ID_PATTERN = /^[a-z0-9]{12}$/;

export function getRequestBaseUrl(req) {
  const forwardedProto = req.get("x-forwarded-proto");
  const protocol = forwardedProto
    ? forwardedProto.split(",")[0].trim()
    : req.protocol || "http";
  return `${protocol}://${req.get("host")}`;
}

export function getHomeUrl({ publicBaseUrl, requestBaseUrl }) {
  const configured = normalizeUrl(publicBaseUrl);
  const wildcard = parseWildcardBaseUrl(configured);

  if (wildcard) {
    wildcard.hostname = wildcard.hostname.slice(2);
    wildcard.pathname = "/";
    wildcard.search = "";
    wildcard.hash = "";
    return stripTrailingSlash(wildcard.toString());
  }

  return configured || normalizeUrl(requestBaseUrl);
}

export function getDraftPublicUrl({ draftId, publicBaseUrl, requestBaseUrl }) {
  const configured = normalizeUrl(publicBaseUrl);
  const wildcard = parseWildcardBaseUrl(configured);

  if (wildcard) {
    wildcard.hostname = `${draftId}.${wildcard.hostname.slice(2)}`;
    wildcard.pathname = "/";
    wildcard.search = "";
    wildcard.hash = "";
    return stripTrailingSlash(wildcard.toString());
  }

  const baseUrl = configured || normalizeUrl(requestBaseUrl);
  return `${baseUrl}/d/${draftId}`;
}

export function getDraftRawUrl({ draftId, publicBaseUrl, requestBaseUrl }) {
  const configured = normalizeUrl(publicBaseUrl);
  const wildcard = parseWildcardBaseUrl(configured);

  if (wildcard) {
    wildcard.hostname = wildcard.hostname.slice(2);
    wildcard.pathname = `/d/${draftId}/raw`;
    wildcard.search = "";
    wildcard.hash = "";
    return wildcard.toString();
  }

  const baseUrl = configured || normalizeUrl(requestBaseUrl);
  return `${baseUrl}/d/${draftId}/raw`;
}

export function getDraftIdFromHost({ publicBaseUrl, host }) {
  const wildcard = parseWildcardBaseUrl(publicBaseUrl);
  if (!wildcard) return null;

  const rootHost = wildcard.hostname.slice(2).toLowerCase();
  const requestHost = parseHost(host);
  if (!requestHost || !requestHost.endsWith(`.${rootHost}`)) return null;

  const draftId = requestHost.slice(0, -(rootHost.length + 1));
  if (draftId.includes(".") || !DRAFT_ID_PATTERN.test(draftId)) return null;
  return draftId;
}

function parseWildcardBaseUrl(value) {
  const url = parseUrl(value);
  if (!url || !url.hostname.startsWith("*.")) return null;
  return url;
}

function parseHost(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;

  try {
    return new URL(`http://${normalized}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function parseUrl(value) {
  const normalized = normalizeUrl(value);
  if (!normalized) return null;

  try {
    return new URL(normalized);
  } catch {
    return null;
  }
}

function normalizeUrl(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\/+$/, "");
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}
