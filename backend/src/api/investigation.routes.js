import { Router } from "express";
import {
  investigateAndDiagnose,
  buildInitialProgress,
} from "../services/investigation.service.js";
import {
  createInvestigationRecord,
  updateInvestigationRecord,
} from "../services/history.service.js";
import {
  listUserClusters,
  getUserCluster,
  findUserClusterByContext,
} from "../services/cluster.service.js";
import { isAvailableHere, sourceForCluster } from "../services/evidence.source.js";
import { requireAuth } from "./auth.middleware.js";
import logger from "../core/logger.js";

const router = Router();

/**
 * Shape a cluster row for the frontend. `context`/`cluster`/`current` are the
 * legacy fields the current UI keys on; `id`/`mode`/`status` are what it will
 * move to. Agent clusters have no kubeconfig context, so they borrow their
 * name as a stable key.
 */
function toClusterResponse(row) {
  return {
    id: row.id,
    name: row.name,
    mode: row.mode,
    status: row.status,
    distro: row.distro,
    agent_version: row.agent_version,
    last_seen_at: row.last_seen_at,
    host: row.host ?? null,
    // Can this backend investigate it right now? The UI should disable the rest.
    available: isAvailableHere(row),
    // legacy fields
    context: row.context ?? row.name,
    cluster: row.name,
    current: false,
  };
}

router.get("/clusters", requireAuth, async (req, res) => {
  const { clusters, error } = await listUserClusters(req.user.id);
  const shaped = clusters.map(toClusterResponse);

  res.json({
    status: error ? "error" : "success",
    clusters: shaped,
    // Kept for the current UI's default-selection logic: the single cluster
    // this backend can actually investigate, if there is exactly one.
    current_context: (() => {
      const usable = shaped.filter((c) => c.available);
      return usable.length === 1 ? usable[0].context : null;
    })(),
    error,
  });
});

/**
 * Resolve the cluster a request is aimed at, enforcing ownership.
 * Returns { cluster } or { error: { code, message } }.
 */
async function resolveTargetCluster(userId, body) {
  const { cluster_id: clusterId, context } = body ?? {};

  if (clusterId) {
    const cluster = await getUserCluster(userId, clusterId);
    // Unknown and not-yours are deliberately the same answer, so cluster ids
    // belonging to other users cannot be probed for existence.
    if (!cluster) {
      return { error: { code: 404, message: "Cluster not found." } };
    }
    return { cluster };
  }

  if (context) {
    const cluster = await findUserClusterByContext(userId, context);
    if (!cluster) {
      return {
        error: {
          code: 404,
          message: `Cluster "${context}" is not registered to your account.`,
        },
      };
    }
    return { cluster };
  }

  // Nothing specified: only unambiguous when exactly one is usable here.
  const { clusters } = await listUserClusters(userId);
  const usable = clusters.filter(isAvailableHere);
  if (usable.length === 1) return { cluster: usable[0] };

  return {
    error: {
      code: 400,
      message: clusters.length
        ? "Pick which cluster to investigate."
        : "No clusters registered to your account yet.",
    },
  };
}

router.post("/investigate", requireAuth, async (req, res) => {
  const { cluster, error: resolveError } = await resolveTargetCluster(req.user.id, req.body);
  if (resolveError) {
    return res
      .status(resolveError.code)
      .json({ status: "error", message: resolveError.message });
  }

  const { source, error: sourceError } = sourceForCluster(cluster);
  if (sourceError) {
    return res.status(sourceError.code).json({ status: "error", message: sourceError.message });
  }

  const progress = buildInitialProgress();

  // History row is created up front; every progress update to it is
  // published to the user's realtime channel by a database trigger.
  const record = await createInvestigationRecord(req.user.id, progress, cluster.name, cluster.id);

  const onProgress = async (stepKey, status) => {
    const step = progress.find((s) => s.key === stepKey);
    if (step) step.status = status;
    await updateInvestigationRecord(record?.id, { progress });
  };

  try {
    const { investigation, diagnosis, ai_error } = await investigateAndDiagnose(source, onProgress);

    await updateInvestigationRecord(record?.id, {
      status: diagnosis ? "completed" : "failed",
      progress,
      root_cause: diagnosis?.root_cause ?? null,
      namespace: investigation.pods?.problematic_pods?.[0]?.namespace ?? null,
      confidence: diagnosis?.confidence ?? null,
      issues_found: investigation.issues_found ?? null,
      diagnosis,
      ai_error,
    });

    res.json({
      status: "success",
      investigation_id: record?.id ?? null,
      cluster: cluster.name,
      cluster_id: cluster.id,
      diagnosis,
      ai_error,
      investigation,
    });
  } catch (error) {
    logger.error(`Investigation failed: ${error.message}`);
    await updateInvestigationRecord(record?.id, {
      status: "failed",
      progress,
      ai_error: error.message,
    });
    res.status(500).json({ status: "error", message: "Investigation failed" });
  }
});

export default router;
