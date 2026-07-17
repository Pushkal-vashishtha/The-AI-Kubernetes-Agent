import { Router } from "express";
import {
  investigateAndDiagnose,
  buildInitialProgress,
} from "../services/investigation.service.js";
import {
  createInvestigationRecord,
  updateInvestigationRecord,
} from "../services/history.service.js";
import { listClusters } from "../kubernetes/cluster.inspector.js";
import { requireAuth } from "./auth.middleware.js";
import logger from "../core/logger.js";

const router = Router();

router.get("/clusters", requireAuth, async (_req, res) => {
  const { clusters, current_context, error } = await listClusters();
  res.json({ status: error ? "error" : "success", clusters, current_context, error });
});

router.post("/investigate", requireAuth, async (req, res) => {
  const requestedContext = req.body?.context;

  // Only accept contexts that actually exist in the kubeconfig.
  const { clusters, current_context } = await listClusters();
  let context;
  if (requestedContext != null) {
    if (!clusters.some((c) => c.context === requestedContext)) {
      return res.status(400).json({
        status: "error",
        message: `Unknown cluster "${requestedContext}" — it is not in the kubeconfig on the backend.`,
      });
    }
    context = requestedContext;
  }

  const progress = buildInitialProgress();
  const cluster = context ?? current_context ?? null;

  // History row is created up front; every progress update to it is
  // published to the user's realtime channel by a database trigger.
  const record = await createInvestigationRecord(req.user.id, progress, cluster);

  const onProgress = async (stepKey, status) => {
    const step = progress.find((s) => s.key === stepKey);
    if (step) step.status = status;
    await updateInvestigationRecord(record?.id, { progress });
  };

  try {
    const { investigation, diagnosis, ai_error } = await investigateAndDiagnose(onProgress, context);

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
      cluster,
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
