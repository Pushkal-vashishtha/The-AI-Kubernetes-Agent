import { collectEvidence, createRedactor, parseRedactPatterns } from "@aika/collector";
import { analyzeClusterFindings } from "../ai/reasoner.js";
import config from "../core/config.js";
import logger from "../core/logger.js";

// Built-in rules plus any AIKA_REDACT_PATTERNS, compiled once at startup.
const redactor = createRedactor({ extraPatterns: parseRedactPatterns(config.redactPatterns), logger });

// Re-exported so existing importers (routes, and anything that renders the
// step list) keep working unchanged.
export { INVESTIGATION_STEPS, buildInitialProgress } from "@aika/collector";

/**
 * Run the evidence-gathering flow against an evidence source.
 *
 * A source is a collector client: kubectl against a local kubeconfig today,
 * an in-cluster agent later. The inspectors -- and everything downstream of
 * them -- cannot tell the difference.
 */
/**
 * Evidence from an agent should already be redacted -- agents redact inside
 * the user's cluster -- but the backend must not depend on that. Agents run
 * whatever version was installed (0.1.0 predates redaction) and could be
 * modified. Redacting again is a no-op for clean text, so do it always.
 */
function redactAgentEvidence(investigation) {
  if (!investigation || typeof investigation !== "object") return investigation;

  const { pods, logs, events, deployments, network } = investigation;
  const { value, summary } = redactor.redact({ pods, logs, events, deployments, network });

  // Merge with whatever the agent reported, so the counts cover both passes.
  const byKind = { ...(investigation.redactions?.by_kind ?? {}) };
  for (const [kind, n] of Object.entries(summary.by_kind)) byKind[kind] = (byKind[kind] ?? 0) + n;
  if (summary.total) {
    logger.warn(`Backend redacted ${summary.total} secret(s) the agent had not -- is the agent out of date?`);
  }

  return {
    ...investigation,
    ...value,
    redactions: {
      total: (investigation.redactions?.total ?? 0) + summary.total,
      by_kind: byKind,
    },
  };
}

export async function runInvestigation(source, onProgress = async () => {}) {
  // Remote sources (an in-cluster agent) collect on their side and hand back
  // the finished evidence; local ones are a client we drive from here.
  if (typeof source.collect === "function") {
    return redactAgentEvidence(await source.collect(onProgress));
  }
  return collectEvidence(source, onProgress, { logger, redactor });
}

/**
 * Full troubleshooting flow: collect evidence, then have the AI agent
 * reason about it like a Senior Kubernetes SRE.
 *
 *   Investigate -> AI reasoning -> root cause -> suggested fix -> diagnosis
 */
export async function investigateAndDiagnose(source, onProgress = async () => {}) {
  const investigation = await runInvestigation(source, onProgress);

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
