import { Router } from "express";
import healthRoutes from "./health.routes.js";
import investigationRoutes from "./investigation.routes.js";

const router = Router();

router.use(healthRoutes);
router.use(investigationRoutes);

export default router;
