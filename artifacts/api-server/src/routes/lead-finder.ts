import { Router, type IRouter } from "express";
import {
  CreateCompanyBody,
  EstimateSearchBody,
  GetCompanyParams,
  ListActivityQueryParams,
  ListCompaniesQueryParams,
  LoginBody,
  LogCopiedMessageBody,
  LogReplyBody,
  MarkMessageSentBody,
  UpdateCompanyStatusBody,
  UpdateSettingsBody,
  UpdateCompanyBody,
  StartSearchJobBody,
} from "@workspace/api-zod";
import {
  addActivity,
  createCompany,
  deleteSampleData,
  generateDraft,
  getCompanyScreenshotPath,
  getCompany,
  getDashboard,
  getSettings,
  listActivity,
  listCompanies,
  listFollowups,
  logCopiedMessage,
  logReply,
  markDoNotContact,
  markMessageSent,
  updateCompany,
  updateCompanyStatus,
  updateSettings,
  COMPANY_STATUSES,
} from "../lib/lead-db";
import { authState, login, logout, requireLeadAuth } from "../lib/lead-auth";
import { estimateOsmRequests } from "../lib/openstreetmap";
import {
  cancelResearchJob,
  getResearchJob,
  startCompanyRecheck,
  startOsmRefresh,
  startOsmSearch,
} from "../lib/research-jobs";
import { getPrivateScreenshot } from "../lib/screenshot-storage";

const router: IRouter = Router();
const parseCompanyId = (value: unknown) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

router.get("/auth/session", (req, res) => {
  res.json(authState(req));
});

router.post("/auth/login", (req, res) => {
  const body = LoginBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Enter your app password." });
    return;
  }
  const result = login(req, res, body.data.password);
  if (result.status !== 200) {
    res.status(result.status).json({
      error: result.error,
      setupRequired: result.status === 503,
    });
    return;
  }
  res.json({ configured: true, authenticated: true });
});

router.post("/auth/logout", (_req, res) => {
  logout(res);
  res.json({ ok: true });
});

router.use(requireLeadAuth);

router.post("/search/estimate", (req, res) => {
  const body = EstimateSearchBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Choose at least one valid area and keyword." });
    return;
  }
  try {
    res.json(estimateOsmRequests(body.data.areas, body.data.keywords));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not estimate OpenStreetMap requests." });
  }
});

router.post("/search/jobs", (req, res) => {
  const body = StartSearchJobBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Choose at least one valid area and keyword." });
    return;
  }
  try {
    res.status(202).json(startOsmSearch(body.data));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not start OpenStreetMap search." });
  }
});

router.get("/search/jobs/:jobId", (req, res) => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  if (!jobId || jobId.length > 64) {
    res.status(400).json({ error: "Invalid research job id." });
    return;
  }
  const job = getResearchJob(jobId);
  if (!job) {
    res.status(404).json({ error: "Research job not found." });
    return;
  }
  res.json(job);
});

router.post("/search/jobs/:jobId/cancel", (req, res) => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  if (!jobId || jobId.length > 64) {
    res.status(400).json({ error: "Invalid research job id." });
    return;
  }
  const job = cancelResearchJob(jobId);
  if (!job) {
    res.status(404).json({ error: "Research job not found." });
    return;
  }
  res.json(job);
});

router.delete("/sample-data", (_req, res) => {
  res.json(deleteSampleData());
});

router.get("/dashboard", (_req, res) => {
  res.json(getDashboard());
});

router.get("/companies", (req, res) => {
  const query = ListCompaniesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Invalid lead filters." });
    return;
  }
  res.json(listCompanies(query.data));
});

router.post("/companies", (req, res) => {
  const body = CreateCompanyBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Company name, area, address, rating, and review count are required." });
    return;
  }
  const company = createCompany(body.data);
  res.status(201).json(company);
});

router.get("/companies/:companyId", (req, res) => {
  const params = GetCompanyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid company id." });
    return;
  }
  const company = getCompany(params.data.companyId);
  if (!company) {
    res.status(404).json({ error: "Company not found." });
    return;
  }
  res.json(company);
});

router.get("/companies/:companyId/screenshots/:variant", async (req, res): Promise<void> => {
  const id = parseCompanyId(req.params.companyId);
  const variant = Array.isArray(req.params.variant) ? req.params.variant[0] : req.params.variant;
  if (!id || (variant !== "desktop" && variant !== "mobile")) {
    res.status(400).json({ error: "Invalid screenshot request." });
    return;
  }
  const objectPath = getCompanyScreenshotPath(id, variant);
  if (!objectPath) {
    res.status(404).json({ error: "Screenshot not found." });
    return;
  }
  try {
    const file = await getPrivateScreenshot(objectPath);
    const [metadata] = await file.getMetadata();
    res.setHeader("Content-Type", metadata.contentType ?? "image/png");
    res.setHeader("Cache-Control", "private, no-store");
    file.createReadStream()
      .on("error", (error) => {
        req.log.error({ companyId: id, variant, err: error }, "Failed to stream private screenshot");
        if (!res.headersSent) res.status(404).end();
        else res.destroy(error);
      })
      .pipe(res);
  } catch (error) {
    req.log.warn({ companyId: id, variant, err: error }, "Private screenshot was not available");
    res.status(404).json({ error: "Screenshot not found." });
  }
});

router.post("/companies/:companyId/recheck", (req, res) => {
  const id = parseCompanyId(req.params.companyId);
  if (!id) {
    res.status(400).json({ error: "Invalid company id." });
    return;
  }
  if (!getCompany(id)) {
    res.status(404).json({ error: "Company not found." });
    return;
  }
  res.status(202).json(startCompanyRecheck(id));
});

router.post("/companies/:companyId/refresh-osm", (req, res) => {
  const id = parseCompanyId(req.params.companyId);
  if (!id) {
    res.status(400).json({ error: "Invalid company id." });
    return;
  }
  const company = getCompany(id);
  if (!company) {
    res.status(404).json({ error: "Company not found." });
    return;
  }
  const job = startOsmRefresh(id);
  if (!job) {
    res.status(409).json({ error: "Only OpenStreetMap businesses can be refreshed from OSM." });
    return;
  }
  res.status(202).json(job);
});

router.patch("/companies/:companyId", (req, res) => {
  const id = parseCompanyId(req.params.companyId);
  const body = UpdateCompanyBody.safeParse(req.body);
  if (!id || !body.success) {
    res.status(400).json({ error: "Invalid company update." });
    return;
  }
  const company = updateCompany(id, body.data);
  if (!company) {
    res.status(404).json({ error: "Company not found." });
    return;
  }
  addActivity(id, "note_added", null, null, "Company details updated.");
  res.json(company);
});

router.post("/companies/:companyId/status", (req, res) => {
  const id = parseCompanyId(req.params.companyId);
  const body = UpdateCompanyStatusBody.safeParse(req.body);
  if (!id || !body.success || !COMPANY_STATUSES.includes(body.data.status as (typeof COMPANY_STATUSES)[number])) {
    res.status(400).json({ error: "Choose a valid company status." });
    return;
  }
  try {
    const company = updateCompanyStatus(id, body.data.status);
    if (!company) {
      res.status(404).json({ error: "Company not found." });
      return;
    }
    res.json(company);
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Unable to change status." });
  }
});

router.post("/companies/:companyId/do-not-contact", (req, res) => {
  const id = parseCompanyId(req.params.companyId);
  if (!id) {
    res.status(400).json({ error: "Invalid company id." });
    return;
  }
  const company = markDoNotContact(id);
  if (!company) {
    res.status(404).json({ error: "Company not found." });
    return;
  }
  res.json(company);
});

router.post("/companies/:companyId/draft", (req, res) => {
  const id = parseCompanyId(req.params.companyId);
  if (!id) {
    res.status(400).json({ error: "Invalid company id." });
    return;
  }
  const result = generateDraft(id);
  if ("error" in result) {
    res.status(result.error === "Company not found." ? 404 : 409).json({ error: result.error });
    return;
  }
  res.json(result);
});

router.post("/companies/:companyId/copy-log", (req, res) => {
  const id = parseCompanyId(req.params.companyId);
  const body = LogCopiedMessageBody.safeParse(req.body);
  if (!id || !body.success) {
    res.status(400).json({ error: "Invalid copy action." });
    return;
  }
  try {
    const result = logCopiedMessage(id, body.data.channel);
    if (!result) {
      res.status(404).json({ error: "Company not found." });
      return;
    }
    res.json(result);
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Unable to record copy." });
  }
});

router.post("/companies/:companyId/sent", (req, res) => {
  const id = parseCompanyId(req.params.companyId);
  const body = MarkMessageSentBody.safeParse(req.body);
  if (!id || !body.success) {
    res.status(400).json({ error: "Invalid sent message details." });
    return;
  }
  const result = markMessageSent(id, body.data);
  if (!result) {
    res.status(404).json({ error: "Company not found." });
    return;
  }
  if ("error" in result) {
    res.status(409).json({ error: result.error });
    return;
  }
  res.json(result);
});

router.post("/companies/:companyId/reply", (req, res) => {
  const id = parseCompanyId(req.params.companyId);
  const body = LogReplyBody.safeParse(req.body);
  if (!id || !body.success) {
    res.status(400).json({ error: "Add a short reply note." });
    return;
  }
  const company = logReply(id, body.data.note);
  if (!company) {
    res.status(404).json({ error: "Company not found." });
    return;
  }
  res.json(company);
});

router.get("/activity", (req, res) => {
  const query = ListActivityQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Invalid activity filters." });
    return;
  }
  res.json(
    listActivity({
      ...query.data,
      date: query.data.date?.toISOString().slice(0, 10),
    }),
  );
});

router.get("/followups", (_req, res) => {
  res.json(listFollowups());
});

router.get("/settings", (_req, res) => {
  res.json(getSettings());
});

router.patch("/settings", (req, res) => {
  const body = UpdateSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid settings." });
    return;
  }
  res.json(updateSettings(body.data));
});

export default router;
