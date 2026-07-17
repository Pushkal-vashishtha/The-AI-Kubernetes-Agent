import { Router } from "express";

const router = Router();

router.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    service: "ai-kubernetes-agent",
  });
});

export default router;
