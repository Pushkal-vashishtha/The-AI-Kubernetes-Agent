import app from "./app.js";
import config from "./core/config.js";
import logger from "./core/logger.js";

app.listen(config.port, () => {
  logger.info(`ai-kubernetes-agent backend listening on port ${config.port}`);
});
