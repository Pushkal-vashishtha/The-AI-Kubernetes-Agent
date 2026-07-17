// Server-side InsForge admin client (full-access API key — keep server-only).
// Used for investigation history writes; RLS protects user reads on the frontend.

import { createAdminClient } from "@insforge/sdk";
import config from "./config.js";
import logger from "./logger.js";

let insforgeAdmin = null;

if (config.insforge.url && config.insforge.apiKey) {
  insforgeAdmin = createAdminClient({
    baseUrl: config.insforge.url,
    apiKey: config.insforge.apiKey,
  });
} else {
  logger.warn("INSFORGE_URL / INSFORGE_API_KEY not set — history and auth are disabled");
}

export default insforgeAdmin;
