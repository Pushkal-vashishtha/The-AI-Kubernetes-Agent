import { runKubectlJson } from "./kubectl.executor.js";

function endpointsKey(namespace, name) {
  return `${namespace}/${name}`;
}

function summarizeEndpoints(endpoints) {
  let ready = 0;
  let notReady = 0;
  for (const subset of endpoints.subsets ?? []) {
    ready += (subset.addresses ?? []).length;
    notReady += (subset.notReadyAddresses ?? []).length;
  }
  return { ready, notReady };
}

/**
 * Inspect services, their endpoints, and cluster DNS.
 */
export async function inspectNetwork(context) {
  const [svcResult, epResult] = await Promise.all([
    runKubectlJson(["get", "svc", "-A"], { context }),
    runKubectlJson(["get", "endpoints", "-A"], { context }),
  ]);

  if (!svcResult.success) {
    return { healthy: null, total_services: 0, issues: [], dns: null, error: svcResult.error };
  }

  const services = svcResult.data.items ?? [];

  // Map endpoints by namespace/name so each service lookup is O(1).
  const endpointsByService = new Map();
  if (epResult.success) {
    for (const endpoints of epResult.data.items ?? []) {
      endpointsByService.set(
        endpointsKey(endpoints.metadata?.namespace ?? "", endpoints.metadata?.name ?? ""),
        summarizeEndpoints(endpoints),
      );
    }
  }

  const issues = [];

  for (const service of services) {
    const name = service.metadata?.name ?? "unknown";
    const namespace = service.metadata?.namespace ?? "default";
    const type = service.spec?.type ?? "ClusterIP";

    // ExternalName services have no endpoints by design.
    if (type === "ExternalName") continue;

    // Services without a selector manage endpoints manually — skip those too.
    const selector = service.spec?.selector;
    if (!selector || Object.keys(selector).length === 0) continue;

    const endpoints = endpointsByService.get(endpointsKey(namespace, name));

    if (!endpoints || (endpoints.ready === 0 && endpoints.notReady === 0)) {
      issues.push({
        service: name,
        namespace,
        issue: "no_matching_pods",
        detail: "Service has a selector but no pods match it — likely a selector/label mismatch",
      });
    } else if (endpoints.ready === 0) {
      issues.push({
        service: name,
        namespace,
        issue: "no_ready_endpoints",
        detail: `Pods match the selector but none are ready (${endpoints.notReady} not ready)`,
      });
    }
  }

  // DNS health: kube-dns / CoreDNS must have ready endpoints for cluster DNS to work.
  const dnsEndpoints =
    endpointsByService.get(endpointsKey("kube-system", "kube-dns")) ??
    endpointsByService.get(endpointsKey("kube-system", "coredns"));

  const dns = {
    healthy: Boolean(dnsEndpoints && dnsEndpoints.ready > 0),
    detail:
      dnsEndpoints && dnsEndpoints.ready > 0
        ? `Cluster DNS is up (${dnsEndpoints.ready} ready endpoint(s))`
        : "Cluster DNS has no ready endpoints — in-cluster name resolution will fail",
  };

  return {
    healthy: issues.length === 0 && dns.healthy,
    total_services: services.length,
    issues,
    dns,
    error: null,
  };
}
