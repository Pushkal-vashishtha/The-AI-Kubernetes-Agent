import { Router } from "express";
import {
  createAgentCluster,
  deleteUserCluster,
  getUserCluster,
  rotateAgentClusterToken,
} from "../services/cluster.service.js";
import { hashAgentToken, mintAgentToken } from "../agents/token.js";
import { disconnectAgent } from "../agents/hub.js";
import { CLOSE } from "@aika/protocol";
import { requireAuth } from "./auth.middleware.js";

const router = Router();

// Names show up in the UI and in agent logs; keep them boring.
const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/;

/**
 * Enrol a cluster. Returns the agent token exactly once -- it is not stored,
 * so it cannot be shown again. Losing it means removing and re-adding the
 * cluster (rotation comes in a later phase).
 */
router.post("/clusters", requireAuth, async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";

  if (!NAME_PATTERN.test(name)) {
    return res.status(400).json({
      status: "error",
      message:
        "Cluster name must be 1-63 characters: letters, digits, dot, dash or underscore, starting with a letter or digit.",
    });
  }

  const token = mintAgentToken();
  const { cluster, error, conflict } = await createAgentCluster(
    req.user.id,
    name,
    hashAgentToken(token),
  );

  if (conflict) {
    return res
      .status(409)
      .json({ status: "error", message: `You already have a cluster named "${name}".` });
  }
  if (error || !cluster) {
    return res.status(500).json({ status: "error", message: "Could not register the cluster." });
  }

  res.status(201).json({
    status: "success",
    cluster,
    // Shown once. The UI must make that obvious.
    agent_token: token,
  });
});

router.delete("/clusters/:id", requireAuth, async (req, res) => {
  const cluster = await getUserCluster(req.user.id, req.params.id);
  // Same 404 for "not yours" and "does not exist", as everywhere else.
  if (!cluster) {
    return res.status(404).json({ status: "error", message: "Cluster not found." });
  }

  const deleted = await deleteUserCluster(req.user.id, cluster.id);
  if (!deleted) {
    return res.status(500).json({ status: "error", message: "Could not remove the cluster." });
  }

  // Revocation must be immediate: the row (and its token hash) is gone, and
  // the live socket goes with it rather than lingering until it next drops.
  disconnectAgent(cluster.id);

  res.json({ status: "success", deleted: cluster.id });
});

/**
 * Replace a cluster's agent token, keeping the cluster and its history.
 * For a token that leaked or was lost. The new token is returned once;
 * the old one stops working immediately.
 */
router.post("/clusters/:id/rotate-token", requireAuth, async (req, res) => {
  const cluster = await getUserCluster(req.user.id, req.params.id);
  if (!cluster) {
    return res.status(404).json({ status: "error", message: "Cluster not found." });
  }
  if (cluster.mode !== "agent") {
    return res.status(400).json({
      status: "error",
      message: `"${cluster.name}" is a kubeconfig cluster; it has no agent token to rotate.`,
    });
  }

  const token = mintAgentToken();
  const updated = await rotateAgentClusterToken(req.user.id, cluster.id, hashAgentToken(token));
  if (!updated) {
    return res.status(500).json({ status: "error", message: "Could not rotate the token." });
  }

  // The old token's hash is gone, but a live socket authenticated with it
  // would otherwise stay open until it next dropped. Close it now, with the
  // code every agent version already treats as fatal (4001), so the old
  // agent exits rather than redialing forever with a dead token.
  disconnectAgent(cluster.id, CLOSE.UNAUTHORIZED, "token rotated");

  res.json({ status: "success", cluster: updated, agent_token: token });
});

export default router;
