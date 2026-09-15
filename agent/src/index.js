// AI Kubernetes Agent -- the in-cluster half.
//
// A deliberately dumb job runner. It holds one outbound WebSocket to the
// backend, and when asked to investigate it runs the same collector the
// backend uses and sends the evidence back. No watch loops, no remediation,
// no write access: everything it can read is granted by a read-only RBAC
// role the user applied themselves.

import WebSocket from "ws";
import { collectEvidence, createApiClient, createRedactor, parseRedactPatterns } from "@aika/collector";
import {
  AGENT_CONNECT_PATH,
  CLOSE,
  MAX_MESSAGE_BYTES,
  MESSAGE,
  PROTOCOL_VERSION,
  decode,
  encode,
} from "@aika/protocol";
import { detectCluster } from "./cluster.info.js";
import log from "./log.js";

export const AGENT_VERSION = "0.3.0";

const config = {
  token: process.env.AIKA_TOKEN ?? "",
  server: (process.env.AIKA_SERVER ?? "").replace(/\/+$/, ""),
  // Only for running the agent outside a cluster during development; inside
  // a pod the mounted ServiceAccount is used.
  kubeconfig: process.env.AIKA_KUBECONFIG || undefined,
  // Extra redaction rules on top of the built-ins (JSON array or one regex per
  // line). They run here, in the cluster, before evidence is sent anywhere.
  redactPatterns: parseRedactPatterns(process.env.AIKA_REDACT_PATTERNS),
  // Set by `install.sh --namespaces`: read only these namespaces (Role, not
  // ClusterRole). Unset means cluster-wide.
  namespaces: process.env.AIKA_NAMESPACES ?? "",
};

// Close codes after which redialing cannot help -- the user has to act.
const FATAL_CLOSE_CODES = new Set([
  CLOSE.UNAUTHORIZED,
  CLOSE.PROTOCOL_TOO_OLD,
  CLOSE.CLUSTER_REMOVED,
]);

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;

function fail(message) {
  log.error(message);
  process.exit(1);
}

if (!config.token) fail("AIKA_TOKEN is not set");
if (!config.server) fail("AIKA_SERVER is not set (e.g. https://ai-k8s-agent.duckdns.org)");

function connectUrl() {
  const url = new URL(AGENT_CONNECT_PATH, config.server);
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  return url.toString();
}

let socket = null;
let attempt = 0;
let shuttingDown = false;
let reconnectTimer = null;
let clusterInfo = { distro: "unknown", kubernetes_version: null };
const runningJobs = new Set();

// Full jitter: spreads out a fleet of agents that all lost the backend at
// the same moment, so they do not stampede it when it comes back.
function nextDelay() {
  const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
  attempt += 1;
  return Math.floor(Math.random() * ceiling);
}

function send(type, payload) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(encode(type, payload));
  }
}

async function runJob(client, jobId) {
  runningJobs.add(jobId);
  log.info(`job ${jobId}: collecting evidence`);

  try {
    const investigation = await collectEvidence(
      client,
      async (step, status) => {
        send(MESSAGE.PROGRESS, { job_id: jobId, step, status });
      },
      { redactor },
    );
    send(MESSAGE.RESULT, { job_id: jobId, investigation });
    log.info(`job ${jobId}: done, ${investigation.issues_found} potential issue(s)`);
  } catch (error) {
    send(MESSAGE.JOB_ERROR, { job_id: jobId, error: error.message });
    log.error(`job ${jobId}: ${error.message}`);
  } finally {
    runningJobs.delete(jobId);
  }
}

function connect(client) {
  const url = connectUrl();
  log.info(`connecting to ${url}`);

  socket = new WebSocket(url, {
    headers: { Authorization: `Bearer ${config.token}` },
    maxPayload: MAX_MESSAGE_BYTES,
    handshakeTimeout: 15_000,
  });

  socket.on("open", () => {
    send(MESSAGE.HELLO, {
      protocol: PROTOCOL_VERSION,
      agent_version: AGENT_VERSION,
      distro: clusterInfo.distro,
      kubernetes_version: clusterInfo.kubernetes_version,
    });
  });

  // The upgrade itself was refused -- most often a bad or revoked token.
  socket.on("unexpected-response", (_req, res) => {
    if (res.statusCode === 401) {
      log.error("backend refused the connection: token rejected (revoked, or copied wrong?)");
      shuttingDown = true;
      process.exitCode = 1;
    } else {
      log.error(`backend refused the connection: HTTP ${res.statusCode}`);
    }
    socket.terminate();
  });

  socket.on("message", (raw) => {
    const message = decode(raw);
    if (!message) return;

    switch (message.type) {
      case MESSAGE.WELCOME:
        attempt = 0;
        log.info(`registered as cluster "${message.name}" (${message.cluster_id})`);
        break;
      case MESSAGE.REJECTED:
        log.error(`backend rejected this agent: ${message.reason}`);
        break;
      case MESSAGE.INVESTIGATE:
        if (typeof message.job_id === "string" && !runningJobs.has(message.job_id)) {
          void runJob(client, message.job_id);
        }
        break;
      default:
        // Unknown types are ignored, not fatal: a newer backend may speak a
        // superset of this agent's protocol.
        break;
    }
  });

  socket.on("close", (code, reasonBuffer) => {
    const reason = reasonBuffer?.toString() || "no reason given";
    socket = null;

    if (FATAL_CLOSE_CODES.has(code)) {
      log.error(`disconnected permanently (${code}: ${reason}) -- not reconnecting`);
      shuttingDown = true;
      process.exitCode = 1;
      return;
    }
    if (shuttingDown) return;

    const delay = nextDelay();
    log.warn(`disconnected (${code}: ${reason}); reconnecting in ${(delay / 1000).toFixed(1)}s`);
    reconnectTimer = setTimeout(() => connect(client), delay);
  });

  socket.on("error", (error) => {
    // Always followed by "close", which owns the reconnect decision.
    // A refused connection arrives as an AggregateError with an empty
    // message; the code is the useful part.
    log.warn(`socket error: ${error.message || error.code || error.errors?.[0]?.code || "unknown"}`);
  });
}

function shutdown(signal) {
  log.info(`${signal} received, closing connection`);
  shuttingDown = true;
  clearTimeout(reconnectTimer);
  socket?.close(1000, "agent shutting down");
  // Kubernetes sends SIGKILL after the grace period regardless; don't hang.
  setTimeout(() => process.exit(process.exitCode ?? 0), 5_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

const redactor = createRedactor({ extraPatterns: config.redactPatterns, logger: log });
let client;
try {
  client = await createApiClient({ kubeconfig: config.kubeconfig, logger: log, namespaces: config.namespaces });
} catch (error) {
  fail(`AIKA_NAMESPACES: ${error.message}`);
}
log.info(client.namespaces ? `scoped to namespaces: ${client.namespaces.join(", ")}` : "scope: cluster-wide");
clusterInfo = await detectCluster(config.kubeconfig);
log.info(
  `agent ${AGENT_VERSION} starting; cluster looks like ${clusterInfo.distro} ${clusterInfo.kubernetes_version ?? ""}`.trim(),
);
if (redactor.customRuleCount) log.info(`${redactor.customRuleCount} custom redaction pattern(s) active`);
connect(client);
