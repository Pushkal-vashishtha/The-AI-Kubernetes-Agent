import { runKubectlJson } from "./kubectl.executor.js";

const MAX_FINDINGS = 30;

// Event reasons worth surfacing even beyond type=Warning.
const PROBLEM_REASONS = [
  "FailedScheduling",
  "BackOff",
  "Failed",
  "FailedMount",
  "FailedAttachVolume",
  "FailedPull",
  "ErrImagePull",
  "ImagePullBackOff",
  "Unhealthy",
  "FailedCreate",
  "OOMKilling",
  "NodeNotReady",
  "Evicted",
];

function eventTime(event) {
  return (
    event.lastTimestamp ??
    event.eventTime ??
    event.series?.lastObservedTime ??
    event.metadata?.creationTimestamp ??
    null
  );
}

function isProblem(event) {
  return event.type === "Warning" || PROBLEM_REASONS.includes(event.reason);
}

/**
 * Read cluster events and summarize the ones that indicate trouble.
 */
export async function analyzeEvents(context) {
  const result = await runKubectlJson(["get", "events", "-A"], { context });

  if (!result.success) {
    return { healthy: null, total_events: 0, findings: [], error: result.error };
  }

  const events = result.data.items ?? [];
  const problems = events.filter(isProblem);

  // Deduplicate by (reason, object) — repeated events collapse into one finding.
  const byKey = new Map();
  for (const event of problems) {
    const object = `${event.involvedObject?.kind ?? "Unknown"}/${event.involvedObject?.name ?? "unknown"}`;
    const key = `${event.reason}|${event.involvedObject?.namespace ?? ""}|${object}`;
    const existing = byKey.get(key);
    const count = event.count ?? event.series?.count ?? 1;

    if (existing) {
      existing.count += count;
      const time = eventTime(event);
      if (time && (!existing.last_seen || time > existing.last_seen)) {
        existing.last_seen = time;
        existing.message = event.message ?? existing.message;
      }
    } else {
      byKey.set(key, {
        reason: event.reason ?? "Unknown",
        object,
        namespace: event.involvedObject?.namespace ?? "",
        count,
        message: event.message ?? "",
        last_seen: eventTime(event),
      });
    }
  }

  const findings = [...byKey.values()]
    .sort((a, b) => String(b.last_seen ?? "").localeCompare(String(a.last_seen ?? "")))
    .slice(0, MAX_FINDINGS);

  return {
    healthy: findings.length === 0,
    total_events: events.length,
    findings,
    error: null,
  };
}
