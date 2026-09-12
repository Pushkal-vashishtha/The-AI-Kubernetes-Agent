import "dotenv/config";

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
  insforge: {
    url: process.env.INSFORGE_URL || "",
    apiKey: process.env.INSFORGE_API_KEY || "",
  },
};

export default config;
