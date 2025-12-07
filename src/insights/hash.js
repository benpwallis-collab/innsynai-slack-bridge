import crypto from "crypto";

export function hashMessage(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}
