import config from "../core/config.js";
import logger from "../core/logger.js";

/**
 * Require a valid InsForge user session.
 * The frontend sends its InsForge access token as: Authorization: Bearer <token>
 * We verify it against the InsForge auth API and attach req.user.
 */
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ status: "error", message: "Authentication required" });
  }

  if (!config.insforge.url) {
    return res.status(503).json({ status: "error", message: "InsForge is not configured on the backend" });
  }

  try {
    const response = await fetch(`${config.insforge.url}/api/auth/sessions/current`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      return res.status(401).json({ status: "error", message: "Invalid or expired session" });
    }

    const data = await response.json();
    const user = data.user ?? data;

    if (!user?.id) {
      return res.status(401).json({ status: "error", message: "Invalid session" });
    }

    req.user = { id: user.id, email: user.email ?? null };
    next();
  } catch (error) {
    logger.error(`Session verification failed: ${error.message}`);
    res.status(503).json({ status: "error", message: "Could not verify session" });
  }
}
