// Where a cluster's evidence comes from.
//
// Local clusters are collected by running kubectl against a kubeconfig on
// this machine. Agent-backed clusters will be collected by an agent running
// inside the user's cluster, which dials out to us -- that source lands in a
// later phase, and only this module changes when it does.

import { createKubectlClient } from "@aika/collector";
import config from "../core/config.js";
import logger from "../core/logger.js";

export function localKubectlSource(context) {
  return createKubectlClient({
    context,
    kubeconfigPath: config.kubeconfigPath,
    logger,
  });
}

/**
 * Build the evidence source for a cluster row, or explain why we cannot.
 * Returns { source } or { error: { code, message } }.
 */
export function sourceForCluster(cluster) {
  if (cluster.mode === "local") {
    return { source: localKubectlSource(cluster.context ?? undefined) };
  }

  return {
    error: {
      code: 501,
      message: `Cluster "${cluster.name}" is agent-based; remote collection is not enabled yet.`,
    },
  };
}
