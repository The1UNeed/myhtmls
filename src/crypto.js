import { createHash, randomBytes } from "node:crypto";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function contentHash(value) {
  return sha256(value);
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}
