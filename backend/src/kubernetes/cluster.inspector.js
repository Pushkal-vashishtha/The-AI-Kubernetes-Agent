import { runKubectlJson } from "./kubectl.executor.js";

/**
 * List every cluster context available in the local kubeconfig, so the
 * user can pick which cluster to investigate.
 */
export async function listClusters() {
  const result = await runKubectlJson(["config", "view"]);

  if (!result.success) {
    return { clusters: [], current_context: null, error: result.error };
  }

  const current = result.data["current-context"] || null;
  const clusters = (result.data.contexts ?? []).map((entry) => ({
    context: entry.name,
    cluster: entry.context?.cluster ?? "",
    current: entry.name === current,
  }));

  return { clusters, current_context: current, error: null };
}
