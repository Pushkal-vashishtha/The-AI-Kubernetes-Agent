// The agent hub: accepts outbound connections from in-cluster agents,
// authenticates them, and dispatches investigation jobs over them.
//
// Connections live in this process's memory. That is fine for the single
// backend instance this project runs; horizontal scaling would need jobs
// routed to whichever instance holds a cluster's socket (a pub/sub hop).

import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import {
  AGENT_CONNECT_PATH,
  CLOSE,
  HEARTBEAT_INTERVAL_MS,
  MAX_MESSAGE_BYTES,
  MESSAGE,
  MIN_PROTOCOL_VERSION,
  decode,
  encode,
} from "@aika/protocol";
import {
  findClusterByTokenHash,
  markAllAgentClustersOffline,
  updateAgentCluster,
} from "../services/cluster.service.js";
import { hashAgentToken, looksLikeAgentToken } from "./token.js";
import logger from "../core/logger.js";

// An agent must say hello this soon after connecting, or it is dropped.
const HELLO_TIMEOUT_MS = 10_000;

// clusterId -> { socket, cluster, jobs: Map<jobId, pendingJob>, lastSeenWrite }
const connections = new Map();

export class AgentUnavailableError extends Error {}

function bearerToken(request) {
  const header = request.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

function rejectUpgrade(socket, status, message) {
  socket.write(
    `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
  socket.destroy();
}

function settleJob(entry, jobId, outcome) {
  const job = entry.jobs.get(jobId);
  if (!job) return;
  entry.jobs.delete(jobId);
  clearTimeout(job.timer);
  if (outcome.error) job.reject(outcome.error);
  else job.resolve(outcome.investigation);
}

function failAllJobs(entry, message) {
  for (const jobId of [...entry.jobs.keys()]) {
    settleJob(entry, jobId, { error: new AgentUnavailableError(message) });
  }
}

// Throttled: a heartbeat every 30s should not mean a database write every 30s
// per cluster forever. Once a minute is plenty for "last seen".
async function touchLastSeen(entry) {
  const now = Date.now();
  if (now - entry.lastSeenWrite < 60_000) return;
  entry.lastSeenWrite = now;
  await updateAgentCluster(entry.cluster.id, { last_seen_at: new Date(now).toISOString() });
}

function handleMessage(entry, raw) {
  const message = decode(raw);
  if (!message) {
    entry.socket.close(CLOSE.BAD_MESSAGE, "unparseable message");
    return;
  }

  switch (message.type) {
    case MESSAGE.PROGRESS: {
      const job = entry.jobs.get(message.job_id);
      if (job) void job.onProgress(message.step, message.status);
      break;
    }
    case MESSAGE.RESULT:
      settleJob(entry, message.job_id, { investigation: message.investigation });
      break;
    case MESSAGE.JOB_ERROR:
      settleJob(entry, message.job_id, {
        error: new Error(`agent failed to collect evidence: ${message.error}`),
      });
      break;
    default:
      break;
  }
}

async function onConnection(socket, cluster) {
  let helloTimer = setTimeout(() => {
    socket.close(CLOSE.BAD_MESSAGE, "no hello received");
  }, HELLO_TIMEOUT_MS);

  socket.once("message", async (raw) => {
    clearTimeout(helloTimer);
    helloTimer = null;

    const hello = decode(raw);
    if (hello?.type !== MESSAGE.HELLO) {
      socket.close(CLOSE.BAD_MESSAGE, "first message must be hello");
      return;
    }

    if (!Number.isInteger(hello.protocol) || hello.protocol < MIN_PROTOCOL_VERSION) {
      const reason = `agent protocol ${hello.protocol} is older than the minimum ${MIN_PROTOCOL_VERSION}; upgrade the agent`;
      socket.send(encode(MESSAGE.REJECTED, { reason }));
      socket.close(CLOSE.PROTOCOL_TOO_OLD, "protocol too old");
      logger.warn(`Rejected agent for cluster "${cluster.name}": ${reason}`);
      return;
    }

    // One live connection per cluster. A second agent with the same token
    // (a rolling restart, or a copy-pasted install) replaces the first.
    const previous = connections.get(cluster.id);
    if (previous) {
      failAllJobs(previous, "agent connection was replaced mid-investigation");
      previous.socket.close(CLOSE.REPLACED, "replaced by a newer connection");
    }

    const entry = { socket, cluster, jobs: new Map(), lastSeenWrite: 0, alive: true };
    connections.set(cluster.id, entry);

    socket.on("message", (data) => handleMessage(entry, data));
    socket.on("pong", () => {
      entry.alive = true;
      void touchLastSeen(entry);
    });

    socket.on("close", () => {
      failAllJobs(entry, "agent disconnected mid-investigation");
      // Only the connection that is still current may mark the cluster
      // offline -- a replaced socket closing must not clobber its successor.
      if (connections.get(cluster.id) === entry) {
        connections.delete(cluster.id);
        void updateAgentCluster(cluster.id, {
          status: "offline",
          last_seen_at: new Date().toISOString(),
        });
        logger.info(`Agent for cluster "${cluster.name}" disconnected`);
      }
    });

    entry.lastSeenWrite = Date.now();
    await updateAgentCluster(cluster.id, {
      status: "online",
      last_seen_at: new Date().toISOString(),
      agent_version: typeof hello.agent_version === "string" ? hello.agent_version.slice(0, 40) : null,
      distro: typeof hello.distro === "string" ? hello.distro.slice(0, 40) : null,
    });

    socket.send(encode(MESSAGE.WELCOME, { cluster_id: cluster.id, name: cluster.name }));
    logger.info(
      `Agent ${hello.agent_version ?? "?"} connected for cluster "${cluster.name}" (${hello.distro ?? "unknown"})`,
    );
  });

  socket.on("error", (error) => logger.warn(`Agent socket error (${cluster.name}): ${error.message}`));
}

/** Attach the agent endpoint to the HTTP server Express is listening on. */
export function attachAgentHub(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  server.on("upgrade", async (request, socket, head) => {
    const { pathname } = new URL(request.url, "http://internal");
    if (pathname !== AGENT_CONNECT_PATH) {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }

    // Authenticate BEFORE accepting the upgrade, so an unauthenticated
    // client never holds an open socket at all.
    const token = bearerToken(request);
    if (!looksLikeAgentToken(token)) {
      rejectUpgrade(socket, 401, "Unauthorized");
      return;
    }

    const cluster = await findClusterByTokenHash(hashAgentToken(token));
    if (!cluster) {
      rejectUpgrade(socket, 401, "Unauthorized");
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => onConnection(ws, cluster));
  });

  // Protocol-level heartbeat: a peer that misses a whole interval of pings is
  // dead (half-open TCP after a NAT timeout, a killed node) -- drop it so the
  // cluster shows offline instead of hanging the next investigation.
  const heartbeat = setInterval(() => {
    for (const entry of connections.values()) {
      if (!entry.alive) {
        entry.socket.terminate();
        continue;
      }
      entry.alive = false;
      entry.socket.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  // Nothing is connected to a fresh process.
  void markAllAgentClustersOffline();
  logger.info(`Agent hub listening on ${AGENT_CONNECT_PATH}`);
}

export function isAgentConnected(clusterId) {
  return connections.has(clusterId);
}

/**
 * Ask a cluster's agent to collect evidence. Resolves with the investigation
 * object -- the same shape the local collector produces -- or rejects with
 * AgentUnavailableError / a collection error / a timeout.
 */
export function requestEvidence(clusterId, onProgress, { timeoutMs = 60_000 } = {}) {
  const entry = connections.get(clusterId);
  if (!entry) {
    return Promise.reject(new AgentUnavailableError("agent is not connected"));
  }

  const jobId = randomUUID();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      settleJob(entry, jobId, {
        error: new AgentUnavailableError(`agent did not return evidence within ${timeoutMs / 1000}s`),
      });
    }, timeoutMs);

    entry.jobs.set(jobId, { resolve, reject, timer, onProgress });
    entry.socket.send(encode(MESSAGE.INVESTIGATE, { job_id: jobId }));
  });
}

/** Drop a cluster's live connection, e.g. because the cluster was deleted. */
export function disconnectAgent(clusterId, code = CLOSE.CLUSTER_REMOVED, reason = "cluster removed") {
  const entry = connections.get(clusterId);
  if (!entry) return;
  failAllJobs(entry, reason);
  connections.delete(clusterId);
  entry.socket.close(code, reason);
}
