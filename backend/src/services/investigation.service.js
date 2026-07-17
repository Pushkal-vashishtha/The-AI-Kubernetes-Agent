import { inspectPods } from "../kubernetes/pod.inspector.js";
import { collectLogs } from "../kubernetes/logs.collector.js";
import { analyzeEvents } from "../kubernetes/events.analyzer.js";
import { inspectDeployments } from "../kubernetes/deployment.inspector.js";
import { inspectNetwork } from "../kubernetes/network.inspector.js";
import { analyzeClusterFindings } from "../ai/reasoner.js";
import logger from "../core/logger.js";

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
 * `onProgress(stepKey, status)` is awaited around each step so callers
 * can stream progress (e.g. into InsForge realtime). Defaults to a no-op.
 * `context` targets a specific kubeconfig context (default: current).
 */
export async function runInvestigation(onProgress = async () => {}, context = undefined) {
  logger.info(`Investigation started${context ? ` (context: ${context})` : ""}`);
  const startedAt = Date.now();

  await onProgress("pods", "running");
  const pods = await inspectPods(context);
  await onProgress("pods", "done");

  await onProgress("logs", "running");
  const logs = await collectLogs(pods.problematic_pods, context);
  await onProgress("logs", "done");

  await onProgress("events", "running");
  const events = await analyzeEvents(context);
  await onProgress("events", "done");

  await onProgress("deployments", "running");
  const deployments = await inspectDeployments(context);
  await onProgress("deployments", "done");

  await onProgress("network", "running");
  const network = await inspectNetwork(context);
  await onProgress("network", "done");

  const issuesFound =
    pods.problematic_pods.length +
    (events.findings?.length ?? 0) +
    (deployments.unhealthy_deployments?.length ?? 0) +
    (network.issues?.length ?? 0);

  const investigation = {
    collected_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
    cluster_context: context ?? null,
    cluster_reachable: pods.error === null,
    issues_found: issuesFound,
    pods,
    logs,
    events,
    deployments,
    network,
  };

  logger.info(
    `Investigation finished in ${investigation.duration_ms}ms — ${issuesFound} potential issue(s) found`,
  );

  return investigation;
}

/**
 * Full troubleshooting flow: collect evidence, then have the AI agent
 * reason about it like a Senior Kubernetes SRE.
 *
 *   Investigate -> AI reasoning -> root cause -> suggested fix -> diagnosis
 */
export async function investigateAndDiagnose(onProgress = async () => {}, context = undefined) {
  const investigation = await runInvestigation(onProgress, context);

  logger.info("AI reasoning started");
  const startedAt = Date.now();
  await onProgress("ai", "running");
  const { diagnosis, error } = await analyzeClusterFindings(investigation);
  await onProgress("ai", error ? "error" : "done");

  if (error) {
    logger.warn(`AI reasoning unavailable: ${error}`);
  } else {
    logger.info(
      `AI reasoning finished in ${Date.now() - startedAt}ms — confidence ${diagnosis.confidence}%`,
    );
  }

  return { investigation, diagnosis, ai_error: error };
}
