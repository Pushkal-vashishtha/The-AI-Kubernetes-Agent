// Kubeconfig inspection for local clusters. This is a property of the
// machine the backend runs on, not of a cluster's evidence, so it stays in
// the backend rather than moving into @aika/collector.

import { runKubectlJson } from "@aika/collector";
import config from "../core/config.js";
import logger from "../core/logger.js";

/**
 * List every cluster context available in the local kubeconfig, so local
 * clusters can be registered to their owner at boot.
 */
export async function listClusters() {
  const result = await runKubectlJson(["config", "view"], {
    kubeconfigPath: config.kubeconfigPath,
    logger,
  });

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
