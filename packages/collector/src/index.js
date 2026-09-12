// Evidence collection for the AI Kubernetes Agent.
//
// This package is deliberately free of Express, InsForge and AI concerns: it
// takes a client, walks a cluster, and returns an evidence object. The
// backend runs it against a kubeconfig; the in-cluster agent runs the exact
// same code against a ServiceAccount. Same code, same evidence shape, so the
// reasoning layer never learns where the evidence came from.

import { inspectPods } from "./inspectors/pod.inspector.js";
import { collectLogs } from "./inspectors/logs.collector.js";
import { analyzeEvents } from "./inspectors/events.analyzer.js";
import { inspectDeployments } from "./inspectors/deployment.inspector.js";
import { inspectNetwork } from "./inspectors/network.inspector.js";

export { createKubectlClient, runKubectl, runKubectlJson } from "./client.kubectl.js";
export { inspectPods, collectLogs, analyzeEvents, inspectDeployments, inspectNetwork };

// The API client pulls in @kubernetes/client-node, so it is imported lazily:
// the backend's local path should not pay for a dependency it never uses.
export async function createApiClient(options) {
  const { createApiClient: create } = await import("./client.api.js");
  return create(options);
}

// The steps a run walks through, in order. The frontend renders this list.
export const INVESTIGATION_STEPS = [
  { key: "pods", label: "Checking Pods" },
  { key: "logs", label: "Reading Logs" },
  { key: "events", label: "Analyzing Events" },
  { key: "deployments", label: "Inspecting Deployments" },
  { key: "network", label: "Checking Networking" },
  { key: "ai", label: "AI Reasoning" },
];

export function buildInitialProgress() {
  return INVESTIGATION_STEPS.map((step) => ({ ...step, status: "pending" }));
}

/**
 * Run the evidence-gathering flow, like a junior DevOps engineer
 * collecting facts before anyone starts reasoning about root cause.
 *
 * `onProgress(stepKey, status)` is awaited around each step so callers can
 * stream progress (e.g. into InsForge realtime). Defaults to a no-op.
 */
export async function collectEvidence(client, onProgress = async () => {}, { logger } = {}) {
  logger?.info(`Investigation started${client.context ? ` (context: ${client.context})` : ""}`);
  const startedAt = Date.now();

  await onProgress("pods", "running");
  const pods = await inspectPods(client);
  await onProgress("pods", "done");

  await onProgress("logs", "running");
  const logs = await collectLogs(client, pods.problematic_pods);
  await onProgress("logs", "done");

  await onProgress("events", "running");
  const events = await analyzeEvents(client);
  await onProgress("events", "done");

  await onProgress("deployments", "running");
  const deployments = await inspectDeployments(client);
  await onProgress("deployments", "done");

  await onProgress("network", "running");
  const network = await inspectNetwork(client);
  await onProgress("network", "done");

  const issuesFound =
    pods.problematic_pods.length +
    (events.findings?.length ?? 0) +
    (deployments.unhealthy_deployments?.length ?? 0) +
    (network.issues?.length ?? 0);

  const investigation = {
    collected_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
    cluster_context: client.context ?? null,
    cluster_reachable: pods.error === null,
    issues_found: issuesFound,
    pods,
    logs,
    events,
    deployments,
    network,
  };

  logger?.info(
    `Investigation finished in ${investigation.duration_ms}ms — ${issuesFound} potential issue(s) found`,
  );

  return investigation;
}
