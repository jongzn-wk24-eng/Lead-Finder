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
  PasteCompaniesBody,
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
import { estimateOsmSearch,startOsmSearch,startOsmRecheck } from "../lib/osm-jobs";
import { normalizeWebsite } from "../lib/osm/normalize";

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
router.use((req,res,next)=>{
  const path=req.path.toLowerCase().replace(/\/+$/,"");
  if(path==="/search/test" || path.endsWith("/refresh-google")){
    res.status(410).json({error:"Google Places is disabled. Import from OpenStreetMap instead."});return;
  }
  if(req.method==="POST"&&inDemoMode()&&(["/companies","/companies/paste"].includes(path)||path.endsWith("/refresh-osm"))){
    res.status(409).json({error:"Switch Demo mode OFF before adding real companies or running external research."});return;
  }
  next();
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
    res.status(409).json({ error: "Switch Demo mode OFF before running external research. Demo mode never calls Overpass or Gemini." });
    return;
  }
  next();
});
router.post("/demo-data", async (_req, res) => {
  res.json(await loadDemoData());
});
// A deliberate one-call smoke test: transient Google fields in this response only.
// It shares production dedupe/accounting, but never starts checks or live enrichment.
router.post("/search/test", (_req, res) => {
  res.status(410).json({error:"Google Places is disabled. Import from OpenStreetMap instead."});
});

router.post("/search/estimate", async (req, res) => {
  const body = EstimateSearchBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Choose at least one valid area and keyword." });
    return;
  }
  try {
    res.json(await estimateOsmSearch(body.data));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not estimate Overpass requests." });
  }
});

router.post("/search/jobs", async (req, res) => {
  const body = StartSearchJobBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Choose at least one valid area and keyword." });
    return;
  }
  try {
    res.status(202).json(await startOsmSearch(body.data));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not start OpenStreetMap import." });
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
  const raw:Record<string,unknown>={...req.query};
  for(const key of ["showAll","hasWebsite","hasContact"]){
    if(raw[key]===undefined)continue;
    if(raw[key]==="true"||raw[key]==="1")raw[key]=true;
    else if(raw[key]==="false"||raw[key]==="0")raw[key]=false;
    else {res.status(400).json({error:`Invalid ${key} filter.`});return;}
  }
  const query = ListCompaniesQueryParams.safeParse(raw);
  if (!query.success) {
    res.status(400).json({ error: "Invalid lead filters." });
    return;
  }
  const filter = query.data;
  res.json(await listCompanies({...filter,keyword:typeof req.query.keyword==="string"?req.query.keyword:undefined}));
});

router.post("/companies/paste",async(req,res)=>{
  const body=PasteCompaniesBody.safeParse(req.body);
  if(!body.success){res.status(400).json({error:"Paste one company per line: name, website, area."});return;}
  const lines=body.data.text.split(/\r?\n/).filter(v=>v.trim());
  if(lines.length>100){res.status(400).json({error:"Paste at most 100 companies at a time."});return;}
  const errors:string[]=[],jobIds:string[]=[];let created=0;
  for(const [i,line] of lines.entries()){
    const parts=line.match(/("(?:[^"]|"")*"|[^,]*)(,|$)/g)?.filter(Boolean).map(v=>v.replace(/,$/,"").trim().replace(/^"|"$/g,"").replace(/""/g,'"'))??[];
    const [name,websiteUrl,area]=parts;
    if(!name||!normalizeWebsite(websiteUrl).websiteUrl){errors.push(`Line ${i+1}: name and a valid website are required.`);continue;}
    const company=await createCompany({name,websiteUrl,area:area||"Other KL"});
    if(company){created++;jobIds.push((await startOsmRecheck(company.id)).id);}
  }
  res.status(201).json({created,errors,jobIds});
});

router.post("/companies", async (req, res) => {
  const body = CreateCompanyBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Company name and website are required." });
    return;
  }
  const web=normalizeWebsite(body.data.websiteUrl);
  if(!web.websiteUrl&&!web.socialUrl){res.status(400).json({error:"Enter a valid http or https website."});return;}
  const company = (await createCompany(body.data));
  if(company)await startOsmRecheck(company.id);
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
  res.json(company);
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
  try{res.status(202).json(await startOsmRecheck(id));}
  catch(error){res.status(409).json({error:error instanceof Error?error.message:"Could not re-check."});}
});

router.post("/companies/:companyId/refresh-osm",async(req,res)=>{
  const company=await getCompany(Number(req.params.companyId));
  if(!company||company.source!=="openstreetmap"){res.status(409).json({error:"Only OpenStreetMap records can be refreshed."});return;}
  try{res.status(202).json(await startOsmSearch({keywords:[company.keyword],refresh:true},"osm_refresh"));}
  catch(error){res.status(400).json({error:error instanceof Error?error.message:"Could not refresh."});}
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
  if(body.data.websiteUrl&&!normalizeWebsite(body.data.websiteUrl).websiteUrl&&!normalizeWebsite(body.data.websiteUrl).socialUrl){
    res.status(400).json({error:"Enter a valid http or https website."});return;
  }
  const company = (await updateCompany(id, body.data));
  if (!company) {
    res.status(404).json({ error: "Company not found." });
    return;
  }
  (await addActivity(id, "note_added", null, null, "Company details updated."));
  if(!company.isDoNotContact&&("websiteUrl" in body.data||"websiteConfirmedNone" in body.data))await startOsmRecheck(id);
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
  const result = await generateDraft(id);
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
  try{res.json(await updateSettings(body.data));}
  catch(error){res.status(400).json({error:error instanceof Error?error.message:"Could not save settings."});}
});

export default router;
