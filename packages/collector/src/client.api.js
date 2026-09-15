// Cluster access through the Kubernetes API, using the ServiceAccount
// credentials mounted into a pod. This is what the in-cluster agent uses:
// no kubectl binary to ship, no version skew to manage.
//
// Both clients return the same shapes as `client.kubectl.js` -- raw API
// objects under `data.items` -- so the inspectors cannot tell them apart.

import { CoreV1Api, AppsV1Api, KubeConfig } from "@kubernetes/client-node";
import { listAcrossNamespaces, parseNamespaces } from "./namespaces.js";

/**
 * Turn any client-node failure into the { success, error } shape.
 *
 * client-node surfaces API errors as a wall of text (status line, raw JSON
 * body, every response header). kubectl prints just the server's message, and
 * that message is evidence the model reads -- so dig the message out and
 * match kubectl's phrasing, including its "Error from server (Reason):" form.
 */
function failure(error) {
  const body = error?.body ?? error?.response?.body;
  const parsed =
    typeof body === "string"
      ? (() => {
          try {
            return JSON.parse(body);
          } catch {
            return null;
          }
        })()
      : body;

  if (parsed?.message) {
    return {
      success: false,
      data: null,
      error: parsed.reason
        ? `Error from server (${parsed.reason}): ${parsed.message}`
        : parsed.message,
    };
  }

  // A bare network failure (API server unreachable) has no body at all.
  return {
    success: false,
    data: null,
    error: error?.message ?? "Kubernetes API request failed",
  };
}

/**
 * client-node parses RFC3339 timestamps into Date objects, which JSON
 * serializes with milliseconds ("...:27.000Z"); kubectl leaves them as the
 * API wrote them ("...:27Z"). The evidence must not depend on which client
 * collected it, so put the strings back the way Kubernetes sent them.
 */
function normalizeDates(value) {
  if (value instanceof Date) {
    return value.toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  if (Array.isArray(value)) {
    return value.map(normalizeDates);
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      value[key] = normalizeDates(value[key]);
    }
  }
  return value;
}

/**
 * A collector client backed by the Kubernetes API.
 *
 * Loads in-cluster credentials by default (the ServiceAccount token and CA
 * mounted at /var/run/secrets/...); pass `kubeconfig` to point it elsewhere,
 * which is only useful for testing the agent outside a cluster.
 */
export function createApiClient({ kubeconfig, logger, namespaces } = {}) {
  const config = new KubeConfig();
  if (kubeconfig) {
    config.loadFromFile(kubeconfig);
  } else {
    config.loadFromCluster();
  }

  const core = config.makeApiClient(CoreV1Api);
  const apps = config.makeApiClient(AppsV1Api);

  const call = async (label, fn) => {
    logger?.info(`k8s api ${label}`);
    try {
      const data = normalizeDates(await fn());
      return { success: true, data, error: null };
    } catch (error) {
      const result = failure(error);
      logger?.warn(`k8s api ${label} failed: ${result.error}`);
      return result;
    }
  };

  const scope = parseNamespaces(namespaces);
  // Cluster-wide when unscoped; one namespaced call per namespace otherwise,
  // since a Role-only ServiceAccount is forbidden from the *ForAllNamespaces calls.
  const list = (label, allNamespaces, oneNamespace) =>
    scope
      ? listAcrossNamespaces(scope, (namespace) =>
          call(`${label} -n ${namespace}`, () => oneNamespace({ namespace })),
        )
      : call(label, allNamespaces);

  return {
    kind: "api",
    context: null,
    namespaces: scope,

    listPods: () =>
      list("list pods", () => core.listPodForAllNamespaces(), (a) => core.listNamespacedPod(a)),
    listEvents: () =>
      list("list events", () => core.listEventForAllNamespaces(), (a) => core.listNamespacedEvent(a)),
    listDeployments: () =>
      list(
        "list deployments",
        () => apps.listDeploymentForAllNamespaces(),
        (a) => apps.listNamespacedDeployment(a),
      ),
    listServices: () =>
      list("list services", () => core.listServiceForAllNamespaces(), (a) => core.listNamespacedService(a)),
    listEndpoints: () =>
      list(
        "list endpoints",
        () => core.listEndpointsForAllNamespaces(),
        (a) => core.listNamespacedEndpoints(a),
      ),

    podLogs: async ({ name, namespace, tailLines, previous = false }) => {
      // The API reads one container at a time; kubectl's --all-containers has
      // no equivalent, so the default container's log is what we get.
      const result = await call("read pod logs", () =>
        core.readNamespacedPodLog({
          name,
          namespace,
          tailLines,
          previous,
        }),
      );

      if (!result.success) {
        return { success: false, stdout: "", stderr: "", error: result.error };
      }

      const body = typeof result.data === "string" ? result.data : (result.data?.body ?? "");
      return { success: true, stdout: body.trim(), stderr: "", error: null };
    },
  };
}
