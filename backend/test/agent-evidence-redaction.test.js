// Run: node --test backend/test/agent-evidence-redaction.test.js
//
// The backend must redact evidence that arrives from an agent, even though
// agents redact in-cluster: an agent can be old (0.1.0 predates redaction)
// or modified, and the backend is the last point before the LLM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInvestigation } from "../src/services/investigation.service.js";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvbGQtYWdlbnQifQ.c2lnbmF0dXJlLWZha2U";

// What an agent too old to redact would send back.
function unredactedEvidence() {
  return {
    collected_at: "2026-09-14T00:00:00Z",
    duration_ms: 10,
    cluster_context: null,
    cluster_reachable: true,
    issues_found: 1,
    pods: {
      healthy: false,
      total_pods: 1,
      problematic_pods: [{ name: "api", namespace: "shop", status: "Error", restarts: 3, message: "DB_PASSWORD=hunter2hunter2" }],
      error: null,
    },
    logs: { collected: 1, skipped: 0, logs: [{ pod: "api", relevant_lines: [`ERROR auth failed ${JWT}`], previous_run_lines: [] }], error: null },
    events: { healthy: true, total_events: 0, findings: [], error: null },
    deployments: { healthy: true, total_deployments: 0, unhealthy_deployments: [], error: null },
    network: { healthy: true, total_services: 0, issues: [], dns: null, error: null },
    // 0.1.0 sends no `redactions` field at all.
  };
}

const remoteSource = (evidence) => ({ kind: "agent", context: null, collect: async () => evidence });

test("redacts evidence from an agent that did not redact", async () => {
  const result = await runInvestigation(remoteSource(unredactedEvidence()));
  const raw = JSON.stringify(result);

  assert.ok(!raw.includes("hunter2hunter2"), "password leaked");
  assert.ok(!raw.includes(JWT), "JWT leaked");
  assert.equal(result.pods.problematic_pods[0].message, "DB_PASSWORD=[REDACTED:secret_assignment]");
  assert.deepEqual(result.redactions, { total: 2, by_kind: { secret_assignment: 1, jwt: 1 } });
});

test("keeps non-evidence fields and merges counts with the agent's own", async () => {
  const evidence = unredactedEvidence();
  evidence.pods.problematic_pods[0].message = "Container exited with code 1";
  evidence.redactions = { total: 4, by_kind: { url_password: 4 } };

  const result = await runInvestigation(remoteSource(evidence));

  assert.equal(result.collected_at, "2026-09-14T00:00:00Z");
  assert.equal(result.issues_found, 1);
  // One JWT still found by the backend, plus the agent's four.
  assert.deepEqual(result.redactions, { total: 5, by_kind: { url_password: 4, jwt: 1 } });
});

test("already-redacted evidence passes through unchanged", async () => {
  const evidence = unredactedEvidence();
  evidence.pods.problematic_pods[0].message = "DB_PASSWORD=[REDACTED:secret_assignment]";
  evidence.logs.logs[0].relevant_lines = ["ERROR auth failed [REDACTED:jwt]"];
  evidence.redactions = { total: 2, by_kind: { secret_assignment: 1, jwt: 1 } };

  const result = await runInvestigation(remoteSource(evidence));

  assert.equal(result.pods.problematic_pods[0].message, "DB_PASSWORD=[REDACTED:secret_assignment]");
  assert.deepEqual(result.redactions, { total: 2, by_kind: { secret_assignment: 1, jwt: 1 } });
});
