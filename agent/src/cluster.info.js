// Best-effort guess at what kind of cluster the agent landed in. Purely
// informational (shown in the UI); every failure here degrades to "unknown".

import { CoreV1Api, KubeConfig, VersionApi } from "@kubernetes/client-node";

// Node providerIDs name the platform reliably ("kind://", "aws://", ...),
// and unlike the kubeconfig context they exist inside a pod too.
const PROVIDER_PREFIXES = [
  ["kind://", "kind"],
  ["aws://", "eks"],
  ["gce://", "gke"],
  ["azure://", "aks"],
  ["k3s://", "k3s"],
];

function fromVersion(gitVersion = "") {
  const v = gitVersion.toLowerCase();
  if (v.includes("k3s")) return "k3s";
  if (v.includes("rke2")) return "rke2";
  if (v.includes("eks")) return "eks";
  if (v.includes("gke")) return "gke";
  return null;
}

export async function detectCluster(kubeconfig) {
  try {
    const config = new KubeConfig();
    if (kubeconfig) config.loadFromFile(kubeconfig);
    else config.loadFromCluster();

    const info = await config.makeApiClient(VersionApi).getCode();
    let distro = fromVersion(info.gitVersion);

    if (!distro) {
      try {
        const nodes = await config.makeApiClient(CoreV1Api).listNode({ limit: 1 });
        const providerId = nodes.items?.[0]?.spec?.providerID ?? "";
        distro = PROVIDER_PREFIXES.find(([prefix]) => providerId.startsWith(prefix))?.[1] ?? null;
      } catch {
        // No permission to list nodes, or no nodes yet -- not worth failing over.
      }
    }

    return { distro: distro ?? "kubernetes", kubernetes_version: info.gitVersion ?? null };
  } catch {
    return { distro: "unknown", kubernetes_version: null };
  }
}
