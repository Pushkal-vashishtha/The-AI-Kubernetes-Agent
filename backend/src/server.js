import app from "./app.js";
import config from "./core/config.js";
import logger from "./core/logger.js";
import { syncLocalClusters } from "./services/cluster.service.js";

app.listen(config.port, async () => {
  logger.info(`ai-kubernetes-agent backend listening on port ${config.port}`);

  // Register this machine's kubeconfig contexts for the local operator, if
  // one is configured. Best-effort: never block or crash startup.
  try {
    await syncLocalClusters();
  } catch (error) {
    logger.warn(`Local cluster sync failed: ${error.message}`);
  }
});
