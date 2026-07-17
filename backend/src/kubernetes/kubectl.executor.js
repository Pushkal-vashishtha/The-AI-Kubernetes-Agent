import { execFile } from "node:child_process";
import config from "../core/config.js";
import logger from "../core/logger.js";

const KUBECTL_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

function buildEnv() {
  const env = { ...process.env };
  if (config.kubeconfigPath) {
    env.KUBECONFIG = config.kubeconfigPath;
  }
  return env;
}

// kubectl prefixes failures with repeated klog noise lines; the last
// non-empty line is its human-readable summary.
function extractReason(stderr, fallback) {
  const lines = (stderr || fallback || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1) ?? "kubectl failed";
}

/**
 * Run a kubectl command safely.
 *
 * Arguments are passed as a list (no shell involved), so user-controlled
 * values cannot inject extra commands. Never throws — always resolves to:
 *   { success, stdout, stderr, error }
 *
 * Pass `{ context }` to target a specific kubeconfig context; omitted,
 * kubectl uses the kubeconfig's current context.
 */
export function runKubectl(args, { context } = {}) {
  const fullArgs = context ? ["--context", context, ...args] : args;

  return new Promise((resolve) => {
    logger.info(`kubectl ${fullArgs.join(" ")}`);

    execFile(
      "kubectl",
      fullArgs,
      {
        timeout: KUBECTL_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        env: buildEnv(),
        windowsHide: true,
      },
      (error, stdout = "", stderr = "") => {
        if (error) {
          const reason =
            error.code === "ENOENT"
              ? "kubectl binary not found on PATH"
              : error.killed
                ? `kubectl timed out after ${KUBECTL_TIMEOUT_MS / 1000}s`
                : extractReason(stderr, error.message);

          logger.warn(`kubectl failed: ${reason}`);
          resolve({
            success: false,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            error: reason,
          });
          return;
        }

        resolve({
          success: true,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          error: null,
        });
      },
    );
  });
}

/**
 * Run a kubectl command with `-o json` and parse the output.
 * Resolves to: { success, data, error }
 */
export async function runKubectlJson(args, options = {}) {
  const result = await runKubectl([...args, "-o", "json"], options);

  if (!result.success) {
    return { success: false, data: null, error: result.error };
  }

  try {
    return { success: true, data: JSON.parse(result.stdout), error: null };
  } catch {
    return { success: false, data: null, error: "kubectl returned invalid JSON" };
  }
}
