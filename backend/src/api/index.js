import { Router } from "express";
import healthRoutes from "./health.routes.js";
import investigationRoutes from "./investigation.routes.js";
import clusterRoutes from "./cluster.routes.js";
import installRoutes from "./install.routes.js";

const router = Router();

router.use(healthRoutes);
router.use(investigationRoutes);
router.use(clusterRoutes);
router.use(installRoutes);

export default router;
