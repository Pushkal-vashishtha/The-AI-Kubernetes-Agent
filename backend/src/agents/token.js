// Agent enrolment tokens.
//
// A token is shown to the user exactly once, inside the install command.
// Only its SHA-256 is stored, so a database leak does not hand anyone a way
// to impersonate a cluster -- and a lost token is replaced, never recovered.

import { createHash, randomBytes } from "node:crypto";
import { TOKEN_PREFIX } from "@aika/protocol";

export function mintAgentToken() {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

// A plain (unsalted) hash is correct here, unlike for passwords: the token is
// 256 bits of randomness, so there is nothing to brute-force, and the hash
// has to be deterministic to be looked up by index.
export function hashAgentToken(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function looksLikeAgentToken(value) {
  return typeof value === "string" && value.startsWith(TOKEN_PREFIX) && value.length > 40;
}
