import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import logger from "../core/logger.js";

const router = Router();

// install/ sits at the repo root, both in a checkout and in the image.
const SCRIPT_PATH = fileURLToPath(new URL("../../../install/install.sh", import.meta.url));

// Whatever we substitute ends up inside a shell script that people pipe
// straight into bash, so the origin is validated strictly -- anything that is
// not plainly a hostname (optionally with a port) leaves the default empty
// and the script asks for --server instead.
const HOST_PATTERN = /^[A-Za-z0-9.-]+(:\d{1,5})?$/;

function publicOrigin(req) {
  // Behind Caddy these arrive as X-Forwarded-*; `trust proxy` is not enabled,
  // so read them directly and validate rather than trusting them blindly.
  const proto = (req.get("x-forwarded-proto") ?? req.protocol ?? "").split(",")[0].trim();
  const host = (req.get("x-forwarded-host") ?? req.get("host") ?? "").split(",")[0].trim();

  if (!["http", "https"].includes(proto) || !HOST_PATTERN.test(host)) return "";
  return `${proto}://${host}`;
}

router.get("/install.sh", async (req, res) => {
  try {
    const script = await readFile(SCRIPT_PATH, "utf8");
    res
      .type("text/x-shellscript")
      .set("Cache-Control", "no-store")
      .send(script.replace("__AIKA_DEFAULT_SERVER__", publicOrigin(req)));
  } catch (error) {
    logger.error(`Could not serve install.sh: ${error.message}`);
    res.status(500).type("text/plain").send("echo 'install script unavailable' >&2; exit 1\n");
  }
});

export default router;
