// Secret redaction for collected evidence.
//
// Evidence is sent to a third-party LLM and stored in investigation history,
// and logs, event messages and container errors routinely carry credentials
// (a connection string in a crash log, a token echoed by a failing client).
// Everything is redacted here, inside the collector: on the agent path that
// means secrets are stripped inside the user's own cluster, before a single
// byte leaves it.
//
// Rules keep the NAME of what was redacted ("DB_PASSWORD=[REDACTED:...]") so a
// diagnosis can still say which setting is involved. They deliberately do not
// touch things that look sensitive but are diagnostic: secret *names*
// (`secret "db-creds" not found`), image tags, hosts and ports.

const R = (kind) => `[REDACTED:${kind}]`;

const BUILT_IN_RULES = [
  {
    kind: "private_key",
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    replace: () => R("private_key"),
  },
  {
    kind: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g,
    replace: () => R("jwt"),
  },
  {
    // scheme://user:password@host -- keep scheme, user and host.
    kind: "url_password",
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+(@)/gi,
    replace: (_match, before, at) => `${before}${R("url_password")}${at}`,
  },
  {
    kind: "bearer_token",
    pattern: /\b(Bearer\s+)[A-Za-z0-9._~+/-]{16,}=*/gi,
    replace: (_match, prefix) => `${prefix}${R("bearer_token")}`,
  },
  { kind: "aws_access_key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replace: () => R("aws_access_key") },
  { kind: "github_token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, replace: () => R("github_token") },
  { kind: "slack_token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, replace: () => R("slack_token") },
  { kind: "google_api_key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, replace: () => R("google_api_key") },
  // OpenAI / Anthropic / OpenRouter style keys.
  { kind: "api_key", pattern: /\bsk-(?:ant-|proj-|or-)?[A-Za-z0-9_-]{20,}/g, replace: () => R("api_key") },
  // This product's own credentials.
  { kind: "agent_token", pattern: /\baika_[A-Za-z0-9_-]{30,}/g, replace: () => R("agent_token") },
  { kind: "insforge_key", pattern: /\bik_[a-f0-9]{24,}\b/g, replace: () => R("insforge_key") },
  {
    // KEY=value / KEY: value where the key names a secret. Runs last so it
    // never re-wraps a value an earlier rule already redacted.
    kind: "secret_assignment",
    pattern:
      /\b([A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credentials?)[A-Za-z0-9_.-]*)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;&)]+)/gi,
    replace: (match, key, separator, value) => {
      const bare = value.replace(/^["']|["']$/g, "");
      if (bare.startsWith("[REDACTED:") || bare.length < 3) return match;
      return `${key}${separator}${R("secret_assignment")}`;
    },
  },
];

/**
 * Parse user-supplied extra patterns: a JSON array of regex sources, or one
 * regex per line. Returns strings; invalid entries are filtered later.
 */
export function parseRedactPatterns(raw) {
  if (!raw || typeof raw !== "string" || !raw.trim()) return [];
  const text = raw.trim();
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed.filter((p) => typeof p === "string" && p) : [];
    } catch {
      return [];
    }
  }
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function compileExtraRules(patterns, logger) {
  const rules = [];
  for (const source of patterns) {
    try {
      rules.push({ kind: "custom", pattern: new RegExp(source, "g"), replace: () => R("custom") });
    } catch (error) {
      // A typo in a user pattern must never stop evidence collection.
      logger?.warn(`Ignoring invalid redaction pattern ${JSON.stringify(source)}: ${error.message}`);
    }
  }
  return rules;
}

/**
 * Build a redactor. Built-in rules always apply; `extraPatterns` add to them
 * and can never switch them off.
 */
export function createRedactor({ extraPatterns = [], logger } = {}) {
  const rules = [...BUILT_IN_RULES, ...compileExtraRules(extraPatterns, logger)];

  function redactString(text, counts) {
    let out = text;
    for (const rule of rules) {
      out = out.replace(rule.pattern, (...args) => {
        const replaced = rule.replace(...args);
        if (replaced !== args[0]) counts[rule.kind] = (counts[rule.kind] ?? 0) + 1;
        return replaced;
      });
    }
    return out;
  }

  function walk(value, counts) {
    if (typeof value === "string") return redactString(value, counts);
    if (Array.isArray(value)) return value.map((item) => walk(item, counts));
    if (value && typeof value === "object") {
      const out = {};
      for (const [key, item] of Object.entries(value)) out[key] = walk(item, counts);
      return out;
    }
    return value;
  }

  return {
    customRuleCount: rules.length - BUILT_IN_RULES.length,

    /**
     * Redact every string inside `value` (returns a copy). The summary counts
     * redactions by kind and never contains the secrets themselves.
     */
    redact(value) {
      const counts = {};
      const redacted = walk(value, counts);
      const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
      return { value: redacted, summary: { total, by_kind: counts } };
    },
  };
}
