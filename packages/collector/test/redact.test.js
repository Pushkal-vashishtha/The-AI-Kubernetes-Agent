// Run: node --test packages/collector/test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRedactor, parseRedactPatterns } from "../src/redact.js";

const redactor = createRedactor();
const redactText = (text) => redactor.redact(text).value;

// ---------------------------------------------------------------------------
// Secrets that must disappear
// ---------------------------------------------------------------------------

const SECRETS = [
  ["JWT", "auth failed for eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U", "eyJhbGci"],
  ["bearer token", "request sent with Authorization: Bearer 8f3a9c2e71b4d6f0a5e3c9b8", "8f3a9c2e71b4"],
  ["postgres URL password", "cannot connect to postgres://app:hunter2secret@db.prod:5432/orders", "hunter2secret"],
  ["redis URL password", "dial redis://default:S3cr3tP4ss@cache:6379/0", "S3cr3tP4ss"],
  ["AWS access key", "using credentials AKIAIOSFODNN7EXAMPLE from env", "AKIAIOSFODNN7EXAMPLE"],
  ["AWS secret assignment", "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY", "wJalrXUtnFEMI"],
  ["password assignment", "DATABASE_PASSWORD: s3cr3t-value", "s3cr3t-value"],
  ["quoted token assignment", 'api_key="abc123def456ghi789"', "abc123def456"],
  ["GitHub token", "clone failed ghp_abcdefghijklmnopqrstuvwxyz0123456789AB", "ghp_abcdef"],
  ["OpenAI-style key", "openai error for key sk-proj-abcdefghijklmnopqrstuv123", "sk-proj-abcdef"],
  ["agent token", "token aika_GM2Sabcdefghijklmnopqrstuvwxyz0123456789ABCD leaked", "aika_GM2S"],
  // Fake value with the real key shape -- never paste a real key into a fixture.
  ["InsForge key", "INSFORGE key ik_0000deadbeef0000deadbeef0000dead in logs", "ik_0000deadbeef"],
  [
    "private key block",
    "loaded -----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA7bq\nabc\n-----END RSA PRIVATE KEY----- ok",
    "MIIEowIBAAKCAQEA",
  ],
];

for (const [name, input, fragment] of SECRETS) {
  test(`redacts ${name}`, () => {
    const out = redactText(input);
    assert.ok(!out.includes(fragment), `still contains "${fragment}": ${out}`);
    assert.match(out, /\[REDACTED:[a-z_]+\]/);
  });
}

test("keeps the name of what was redacted", () => {
  assert.equal(redactText("DB_PASSWORD=hunter2"), "DB_PASSWORD=[REDACTED:secret_assignment]");
  assert.equal(
    redactText("postgres://app:hunter2@db:5432/x"),
    "postgres://app:[REDACTED:url_password]@db:5432/x",
  );
  assert.equal(redactText("Authorization: Bearer abcdefghijklmnop1234"), "Authorization: Bearer [REDACTED:bearer_token]");
});

// ---------------------------------------------------------------------------
// Diagnostic text that must survive untouched
// ---------------------------------------------------------------------------

const MUST_SURVIVE = [
  "Error: environment variable DATABASE_URL is missing",
  'MountVolume.SetUp failed for volume "creds" : secret "db-creds" not found',
  'Back-off pulling image "nginx:1.99-does-not-exist"',
  'Readiness probe failed: Get "http://10.244.0.4:8181/ready": dial tcp 10.244.0.4:8181: connect: connection refused',
  "Container was killed after exceeding its memory limit",
  "backend refused the connection: token rejected (revoked, or copied wrong?)",
  "kubectl -n failure-lab set image deployment/web-frontend web-frontend=nginx:1.27",
  "0/1 nodes are available: 1 node(s) had untolerated taint(s).",
  "Service has a selector but no pods match it",
];

for (const text of MUST_SURVIVE) {
  test(`leaves diagnostic text intact: ${text.slice(0, 50)}`, () => {
    assert.equal(redactText(text), text);
  });
}

// ---------------------------------------------------------------------------
// Structure, counting, configuration
// ---------------------------------------------------------------------------

test("walks nested objects and arrays and counts by kind", () => {
  const evidence = {
    pods: { problematic_pods: [{ name: "api", message: "DB_PASSWORD=hunter22" }] },
    logs: { logs: [{ relevant_lines: ["token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdEFGH", "ok"] }] },
    count: 3,
    healthy: false,
    error: null,
  };
  const { value, summary } = redactor.redact(evidence);
  assert.equal(value.pods.problematic_pods[0].message, "DB_PASSWORD=[REDACTED:secret_assignment]");
  assert.equal(value.logs.logs[0].relevant_lines[1], "ok");
  assert.equal(value.count, 3);
  assert.equal(value.healthy, false);
  assert.equal(value.error, null);
  assert.deepEqual(summary, { total: 2, by_kind: { secret_assignment: 1, jwt: 1 } });
  // The input is not mutated.
  assert.equal(evidence.pods.problematic_pods[0].message, "DB_PASSWORD=hunter22");
});

test("does not double-redact a value an earlier rule already handled", () => {
  const out = redactText("ACCESS_TOKEN=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdEFGH");
  assert.equal(out, "ACCESS_TOKEN=[REDACTED:jwt]");
});

test("summary never contains the secret", () => {
  const { summary } = redactor.redact("DB_PASSWORD=hunter2hunter2");
  assert.ok(!JSON.stringify(summary).includes("hunter2"));
});

test("custom patterns add to the built-ins", () => {
  const custom = createRedactor({ extraPatterns: ["ACME-[0-9]{6}"] });
  assert.equal(custom.customRuleCount, 1);
  assert.equal(custom.redact("ticket ACME-123456 opened").value, "ticket [REDACTED:custom] opened");
  // Built-ins still apply.
  assert.equal(custom.redact("DB_PASSWORD=hunter2").value, "DB_PASSWORD=[REDACTED:secret_assignment]");
});

test("an invalid custom pattern is skipped with a warning, not thrown", () => {
  const warnings = [];
  const custom = createRedactor({ extraPatterns: ["(unclosed", "OK-[0-9]+"], logger: { warn: (m) => warnings.push(m) } });
  assert.equal(custom.customRuleCount, 1);
  assert.equal(warnings.length, 1);
  assert.equal(custom.redact("OK-42").value, "[REDACTED:custom]");
});

test("parses patterns from JSON arrays and from lines", () => {
  assert.deepEqual(parseRedactPatterns('["a+", "b+"]'), ["a+", "b+"]);
  assert.deepEqual(parseRedactPatterns("a+\n  b+  \n\n"), ["a+", "b+"]);
  assert.deepEqual(parseRedactPatterns(""), []);
  assert.deepEqual(parseRedactPatterns(undefined), []);
  assert.deepEqual(parseRedactPatterns("[not json"), []);
});
