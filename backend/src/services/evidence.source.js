// Where a cluster's evidence comes from.
//
// Local clusters are collected here, by running kubectl against a kubeconfig
// on this machine. Agent-backed clusters are collected by an agent running
// inside the user's cluster, which dialed out to us; the evidence it sends
// back has exactly the same shape, so nothing downstream can tell.

import { createKubectlClient } from "@aika/collector";
import { isAgentConnected, requestEvidence } from "../agents/hub.js";
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
 * A source whose collection happens elsewhere. Instead of client methods it
 * exposes `collect(onProgress)`, which investigation.service prefers.
 */
export function remoteAgentSource(cluster) {
  return {
    kind: "agent",
    context: null,
    collect: (onProgress) => requestEvidence(cluster.id, onProgress),
  };
}

function describeLastSeen(lastSeenAt) {
  if (!lastSeenAt) return "it has never connected -- was the install command run?";
  const minutes = Math.round((Date.now() - new Date(lastSeenAt).getTime()) / 60_000);
  if (minutes < 1) return "it was last seen under a minute ago";
  if (minutes < 120) return `it was last seen ${minutes} minute(s) ago`;
  return `it was last seen ${new Date(lastSeenAt).toUTCString()}`;
}

/**
 * Build the evidence source for a cluster row, or explain why we cannot.
 * Returns { source } or { error: { code, message } }.
 */
export function sourceForCluster(cluster) {
  if (cluster.mode === "local") {
    return { source: localKubectlSource(cluster.context ?? undefined) };
  }

  // Checked up front so an offline agent is a clear, immediate answer rather
  // than a history row that sits "running" until a timeout.
  if (!isAgentConnected(cluster.id)) {
    return {
      error: {
        code: 503,
        message: `The agent for "${cluster.name}" is offline; ${describeLastSeen(cluster.last_seen_at)}`,
      },
    };
  }

  return { source: remoteAgentSource(cluster) };
}
