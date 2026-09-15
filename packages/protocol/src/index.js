// The wire contract between the backend and in-cluster agents.
//
// Agents run in other people's clusters and are upgraded on their schedule,
// not ours, so this contract only ever grows: add message types and fields,
// never repurpose or remove them. Anything incompatible bumps
// PROTOCOL_VERSION, and the backend refuses agents older than
// MIN_PROTOCOL_VERSION with a message saying so.

export const PROTOCOL_VERSION = 1;
export const MIN_PROTOCOL_VERSION = 1;

// Path the agent dials. Token goes in the Authorization header of the
// upgrade request, never in the URL (URLs end up in proxy access logs).
export const AGENT_CONNECT_PATH = "/agent/connect";

// Evidence from a large cluster can be a few MB; anything past this is a bug.
export const MAX_MESSAGE_BYTES = 10 * 1024 * 1024;

export const HEARTBEAT_INTERVAL_MS = 30_000;

// The newest agent release. Must match agent/package.json, AGENT_VERSION and
// the installer's default image (test/versions.test.js checks all four).
// Agents older than this still work; the UI just offers an update.
export const LATEST_AGENT_VERSION = "0.3.0";

/** True when `version` is a parseable x.y.z older than LATEST_AGENT_VERSION. */
export function isAgentOutdated(version, latest = LATEST_AGENT_VERSION) {
  const parse = (v) => (typeof v === "string" && /^\d+\.\d+\.\d+/.test(v) ? v.split(".").map((n) => parseInt(n, 10)) : null);
  const have = parse(version);
  const want = parse(latest);
  if (!have || !want) return false;
  for (let i = 0; i < 3; i += 1) {
    if (have[i] !== want[i]) return have[i] < want[i];
  }
  return false;
}

export const MESSAGE = {
  // agent -> backend
  HELLO: "hello", //       { protocol, agent_version, distro, kubernetes_version }
  PROGRESS: "progress", // { job_id, step, status }
  RESULT: "result", //     { job_id, investigation }
  JOB_ERROR: "job_error", // { job_id, error }

  // backend -> agent
  WELCOME: "welcome", //   { cluster_id, name }
  REJECTED: "rejected", // { reason }            -- socket closes right after
  INVESTIGATE: "investigate", // { job_id }
};

// WebSocket close codes in the application range (4000-4999).
export const CLOSE = {
  UNAUTHORIZED: 4001,
  PROTOCOL_TOO_OLD: 4002,
  REPLACED: 4003, // a newer connection for the same cluster took over
  CLUSTER_REMOVED: 4004,
  BAD_MESSAGE: 4005,
};

// Tokens are recognisable on sight (secret scanners, log redaction).
export const TOKEN_PREFIX = "aika_";

export function encode(type, payload = {}) {
  return JSON.stringify({ type, ...payload });
}

/** Parse one frame; returns null for anything that is not a typed object. */
export function decode(raw) {
  try {
    const message = JSON.parse(raw.toString());
    return message && typeof message.type === "string" ? message : null;
  } catch {
    return null;
  }
}
