import { Router, type IRouter } from "express";
import healthRouter from "./health";
import leadFinderRouter from "./lead-finder";

const router: IRouter = Router();

router.use(leadFinderRouter);
router.use(healthRouter);

export default router;
