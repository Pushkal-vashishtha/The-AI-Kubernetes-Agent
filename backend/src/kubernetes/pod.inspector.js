import { runKubectlJson } from "./kubectl.executor.js";

// Waiting reasons that always indicate a problem.
const PROBLEM_WAITING_REASONS = [
  "CrashLoopBackOff",
  "ImagePullBackOff",
  "ErrImagePull",
  "InvalidImageName",
  "CreateContainerConfigError",
  "CreateContainerError",
  "RunContainerError",
];

// How long a pod may sit in Pending / ContainerCreating before we call it stuck.
const STUCK_THRESHOLD_MS = 2 * 60 * 1000;

// A crash-looper's last failed run is always recent (backoff caps at ~5min).
// Older failed runs are boot/one-off residue on pods that recovered.
const RECENT_CRASH_WINDOW_MS = 10 * 60 * 1000;

function podAgeMs(pod) {
  const created = Date.parse(pod.metadata?.creationTimestamp ?? "");
  return Number.isNaN(created) ? 0 : Date.now() - created;
}

function totalRestarts(pod) {
  const containers = pod.status?.containerStatuses ?? [];
  return containers.reduce((sum, c) => sum + (c.restartCount ?? 0), 0);
}

function detectProblem(pod) {
  const phase = pod.status?.phase ?? "Unknown";

  // Completed jobs are fine.
  if (phase === "Succeeded") return null;

  const containers = [
    ...(pod.status?.initContainerStatuses ?? []),
    ...(pod.status?.containerStatuses ?? []),
  ];

  for (const container of containers) {
    const waiting = container.state?.waiting;
    if (waiting && PROBLEM_WAITING_REASONS.includes(waiting.reason)) {
      return { status: waiting.reason, message: waiting.message ?? "" };
    }

    if (
      container.state?.terminated?.reason === "OOMKilled" ||
      container.lastState?.terminated?.reason === "OOMKilled"
    ) {
      return {
        status: "OOMKilled",
        message: "Container was killed after exceeding its memory limit",
      };
    }

    // A crash-looping container passes through a terminated state between
    // restarts, before CrashLoopBackOff is set — catch that window too.
    const terminated = container.state?.terminated;
    if (terminated && terminated.exitCode !== 0) {
      return {
        status: terminated.reason ?? "Error",
        message: `Container exited with code ${terminated.exitCode}`,
      };
    }

    // A crash-looper can also be momentarily Running between restarts;
    // a recent failed run plus restarts means it is still crashing.
    const lastTerminated = container.lastState?.terminated;
    const lastFinishedAt = Date.parse(lastTerminated?.finishedAt ?? "");
    if (
      lastTerminated &&
      lastTerminated.exitCode !== 0 &&
      (container.restartCount ?? 0) >= 1 &&
      !Number.isNaN(lastFinishedAt) &&
      Date.now() - lastFinishedAt < RECENT_CRASH_WINDOW_MS
    ) {
      return {
        status: "CrashLoopBackOff",
        message: `Container keeps crashing (last exit code ${lastTerminated.exitCode})`,
      };
    }

    if (waiting?.reason === "ContainerCreating" && podAgeMs(pod) > STUCK_THRESHOLD_MS) {
      return {
        status: "ContainerCreating (stuck)",
        message: "Pod has been stuck in ContainerCreating — check volumes, secrets, and image pulls",
      };
    }
  }

  if (phase === "Pending" && podAgeMs(pod) > STUCK_THRESHOLD_MS) {
    return {
      status: "Pending",
      message: "Pod has been Pending for a while — likely unschedulable (resources, taints, or node selectors)",
    };
  }

  if (phase === "Failed") {
    return { status: "Error", message: pod.status?.message ?? "Pod is in Failed phase" };
  }

  return null;
}

/**
 * Inspect all pods in the cluster and flag unhealthy ones.
 */
export async function inspectPods(context) {
  const result = await runKubectlJson(["get", "pods", "-A"], { context });

  if (!result.success) {
    return { healthy: null, total_pods: 0, problematic_pods: [], error: result.error };
  }

  const pods = result.data.items ?? [];
  const problematicPods = [];

  for (const pod of pods) {
    const problem = detectProblem(pod);
    if (problem) {
      problematicPods.push({
        name: pod.metadata?.name ?? "unknown",
        namespace: pod.metadata?.namespace ?? "default",
        status: problem.status,
        restarts: totalRestarts(pod),
        message: problem.message,
      });
    }
  }

  return {
    healthy: problematicPods.length === 0,
    total_pods: pods.length,
    problematic_pods: problematicPods,
    error: null,
  };
}
