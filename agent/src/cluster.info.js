// Best-effort guess at what kind of cluster the agent landed in. Purely
// informational (shown in the UI); every failure here degrades to "unknown".

import { KubeConfig, VersionApi } from "@kubernetes/client-node";

function guessDistro(gitVersion = "") {
  const v = gitVersion.toLowerCase();
  if (v.includes("k3s")) return "k3s";
  if (v.includes("rke2")) return "rke2";
  if (v.includes("eks")) return "eks";
  if (v.includes("gke")) return "gke";
  return "kubernetes";
}

export async function detectCluster(kubeconfig) {
  try {
    const config = new KubeConfig();
    if (kubeconfig) config.loadFromFile(kubeconfig);
    else config.loadFromCluster();

    const info = await config.makeApiClient(VersionApi).getCode();
    const server = config.getCurrentCluster()?.server ?? "";

    let distro = guessDistro(info.gitVersion);
    // kind and AKS do not mark their version string; their endpoints and
    // node names give them away instead.
    if (distro === "kubernetes" && /azmk8s\.io/.test(server)) distro = "aks";
    if (distro === "kubernetes" && (config.getCurrentContext() ?? "").startsWith("kind-")) {
      distro = "kind";
    }

    return { distro, kubernetes_version: info.gitVersion ?? null };
  } catch {
    return { distro: "unknown", kubernetes_version: null };
  }
}
