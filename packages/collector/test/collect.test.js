// Run: node --test packages/collector/test/collect.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { collectEvidence, EVIDENCE_LIST_CAP } from "../src/index.js";

// Minimal pod that the pod inspector flags as crash-looping.
function crashingPod(i) {
  return {
    metadata: { name: `api-${i}`, namespace: "shop" },
    status: {
      phase: "Running",
      containerStatuses: [
        {
          name: "api",
          restartCount: 5,
          state: { waiting: { reason: "CrashLoopBackOff", message: `back-off restarting api-${i}` } },
        },
      ],
    },
  };
}

// A fake collector client: every call succeeds with canned data.
function fakeClient({ pods = [] } = {}) {
  const ok = (items) => Promise.resolve({ success: true, data: { items }, error: null });
  return {
    kind: "fake",
    context: null,
    listPods: () => ok(pods),
    listEvents: () => ok([]),
    listDeployments: () => ok([]),
    listServices: () => ok([]),
    listEndpoints: () => ok([]),
    podLogs: () => Promise.resolve({ success: true, stdout: "", stderr: "", error: null }),
  };
}

test("caps long lists but keeps the counts exact", async () => {
  const pods = Array.from({ length: 30 }, (_, i) => crashingPod(i));
  const evidence = await collectEvidence(fakeClient({ pods }));

  assert.equal(evidence.pods.total_pods, 30);
  assert.equal(evidence.pods.problematic_pods.length, EVIDENCE_LIST_CAP);
  assert.deepEqual(evidence.truncation, { problematic_pods: { shown: EVIDENCE_LIST_CAP, total: 30 } });
  // issues_found is computed before capping, so it still counts all 30.
  assert.ok(evidence.issues_found >= 30, `issues_found=${evidence.issues_found}`);
});

test("reports no truncation when everything fits", async () => {
  const pods = Array.from({ length: 3 }, (_, i) => crashingPod(i));
  const evidence = await collectEvidence(fakeClient({ pods }));

  assert.equal(evidence.pods.problematic_pods.length, 3);
  assert.deepEqual(evidence.truncation, {});
});

test("still redacts, and capping does not bypass it", async () => {
  const pod = crashingPod(0);
  pod.status.containerStatuses[0].state.waiting.message = "DB_PASSWORD=hunter2hunter2";
  const evidence = await collectEvidence(fakeClient({ pods: [pod] }));

  assert.ok(!JSON.stringify(evidence).includes("hunter2hunter2"));
  assert.equal(evidence.redactions.total, 1);
});
