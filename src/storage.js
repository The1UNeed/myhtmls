import { put } from "@vercel/blob";
import { requireEnv } from "./config.js";

export function assertStorageConfigured() {
  requireEnv("BLOB_READ_WRITE_TOKEN", process.env.BLOB_READ_WRITE_TOKEN);
}

// Writes the draft HTML to Vercel Blob and returns the blob URL, which the
// caller stores as the version's object_key. Version objects are immutable:
// every upload gets a fresh key, and overwriting an existing one is an error.
export async function putHtmlObject(key, html) {
  assertStorageConfigured();
  const blob = await put(key, html, {
    access: "public",
    contentType: "text/html; charset=utf-8",
    addRandomSuffix: false,
    allowOverwrite: false
  });
  return blob.url;
}

// object_key holds the full blob URL, so a read is a single fetch. The blob
// host is never handed to clients — the serving path proxies the bytes so the
// response always carries our headers and CSP.
export async function getHtmlObject(objectKey) {
  const response = await fetch(objectKey);
  if (!response.ok) {
    throw new Error(`Blob fetch failed (${response.status}) for ${objectKey}`);
  }
  return response.text();
}
