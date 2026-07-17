import { runKubectlJson } from "./kubectl.executor.js";

function findCondition(deployment, type) {
  return (deployment.status?.conditions ?? []).find((c) => c.type === type);
}

function detectIssues(deployment) {
  const issues = [];

  const desired = deployment.spec?.replicas ?? 1;
  const available = deployment.status?.availableReplicas ?? 0;
  const unavailable = deployment.status?.unavailableReplicas ?? 0;

  if (available < desired) {
    issues.push(`Only ${available}/${desired} replicas are available`);
  }

  const availableCond = findCondition(deployment, "Available");
  if (availableCond?.status === "False") {
    issues.push(`Not available: ${availableCond.reason ?? "unknown reason"}`);
  }

  // Progressing=False means the rollout gave up (e.g. ProgressDeadlineExceeded).
  const progressingCond = findCondition(deployment, "Progressing");
  if (progressingCond?.status === "False") {
    issues.push(`Rollout failed: ${progressingCond.reason ?? "unknown reason"}`);
  }

  return { issues, desired, available, unavailable };
}

/**
 * Inspect all deployments and flag the ones that are not fully healthy.
 */
export async function inspectDeployments(context) {
  const result = await runKubectlJson(["get", "deployments", "-A"], { context });

  if (!result.success) {
    return { healthy: null, total_deployments: 0, unhealthy_deployments: [], error: result.error };
  }

  const deployments = result.data.items ?? [];
  const unhealthy = [];

  for (const deployment of deployments) {
    const { issues, desired, available, unavailable } = detectIssues(deployment);
    if (issues.length === 0) continue;

    unhealthy.push({
      name: deployment.metadata?.name ?? "unknown",
      namespace: deployment.metadata?.namespace ?? "default",
      desired_replicas: desired,
      available_replicas: available,
      unavailable_replicas: unavailable,
      issues,
      conditions: (deployment.status?.conditions ?? []).map((c) => ({
        type: c.type,
        status: c.status,
        reason: c.reason ?? "",
        message: c.message ?? "",
      })),
    });
  }

  return {
    healthy: unhealthy.length === 0,
    total_deployments: deployments.length,
    unhealthy_deployments: unhealthy,
    error: null,
  };
}
