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
  exportCompaniesCsv,
  exportOutreachCsv,
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
import { withLiveCompanyNames, withLiveGoogleData, withLiveGoogleList } from "../lib/live-google";
import {
  cancelResearchJob,
  estimateGooglePlacesSearch,
  getResearchJob,
  startCompanyRecheck,
  startGoogleRefresh,
  startGooglePlacesSearch,
} from "../lib/research-jobs";
import { getPrivateScreenshot } from "../lib/screenshot-storage";
import { inDemoMode, withDataMode } from "../lib/lead-postgres";
import { loadDemoData, recordGooglePlacesRequest, upsertGooglePlace } from "../lib/lead-db";
import { searchGooglePlacesText } from "../lib/google-places";

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
router.use(async (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  const settings = await getSettings();
  withDataMode(settings.demoMode === true, next);
});

router.use("/companies/:companyId", async (req, res, next) => {
  const id = parseCompanyId(req.params.companyId);
  if (!id || !await getCompany(id)) {
    res.status(404).json({ error: "Company not found in the current data mode." });
    return;
  }
  next();
});
router.use(["/search/jobs", "/search/test", "/companies/:companyId/recheck", "/companies/:companyId/refresh-google"], (req, res, next) => {
  if (req.method === "POST" && inDemoMode()) {
    res.status(409).json({ error: "Switch Demo mode OFF before running external research. Demo mode never calls Google or Gemini." });
    return;
  }
  next();
});
router.post("/demo-data", async (_req, res) => {
  res.json(await loadDemoData());
});
// A deliberate one-call smoke test: transient Google fields in this response only.
// It shares production dedupe/accounting, but never starts checks or live enrichment.
router.post("/search/test", async (req, res) => {
  const body = EstimateSearchBody.safeParse(req.body);
  if (!body.success || body.data.areas.length !== 1 || body.data.keywords.length !== 1) {
    res.status(400).json({ error: "Choose exactly 1 keyword and 1 area for the one-call test." });
    return;
  }
  const area = body.data.areas[0]!;
  const keyword = body.data.keywords[0]!;
  try {
    const places = await searchGooglePlacesText(keyword, area, () => recordGooglePlacesRequest(keyword, area));
    const results = [];
    const seen = new Set<string>();
    for (const place of places) {
      if (seen.has(place.id)) continue;
      seen.add(place.id);
      const stored = await upsertGooglePlace({ placeId: place.id, area, keyword });
      results.push({
        id: stored.id, placeId: place.id, isNew: stored.isNew,
        name: place.displayName?.text ?? "", address: place.formattedAddress ?? "",
        phone: place.nationalPhoneNumber ?? null, websiteUrl: place.websiteUri ?? null,
        mapsUrl: place.googleMapsUri ?? null, rating: place.rating ?? null,
        reviewCount: place.userRatingCount ?? null, attributions: place.attributions ?? [],
      });
    }
    res.json({ requestsMade: 1, results });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Google Places search failed." });
  }
});

router.post("/search/estimate", (req, res) => {
  const body = EstimateSearchBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Choose at least one valid area and keyword." });
    return;
  }
  try {
    res.json(estimateGooglePlacesSearch(body.data));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not estimate Google Places requests." });
  }
});

router.post("/search/jobs", async (req, res) => {
  const body = StartSearchJobBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Choose at least one valid area and keyword." });
    return;
  }
  try {
    res.status(202).json((await startGooglePlacesSearch(body.data)));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not start Google Places search." });
  }
});

router.get("/search/jobs/:jobId", async (req, res) => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  if (!jobId || jobId.length > 64) {
    res.status(400).json({ error: "Invalid research job id." });
    return;
  }
  const job = (await getResearchJob(jobId));
  if (!job) {
    res.status(404).json({ error: "Research job not found." });
    return;
  }
  res.json(job);
});

router.post("/search/jobs/:jobId/cancel", async (req, res) => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  if (!jobId || jobId.length > 64) {
    res.status(400).json({ error: "Invalid research job id." });
    return;
  }
  const job = (await cancelResearchJob(jobId));
  if (!job) {
    res.status(404).json({ error: "Research job not found." });
    return;
  }
  res.json(job);
});

router.delete("/sample-data", async (_req, res) => {
  res.json((await deleteSampleData()));
});

router.get("/dashboard", async (_req, res) => {
  res.json((await getDashboard()));
});

router.get("/companies", async (req, res): Promise<void> => {
  const query = ListCompaniesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Invalid lead filters." });
    return;
  }
  const filter = query.data;
  const stored = await listCompanies(filter);
  const live = req.query.live === "1" ? await withLiveGoogleList(stored) : stored.map(company => ({
    ...company, googleDataWarning: company.source === "google_places" ? "Live details have not been requested. Open the company and choose Load live Google data (1 Place Details call)." : null,
    googleAttributions: [],
  }));
  const results = live.filter((company) => {
    if (company.googleDataWarning) return true;
    if (!filter.showAll && (company.valueScore < 15 || company.problemScore < 25)) return false;
    if (filter.search && !`${company.name} ${company.area} ${company.keyword}`.toLowerCase().includes(filter.search.toLowerCase().trim())) return false;
    if (filter.hasWebsite != null && Boolean(company.websiteUrl) !== filter.hasWebsite) return false;
    if (filter.hasContact != null && Boolean(company.phone || company.email || company.whatsapp) !== filter.hasContact) return false;
    return true;
  }).sort((a, b) => b.opportunityScore - a.opportunityScore || a.name.localeCompare(b.name));
  res.json(results);
});

router.post("/companies", async (req, res) => {
  const body = CreateCompanyBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Company name, area, address, rating, and review count are required." });
    return;
  }
  const company = (await createCompany(body.data));
  res.status(201).json(company);
});

router.get("/export.csv", async (req, res) => {
  const type = req.query.type;
  if (type !== "companies" && type !== "outreach") {
    res.status(400).json({ error: "Choose companies or outreach for the CSV export." });
    return;
  }
  const date = new Date().toISOString().slice(0, 10);
  const csv = type === "companies" ? (await exportCompaniesCsv()) : (await exportOutreachCsv());
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="kl-lead-${type}-${date}.csv"`);
  res.send(csv);
});

router.get("/companies/:companyId", async (req, res): Promise<void> => {
  const params = GetCompanyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid company id." });
    return;
  }
  const company = (await getCompany(params.data.companyId));
  if (!company) {
    res.status(404).json({ error: "Company not found." });
    return;
  }
  const live = req.query.live === "1" ? await withLiveGoogleData(company) : {
    ...company, googleDataWarning: company.source === "google_places" ? "Live details have not been requested. Choose Load live Google data (1 Place Details call)." : null,
    googleAttributions: [],
  };
  res.json({ ...live, activity: company.activity.map((item) => ({ ...item, companyName: live.name })) });
});

router.get("/companies/:companyId/screenshots/:variant", async (req, res): Promise<void> => {
  const id = parseCompanyId(req.params.companyId);
  const variant = Array.isArray(req.params.variant) ? req.params.variant[0] : req.params.variant;
  if (!id || (variant !== "desktop" && variant !== "mobile")) {
    res.status(400).json({ error: "Invalid screenshot request." });
    return;
  }
  const objectPath = (await getCompanyScreenshotPath(id, variant));
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

router.post("/companies/:companyId/recheck", async (req, res) => {
  const id = parseCompanyId(req.params.companyId);
  if (!id) {
    res.status(400).json({ error: "Invalid company id." });
    return;
  }
  if (!(await getCompany(id))) {
    res.status(404).json({ error: "Company not found." });
    return;
  }
  res.status(202).json((await startCompanyRecheck(id)));
});

router.post("/companies/:companyId/refresh-google", async (req, res) => {
  const id = parseCompanyId(req.params.companyId);
  if (!id) {
    res.status(400).json({ error: "Invalid company id." });
    return;
  }
  const company = (await getCompany(id));
  if (!company) {
    res.status(404).json({ error: "Company not found." });
    return;
  }
  try {
    const job = (await startGoogleRefresh(id));
    if (!job) {
      res.status(409).json({ error: "Only Google Places businesses can be refreshed." });
      return;
    }
    res.status(202).json(job);
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "Google Places refresh is unavailable." });
  }
});

router.patch("/companies/:companyId", async (req, res) => {
  const id = parseCompanyId(req.params.companyId);
  const body = UpdateCompanyBody.safeParse(req.body);
  if (!id || !body.success) {
    res.status(400).json({ error: "Invalid company update." });
    return;
  }
  const company = (await updateCompany(id, body.data));
  if (!company) {
    res.status(404).json({ error: "Company not found." });
    return;
  }
  (await addActivity(id, "note_added", null, null, "Company details updated."));
  res.json(company);
});

router.post("/companies/:companyId/status", async (req, res) => {
  const id = parseCompanyId(req.params.companyId);
  const body = UpdateCompanyStatusBody.safeParse(req.body);
  if (!id || !body.success || !COMPANY_STATUSES.includes(body.data.status as (typeof COMPANY_STATUSES)[number])) {
    res.status(400).json({ error: "Choose a valid company status." });
    return;
  }
  try {
    const company = (await updateCompanyStatus(id, body.data.status));
    if (!company) {
      res.status(404).json({ error: "Company not found." });
      return;
    }
    res.json(company);
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Unable to change status." });
  }
});

router.post("/companies/:companyId/do-not-contact", async (req, res) => {
  const id = parseCompanyId(req.params.companyId);
  if (!id) {
    res.status(400).json({ error: "Invalid company id." });
    return;
  }
  const company = (await markDoNotContact(id));
  if (!company) {
    res.status(404).json({ error: "Company not found." });
    return;
  }
  res.json(company);
});

router.post("/companies/:companyId/draft", async (req, res): Promise<void> => {
  const id = parseCompanyId(req.params.companyId);
  if (!id) {
    res.status(400).json({ error: "Invalid company id." });
    return;
  }
  const company = (await getCompany(id));
  if (!company) {
    res.status(404).json({ error: "Company not found." });
    return;
  }
  const live = await withLiveGoogleData(company);
  if (live.googleDataWarning) {
    res.status(503).json({ error: "Live Google details are unavailable. Try again before drafting." });
    return;
  }
  const result = await generateDraft(id, company.source === "google_places" ? live.name : undefined);
  if ("error" in result) {
    res.status(result.error === "Company not found." ? 404 : 409).json({ error: result.error });
    return;
  }
  res.json(result);
});

router.post("/companies/:companyId/copy-log", async (req, res) => {
  const id = parseCompanyId(req.params.companyId);
  const body = LogCopiedMessageBody.safeParse(req.body);
  if (!id || !body.success) {
    res.status(400).json({ error: "Invalid copy action." });
    return;
  }
  try {
    const result = (await logCopiedMessage(id, body.data.channel));
    if (!result) {
      res.status(404).json({ error: "Company not found." });
      return;
    }
    res.json(result);
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Unable to record copy." });
  }
});

router.post("/companies/:companyId/sent", async (req, res) => {
  const id = parseCompanyId(req.params.companyId);
  const body = MarkMessageSentBody.safeParse(req.body);
  if (!id || !body.success) {
    res.status(400).json({ error: "Invalid sent message details." });
    return;
  }
  const result = (await markMessageSent(id, body.data));
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

router.post("/companies/:companyId/reply", async (req, res) => {
  const id = parseCompanyId(req.params.companyId);
  const body = LogReplyBody.safeParse(req.body);
  if (!id || !body.success) {
    res.status(400).json({ error: "Add a short reply note." });
    return;
  }
  const company = (await logReply(id, body.data.note));
  if (!company) {
    res.status(404).json({ error: "Company not found." });
    return;
  }
  res.json(company);
});

router.get("/activity", async (req, res): Promise<void> => {
  const query = ListActivityQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Invalid activity filters." });
    return;
  }
  const rows = (await listActivity({
      ...query.data,
      date: query.data.date?.toISOString().slice(0, 10),
    }));
  const search = query.data.search?.toLowerCase().trim();
  res.json(search ? rows.filter((row) => `${row.companyName} ${row.note}`.toLowerCase().includes(search)) : rows);
});

router.get("/followups", async (_req, res): Promise<void> => {
  res.json(await listFollowups());
});

router.get("/settings", async (_req, res) => {
  res.json((await getSettings()));
});

router.patch("/settings", async (req, res) => {
  const body = UpdateSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid settings." });
    return;
  }
  res.json((await updateSettings(body.data)));
});

export default router;
