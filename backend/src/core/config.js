import "dotenv/config";

const config = {
  port: Number(process.env.PORT) || 8000,
  openRouter: {
    apiKey: process.env.OPENROUTER_API_KEY || "",
    model: process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.5",
  },
  kubeconfigPath: process.env.KUBECONFIG_PATH || "",
  insforge: {
    url: process.env.INSFORGE_URL || "",
    apiKey: process.env.INSFORGE_API_KEY || "",
  },
};

export default config;
