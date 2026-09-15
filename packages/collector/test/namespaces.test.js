// Run: node --test packages/collector/test/namespaces.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { collectEvidence, inspectNetwork, listAcrossNamespaces, parseNamespaces } from "../src/index.js";

test("parseNamespaces: empty means cluster-wide", () => {
  assert.equal(parseNamespaces(undefined), null);
  assert.equal(parseNamespaces(""), null);
  assert.equal(parseNamespaces("  , "), null);
});

test("parseNamespaces: splits, dedupes and sorts", () => {
  assert.deepEqual(parseNamespaces("shop, payments shop"), ["payments", "shop"]);
  assert.deepEqual(parseNamespaces(["b", "a"]), ["a", "b"]);
});

test("parseNamespaces: rejects names Kubernetes would", () => {
  for (const bad of ["Shop", "-shop", "shop-", "a_b", "x".repeat(64), "../etc"]) {
    assert.throws(() => parseNamespaces(bad), /invalid namespace/, bad);
  }
});

const ok = (items) => ({ success: true, data: { items }, error: null });

test("listAcrossNamespaces merges items in namespace order", async () => {
  const result = await listAcrossNamespaces(["a", "b"], async (ns) => ok([{ ns, i: 1 }, { ns, i: 2 }]));
  assert.equal(result.success, true);
  assert.deepEqual(
    result.data.items.map((item) => item.ns),
    ["a", "a", "b", "b"],
  );
});

test("listAcrossNamespaces fails if any namespace fails", async () => {
  const result = await listAcrossNamespaces(["a", "b"], async (ns) =>
    ns === "b" ? { success: false, data: null, error: "forbidden in b" } : ok([{}]),
  );
  assert.deepEqual(result, { success: false, data: null, error: "forbidden in b" });
});

function fakeClient(namespaces) {
  const service = { metadata: { name: "web", namespace: "shop" }, spec: { selector: { app: "web" } } };
  const endpoints = {
    metadata: { name: "web", namespace: "shop" },
    subsets: [{ addresses: [{ ip: "10.0.0.1" }] }],
  };
  return {
    kind: "fake",
    context: null,
    namespaces,
    listPods: async () => ok([]),
    listEvents: async () => ok([]),
    listDeployments: async () => ok([]),
    listServices: async () => ok([service]),
    listEndpoints: async () => ok([endpoints]),
    podLogs: async () => ({ success: true, stdout: "", stderr: "", error: null }),
  };
}

test("scoped network check does not report DNS down when kube-system is out of scope", async () => {
  const network = await inspectNetwork(fakeClient(["shop"]));
  assert.equal(network.dns.healthy, null);
  assert.match(network.dns.detail, /not checked/);
  assert.equal(network.healthy, true);
});

test("unscoped network check still flags missing DNS", async () => {
  const network = await inspectNetwork(fakeClient(null));
  assert.equal(network.dns.healthy, false);
  assert.equal(network.healthy, false);
});

test("evidence records its scope", async () => {
  assert.deepEqual((await collectEvidence(fakeClient(["shop"]))).namespaces, ["shop"]);
  assert.equal((await collectEvidence(fakeClient(null))).namespaces, null);
});
