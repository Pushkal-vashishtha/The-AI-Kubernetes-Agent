// Cluster access by shelling out to kubectl, against a kubeconfig on this
// machine. This is the original code path: the backend uses it for local
// clusters and for the dev loop.

import { execFile } from "node:child_process";

const KUBECTL_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

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
 */
function runKubectl(args, { context, kubeconfigPath, logger } = {}) {
  const fullArgs = context ? ["--context", context, ...args] : args;
  const env = { ...process.env };
  if (kubeconfigPath) env.KUBECONFIG = kubeconfigPath;

  return new Promise((resolve) => {
    logger?.info(`kubectl ${fullArgs.join(" ")}`);

    execFile(
      "kubectl",
      fullArgs,
      {
        timeout: KUBECTL_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        env,
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

          logger?.warn(`kubectl failed: ${reason}`);
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

async function runKubectlJson(args, options) {
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

/**
 * A collector client backed by the kubectl binary.
 * `context` selects a kubeconfig context; omitted, kubectl uses the current one.
 */
export function createKubectlClient({ context, kubeconfigPath, logger } = {}) {
  const options = { context, kubeconfigPath, logger };
  const list = (resource) => runKubectlJson(["get", resource, "-A"], options);

  return {
    kind: "kubectl",
    context: context ?? null,

    listPods: () => list("pods"),
    listEvents: () => list("events"),
    listDeployments: () => list("deployments"),
    listServices: () => list("svc"),
    listEndpoints: () => list("endpoints"),

    podLogs: ({ name, namespace, tailLines, allContainers = true, previous = false }) => {
      const args = ["logs", name, "-n", namespace, "--tail", String(tailLines)];
      if (allContainers) args.push("--all-containers");
      if (previous) args.push("--previous");
      return runKubectl(args, options);
    },
  };
}

// Exported for the cluster picker, which is a kubeconfig concern rather than
// a collection one.
export { runKubectl, runKubectlJson };
