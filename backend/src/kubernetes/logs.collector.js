import { runKubectl } from "./kubectl.executor.js";

const TAIL_LINES = 50;
const MAX_RELEVANT_LINES = 20;
const MAX_PODS = 5;

// Log lines that usually explain why something is failing.
const RELEVANT_PATTERNS = [
  /error/i,
  /exception/i,
  /traceback/i,
  /fatal/i,
  /panic/i,
  /fail(ed|ure)?/i,
  /refused/i,
  /unreachable/i,
  /timed?\s?out/i,
  /denied/i,
  /unauthorized/i,
  /missing/i,
  /not found/i,
  /cannot/i,
  /unable/i,
  /invalid/i,
  /crash/i,
  /exit code/i,
  /oom/i,
  /killed/i,
  /environment variable/i,
];

// Statuses where the crash output usually lives in the PREVIOUS container run.
const CRASHED_STATUSES = ["CrashLoopBackOff", "OOMKilled", "Error"];

function extractRelevantLines(rawLogs) {
  const lines = rawLogs.split("\n").filter((line) => line.trim() !== "");
  const relevant = lines.filter((line) =>
    RELEVANT_PATTERNS.some((pattern) => pattern.test(line)),
  );

  // If nothing matched, keep the last few lines so the evidence is never empty.
  const selected = relevant.length > 0 ? relevant : lines.slice(-10);

  // Keep the most recent matches only — no thousand-line dumps.
  return selected.slice(-MAX_RELEVANT_LINES);
}

async function fetchLogs(pod, { previous = false, context } = {}) {
  const args = [
    "logs",
    pod.name,
    "-n",
    pod.namespace,
    "--tail",
    String(TAIL_LINES),
    "--all-containers",
  ];
  if (previous) args.push("--previous");
  return runKubectl(args, { context });
}

/**
 * Collect concise, failure-focused logs for the unhealthy pods
 * found by the pod inspector.
 */
export async function collectLogs(problematicPods = [], context) {
  if (problematicPods.length === 0) {
    return {
      collected: 0,
      skipped: 0,
      logs: [],
      note: "No unhealthy pods — no logs collected",
      error: null,
    };
  }

  const targets = problematicPods.slice(0, MAX_PODS);
  const logs = [];

  for (const pod of targets) {
    const current = await fetchLogs(pod, { context });

    // For crashed pods the useful output is usually in the previous run.
    let previousLines = [];
    if (CRASHED_STATUSES.includes(pod.status)) {
      const previous = await fetchLogs(pod, { previous: true, context });
      if (previous.success && previous.stdout) {
        previousLines = extractRelevantLines(previous.stdout);
      }
    }

    logs.push({
      pod: pod.name,
      namespace: pod.namespace,
      status: pod.status,
      relevant_lines: current.success && current.stdout ? extractRelevantLines(current.stdout) : [],
      previous_run_lines: previousLines,
      error: current.success ? null : current.error,
    });
  }

  return {
    collected: logs.length,
    skipped: problematicPods.length - targets.length,
    logs,
    error: null,
  };
}
