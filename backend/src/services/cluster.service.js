// Cluster registry (InsForge). Every cluster belongs to exactly one user;
// nothing in here may return a row the caller does not own.
//
// Writes go through the admin client (bypasses RLS), so ownership is this
// module's responsibility -- every query is scoped by user_id.

import insforgeAdmin from "../core/insforge.js";
import config from "../core/config.js";
import logger from "../core/logger.js";
import { listClusters as listKubeconfigContexts } from "../kubernetes/cluster.inspector.js";

// Columns safe to hand to the frontend (never agent_token_hash).
const PUBLIC_COLUMNS =
  "id,user_id,name,mode,context,host,agent_version,distro,status,last_seen_at,created_at,updated_at";

/** Every cluster owned by this user, newest first. */
export async function listUserClusters(userId) {
  if (!insforgeAdmin) return { clusters: [], error: "Cluster registry unavailable" };

  const { data, error } = await insforgeAdmin.database
    .from("clusters")
    .select(PUBLIC_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    logger.warn(`Could not list clusters: ${error.message}`);
    return { clusters: [], error: error.message };
  }

  return { clusters: data ?? [], error: null };
}

/**
 * Load one cluster, but only if this user owns it.
 * Returns null when it does not exist OR belongs to someone else -- the
 * caller turns both into the same response so cluster ids cannot be probed.
 */
export async function getUserCluster(userId, clusterId) {
  if (!insforgeAdmin || !clusterId) return null;

  const { data, error } = await insforgeAdmin.database
    .from("clusters")
    .select(PUBLIC_COLUMNS)
    .eq("id", clusterId)
    .eq("user_id", userId)
    .limit(1);

  if (error) {
    logger.warn(`Could not load cluster ${clusterId}: ${error.message}`);
    return null;
  }

  return data?.[0] ?? null;
}

/**
 * Resolve a legacy `{ context }` request to one of this user's local clusters.
 * The same context name can be registered by more than one backend, so prefer
 * the row this backend owns, then an unclaimed one.
 */
export async function findUserClusterByContext(userId, context) {
  if (!insforgeAdmin || !context) return null;

  const { data, error } = await insforgeAdmin.database
    .from("clusters")
    .select(PUBLIC_COLUMNS)
    .eq("user_id", userId)
    .eq("mode", "local")
    .eq("context", context);

  if (error) {
    logger.warn(`Could not resolve context "${context}": ${error.message}`);
    return null;
  }

  const rows = data ?? [];
  return (
    rows.find((row) => row.host === config.localClusterHost) ??
    rows.find((row) => !row.host) ??
    rows[0] ??
    null
  );
}

/**
 * Register this machine's kubeconfig contexts as clusters owned by
 * LOCAL_CLUSTER_OWNER. This is what keeps the original single-operator
 * behaviour working (dev loop against kind, the EC2 demo) now that the
 * cluster list comes from the database instead of the kubeconfig.
 *
 * More than one backend can register clusters for the same owner (a laptop
 * and the EC2 box both do), so every row is tagged with the host that owns
 * it, and a backend only ever reconciles its own rows. Without that, each
 * backend marks the other's clusters offline on every boot.
 *
 * Rows from before hosts existed (host IS NULL) are claimed by the first
 * backend that actually has that context, and otherwise left untouched.
 *
 * Runs once at boot, best-effort: a failure here must never stop the server.
 */
export async function syncLocalClusters() {
  const ownerId = config.localClusterOwner;
  const host = config.localClusterHost;
  if (!ownerId) return;

  if (!insforgeAdmin) {
    logger.warn("LOCAL_CLUSTER_OWNER is set but InsForge is not configured -- skipping local cluster sync");
    return;
  }

  const { clusters: contexts, error } = await listKubeconfigContexts();
  if (error) {
    logger.warn(`Local cluster sync skipped: ${error}`);
    return;
  }

  const { clusters: existing, error: listError } = await listUserClusters(ownerId);
  if (listError) {
    logger.warn(`Local cluster sync skipped: ${listError}`);
    return;
  }

  const local = existing.filter((c) => c.mode === "local");
  const mine = new Map(local.filter((c) => c.host === host).map((c) => [c.context, c]));
  const unclaimed = new Map(local.filter((c) => !c.host).map((c) => [c.context, c]));
  const takenNames = new Set(existing.map((c) => c.name));
  const now = new Date().toISOString();

  let added = 0;
  let claimed = 0;

  for (const { context } of contexts) {
    const row = mine.get(context) ?? unclaimed.get(context);

    if (row) {
      if (!row.host) claimed += 1;
      await insforgeAdmin.database
        .from("clusters")
        .update({ status: "online", last_seen_at: now, host })
        .eq("id", row.id);
      continue;
    }

    // Names are unique per user; another backend may already use this one.
    const name = takenNames.has(context) ? `${context} (${host})` : context;

    const { error: insertError } = await insforgeAdmin.database.from("clusters").insert([
      {
        user_id: ownerId,
        name,
        mode: "local",
        context,
        host,
        status: "online",
        distro: "kubeconfig",
        last_seen_at: now,
      },
    ]);

    if (insertError) {
      logger.warn(`Could not register local cluster "${context}": ${insertError.message}`);
      continue;
    }
    takenNames.add(name);
    added += 1;
  }

  // Only this host's own contexts that have disappeared go offline. They are
  // not deleted, so their investigation history keeps its link.
  const live = new Set(contexts.map((c) => c.context));
  let wentOffline = 0;
  for (const [context, row] of mine) {
    if (!live.has(context) && row.status !== "offline") {
      await insforgeAdmin.database.from("clusters").update({ status: "offline" }).eq("id", row.id);
      wentOffline += 1;
    }
  }

  logger.info(
    `Local cluster sync on ${host}: ${contexts.length} context(s), ${added} registered, ${claimed} claimed, ${wentOffline} offline`,
  );
}

// ---------------------------------------------------------------------------
// Agent-backed clusters
// ---------------------------------------------------------------------------

/**
 * Register an agent-backed cluster. The caller mints the token and passes
 * only its hash -- this module never sees a usable credential.
 * Returns { cluster } or { error, conflict }.
 */
export async function createAgentCluster(userId, name, tokenHash) {
  if (!insforgeAdmin) return { error: "Cluster registry unavailable" };

  const { data, error } = await insforgeAdmin.database
    .from("clusters")
    .insert([
      {
        user_id: userId,
        name,
        mode: "agent",
        status: "pending",
        agent_token_hash: tokenHash,
      },
    ])
    .select(PUBLIC_COLUMNS);

  if (error) {
    // clusters_user_name_idx: names are unique per user.
    const conflict = /duplicate|unique/i.test(error.message);
    if (!conflict) logger.warn(`Could not create cluster "${name}": ${error.message}`);
    return { error: error.message, conflict };
  }

  return { cluster: data?.[0] ?? null };
}

/** Delete a cluster this user owns. Returns true only if a row went away. */
export async function deleteUserCluster(userId, clusterId) {
  if (!insforgeAdmin) return false;

  const { data, error } = await insforgeAdmin.database
    .from("clusters")
    .delete()
    .eq("id", clusterId)
    .eq("user_id", userId)
    .select("id");

  if (error) {
    logger.warn(`Could not delete cluster ${clusterId}: ${error.message}`);
    return false;
  }

  return (data?.length ?? 0) > 0;
}

/**
 * Resolve an agent's token hash to its cluster. This is the one lookup that
 * is not scoped by user: the token itself is the proof of ownership.
 */
export async function findClusterByTokenHash(tokenHash) {
  if (!insforgeAdmin || !tokenHash) return null;

  const { data, error } = await insforgeAdmin.database
    .from("clusters")
    .select(PUBLIC_COLUMNS)
    .eq("agent_token_hash", tokenHash)
    .eq("mode", "agent")
    .limit(1);

  if (error) {
    logger.warn(`Agent token lookup failed: ${error.message}`);
    return null;
  }

  return data?.[0] ?? null;
}

/** Record agent liveness / metadata. Best-effort: never throws. */
export async function updateAgentCluster(clusterId, fields) {
  if (!insforgeAdmin || !clusterId) return;

  const { error } = await insforgeAdmin.database
    .from("clusters")
    .update(fields)
    .eq("id", clusterId)
    .eq("mode", "agent");

  if (error) {
    logger.warn(`Could not update agent cluster ${clusterId}: ${error.message}`);
  }
}

/**
 * Agent connections live in this process's memory, so after a restart no
 * agent is connected until it redials. Say so in the database instead of
 * leaving stale "online" rows behind.
 */
export async function markAllAgentClustersOffline() {
  if (!insforgeAdmin) return;

  const { error } = await insforgeAdmin.database
    .from("clusters")
    .update({ status: "offline" })
    .eq("mode", "agent")
    .eq("status", "online");

  if (error) logger.warn(`Could not reset agent cluster status: ${error.message}`);
}
