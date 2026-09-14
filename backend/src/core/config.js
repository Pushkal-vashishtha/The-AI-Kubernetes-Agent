import "dotenv/config";
import os from "node:os";

const config = {
  port: Number(process.env.PORT) || 8000,
  openRouter: {
    apiKey: process.env.OPENROUTER_API_KEY || "",
    model: process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.5",
  },
  kubeconfigPath: process.env.KUBECONFIG_PATH || "",
  // Local mode: kubeconfig contexts on this machine are registered as clusters
  // owned by this user id (dev loop + the single-operator demo deployment).
  // Unset in a real multi-tenant deployment -- every other user enrols their
  // own cluster with an agent instead.
  localClusterOwner: process.env.LOCAL_CLUSTER_OWNER || "",
  // Which backend registered a local cluster. Only that backend holds the
  // kubeconfig, so only it can investigate the cluster -- and only it may
  // mark the cluster online or offline. Defaults to the machine's hostname;
  // set it explicitly if hostnames change (containers, rebuilt instances).
  localClusterHost: process.env.LOCAL_CLUSTER_HOST || os.hostname(),
  // Extra evidence redaction rules for locally collected clusters (agents read
  // the same variable in their own pod). JSON array or one regex per line.
  redactPatterns: process.env.AIKA_REDACT_PATTERNS || "",
  // Per-user investigation limit: each one is a paid LLM call on a shared key.
  investigateMaxPerHour: Number(process.env.INVESTIGATE_MAX_PER_HOUR) || 20,
  insforge: {
    url: process.env.INSFORGE_URL || "",
    apiKey: process.env.INSFORGE_API_KEY || "",
  },
};

export default config;
