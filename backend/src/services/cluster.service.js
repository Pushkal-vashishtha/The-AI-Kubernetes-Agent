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
  "id,user_id,name,mode,context,agent_version,distro,status,last_seen_at,created_at,updated_at";

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

/** Resolve a legacy `{ context }` request to one of this user's local clusters. */
export async function findUserClusterByContext(userId, context) {
  if (!insforgeAdmin || !context) return null;

  const { data, error } = await insforgeAdmin.database
    .from("clusters")
    .select(PUBLIC_COLUMNS)
    .eq("user_id", userId)
    .eq("mode", "local")
    .eq("context", context)
    .limit(1);

  if (error) {
    logger.warn(`Could not resolve context "${context}": ${error.message}`);
    return null;
  }

  return data?.[0] ?? null;
}

/**
 * Register this machine's kubeconfig contexts as clusters owned by
 * LOCAL_CLUSTER_OWNER. This is what keeps the original single-operator
 * behaviour working (dev loop against kind, the EC2 demo) now that the
 * cluster list comes from the database instead of the kubeconfig.
 *
 * Runs once at boot, best-effort: a failure here must never stop the server.
 */
export async function syncLocalClusters() {
  const ownerId = config.localClusterOwner;
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

  const { clusters: existing } = await listUserClusters(ownerId);
  const known = new Map(
    existing.filter((c) => c.mode === "local").map((c) => [c.context, c]),
  );

  let added = 0;
  for (const ctx of contexts) {
    const row = known.get(ctx.context);

    if (!row) {
      const { error: insertError } = await insforgeAdmin.database
        .from("clusters")
        .insert([
          {
            user_id: ownerId,
            name: ctx.context,
            mode: "local",
            context: ctx.context,
            status: "online",
            distro: "kubeconfig",
            last_seen_at: new Date().toISOString(),
          },
        ]);

      if (insertError) {
        logger.warn(`Could not register local cluster "${ctx.context}": ${insertError.message}`);
        continue;
      }
      added += 1;
      continue;
    }

    // Already registered -- just refresh liveness.
    await insforgeAdmin.database
      .from("clusters")
      .update({ status: "online", last_seen_at: new Date().toISOString() })
      .eq("id", row.id);
  }

  // Contexts that have disappeared from the kubeconfig are marked offline
  // rather than deleted, so their investigation history keeps its link.
  const live = new Set(contexts.map((c) => c.context));
  for (const [context, row] of known) {
    if (!live.has(context) && row.status !== "offline") {
      await insforgeAdmin.database
        .from("clusters")
        .update({ status: "offline" })
        .eq("id", row.id);
    }
  }

  logger.info(
    `Local cluster sync: ${contexts.length} kubeconfig context(s), ${added} newly registered`,
  );
}
