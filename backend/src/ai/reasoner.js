// AI Kubernetes Agent: turns investigation evidence into a diagnosis
// (root cause + explanation + fix + kubectl commands + prevention + confidence).

import config from "../core/config.js";
import logger from "../core/logger.js";
import { buildTroubleshootingPrompt } from "./prompt.builder.js";
import { chatCompletion } from "./llm.client.js";

function clampConfidence(value) {
  // Accept 92, "92", or "92%" and clamp to 0-100.
  const number = Number(String(value).replace("%", "").trim());
  if (Number.isNaN(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function asStringArray(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.trim() !== "") return [value];
  return [];
}

// The model is instructed to return bare JSON, but strip markdown fences
// defensively in case it wraps the response anyway.
function parseDiagnosis(content) {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }

  return {
    root_cause: String(parsed.root_cause ?? "Unknown"),
    explanation: String(parsed.explanation ?? ""),
    fix: String(parsed.fix ?? ""),
    kubectl_commands: asStringArray(parsed.kubectl_commands),
    prevention: String(parsed.prevention ?? ""),
    confidence: clampConfidence(parsed.confidence),
    confidence_reasoning: String(parsed.confidence_reasoning ?? ""),
  };
}

// When kubectl itself failed there is nothing for the LLM to reason about —
// return a deterministic diagnosis instead of burning an API call.
function unreachableClusterDiagnosis(investigation) {
  return {
    root_cause: "Kubernetes cluster is unreachable from the backend",
    explanation:
      `kubectl could not contact the API server (${investigation.pods.error ?? "unknown error"}). ` +
      "No workload evidence could be collected, so this is an infrastructure/connectivity problem, " +
      "not an application failure.",
    fix:
      "Verify the backend has a valid kubeconfig and network access to the cluster API server. " +
      "If running the backend in Docker, mount a kubeconfig whose server address is reachable from inside the container.",
    kubectl_commands: ["kubectl cluster-info", "kubectl config current-context", "kubectl get nodes"],
    prevention: "Monitor API server reachability from wherever the backend runs, and alert on kubeconfig expiry.",
    confidence: 95,
    confidence_reasoning:
      "Every kubectl command failed with a connection error, which unambiguously indicates the cluster is unreachable.",
    source: "rule",
    model: null,
  };
}

/**
 * Analyze investigation evidence like a Senior Kubernetes SRE.
 * Never throws — resolves to { diagnosis, error }.
 */
export async function analyzeClusterFindings(investigation) {
  if (!config.openRouter.apiKey) {
    return { diagnosis: null, error: "OPENROUTER_API_KEY is not configured" };
  }

  if (!investigation.cluster_reachable) {
    return { diagnosis: unreachableClusterDiagnosis(investigation), error: null };
  }

  const prompts = buildTroubleshootingPrompt(investigation);
  const completion = await chatCompletion(prompts);

  if (!completion.success) {
    return { diagnosis: null, error: completion.error };
  }

  const diagnosis = parseDiagnosis(completion.content);
  if (!diagnosis) {
    logger.error("LLM response was not valid diagnosis JSON");
    return { diagnosis: null, error: "AI returned a response that could not be parsed as a diagnosis" };
  }

  return { diagnosis: { ...diagnosis, source: "llm", model: completion.model }, error: null };
}
