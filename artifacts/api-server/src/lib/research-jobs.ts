import { randomUUID } from "node:crypto";
import {
  getCompany,
  leadDb,
} from "./lead-db";
import {
  estimateOsmRequests,
  fetchOsmElement,
  listingFromElement,
  recomputeOsmValueScores,
  searchOpenStreetMapArea,
  upsertOsmListing,
} from "./openstreetmap";
import { checkCompanyWebsite } from "./website-checks";
import { logger } from "./logger";

export type ResearchJobKind = "search" | "recheck" | "osm_refresh";
export type ResearchJobStatus = "queued" | "running" | "completed" | "cancelled" | "failed";
export type ResearchJob = {
  id: string;
  kind: ResearchJobKind;
  status: ResearchJobStatus;
  phase: string;
  total: number;
  completed: number;
  requestsEstimated: number;
  requestsMade: number;
  newCompanies: number;
  updatedCompanies: number;
  skippedCompanies: number;
  checksFailed: number;
  currentLabel: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

type JobRow = Record<string, unknown>;
type SearchInput = { areas: string[]; keywords: string[] };

leadDb.prepare(`
  UPDATE research_jobs SET status = 'failed', phase = 'failed',
    error = 'The API server restarted before this job finished.',
    current_label = NULL, updated_at = ?
  WHERE status IN ('queued', 'running')
`).run(new Date().toISOString());

function asJob(row: JobRow): ResearchJob {
  return {
    id: String(row.id),
    kind: String(row.kind) as ResearchJobKind,
    status: String(row.status) as ResearchJobStatus,
    phase: String(row.phase),
    total: Number(row.total),
    completed: Number(row.completed),
    requestsEstimated: Number(row.requests_estimated),
    requestsMade: Number(row.requests_made),
    newCompanies: Number(row.new_companies),
    updatedCompanies: Number(row.updated_companies),
    skippedCompanies: Number(row.skipped_companies),
    checksFailed: Number(row.checks_failed),
    currentLabel: row.current_label == null ? null : String(row.current_label),
    error: row.error == null ? null : String(row.error),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function getResearchJob(id: string) {
  const row = leadDb.prepare("SELECT * FROM research_jobs WHERE id = ?").get(id) as JobRow | undefined;
  return row ? asJob(row) : null;
}

function createResearchJob(
  kind: ResearchJobKind,
  total: number,
  requestsEstimated: number,
  input: unknown,
) {
  const id = randomUUID();
  const now = new Date().toISOString();
  leadDb.prepare(`
    INSERT INTO research_jobs (
      id, kind, status, phase, total, completed, requests_estimated, requests_made,
      input_json, created_at, updated_at
    ) VALUES (?, ?, 'queued', 'queued', ?, 0, ?, 0, ?, ?, ?)
  `).run(id, kind, total, requestsEstimated, JSON.stringify(input), now, now);
  return getResearchJob(id)!;
}

const jobColumnMap: Record<string, string> = {
  status: "status",
  phase: "phase",
  total: "total",
  completed: "completed",
  requestsEstimated: "requests_estimated",
  requestsMade: "requests_made",
  newCompanies: "new_companies",
  updatedCompanies: "updated_companies",
  skippedCompanies: "skipped_companies",
  checksFailed: "checks_failed",
  currentLabel: "current_label",
  error: "error",
};

function updateResearchJob(id: string, patch: Partial<ResearchJob>) {
  const entries = Object.entries(patch).filter(([key]) => key in jobColumnMap);
  if (entries.length) {
    const assignments = entries.map(([key]) => `${jobColumnMap[key]} = ?`).join(", ");
    const values = entries.map(([, value]) => value ?? null);
    leadDb.prepare(`UPDATE research_jobs SET ${assignments}, updated_at = ? WHERE id = ?`).run(
      ...values,
      new Date().toISOString(),
      id,
    );
  }
  return getResearchJob(id);
}

export function cancelResearchJob(id: string) {
  const job = getResearchJob(id);
  if (!job) return null;
  if (job.status === "queued") {
    leadDb.prepare(`
      UPDATE research_jobs SET status = 'cancelled', phase = 'cancelled',
        cancel_requested = 1, updated_at = ? WHERE id = ?
    `).run(new Date().toISOString(), id);
  } else if (job.status === "running") {
    leadDb.prepare(`
      UPDATE research_jobs SET cancel_requested = 1, phase = 'cancelling',
        updated_at = ? WHERE id = ?
    `).run(new Date().toISOString(), id);
  }
  return getResearchJob(id);
}

function cancellationRequested(id: string) {
  const row = leadDb.prepare("SELECT cancel_requested FROM research_jobs WHERE id = ?").get(id) as { cancel_requested: number } | undefined;
  return !row || Number(row.cancel_requested) === 1;
}

function incrementRequestCount(id: string) {
  leadDb.prepare("UPDATE research_jobs SET requests_made = requests_made + 1, updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id);
}

let activeWebsiteChecks = 0;
const websiteCheckWaiters: Array<() => void> = [];

async function withWebsiteCheckLimit<T>(work: () => Promise<T>): Promise<T> {
  if (activeWebsiteChecks >= 2) {
    await new Promise<void>((resolve) => websiteCheckWaiters.push(resolve));
  }
  activeWebsiteChecks += 1;
  try {
    return await work();
  } finally {
    activeWebsiteChecks -= 1;
    websiteCheckWaiters.shift()?.();
  }
}

function isCheckStale(companyId: number) {
  const row = leadDb.prepare("SELECT MAX(checked_at) AS checkedAt FROM checks WHERE company_id = ?").get(companyId) as { checkedAt: string | null };
  return !row.checkedAt || Date.now() - new Date(row.checkedAt).getTime() >= 30 * 24 * 60 * 60 * 1000;
}

function recordSearch(area: string, keywords: string[], requestCount: number, resultsCount: number) {
  leadDb.prepare(`
    INSERT INTO searches (keyword, area, ran_at, api_calls, results_count)
    VALUES (?, ?, ?, ?, ?)
  `).run(keywords.join(", "), area, new Date().toISOString(), requestCount, resultsCount);
}

function failJob(id: string, error: unknown) {
  const message = error instanceof Error ? error.message : "Research job failed.";
  updateResearchJob(id, { status: "failed", phase: "failed", error: message.slice(0, 500), currentLabel: null });
  logger.error({ jobId: id, err: error }, "Lead research job failed");
}

async function runSearchJob(jobId: string, input: SearchInput) {
  const warnings: string[] = [];
  try {
    updateResearchJob(jobId, { status: "running", phase: "searching", currentLabel: "Preparing area searches" });
    const found = new Map<number, { osmType: string; osmId: string }>();
    let completedAreas = 0;
    let createdCount = 0;
    let updatedCount = 0;
    for (const area of input.areas) {
      if (cancellationRequested(jobId)) break;
      updateResearchJob(jobId, {
        phase: "searching",
        currentLabel: `Searching ${area} for ${input.keywords.length} selected categories`,
      });
      const beforeCalls = getResearchJob(jobId)?.requestsMade ?? 0;
      let resultsCount = 0;
      try {
        const result = await searchOpenStreetMapArea(area, input.keywords, () => incrementRequestCount(jobId));
        for (const listing of result.listings) {
          const record = upsertOsmListing(listing);
          const wasAlreadyFound = found.has(record.id);
          found.set(record.id, { osmType: listing.osmType, osmId: listing.osmId });
          if (!wasAlreadyFound) {
            if (record.isNew) createdCount += 1;
            else updatedCount += 1;
          }
        }
        resultsCount = result.listings.length;
      } catch (error) {
        warnings.push(`${area}: ${error instanceof Error ? error.message : "OpenStreetMap query failed."}`);
      }
      const afterCalls = getResearchJob(jobId)?.requestsMade ?? beforeCalls;
      recordSearch(area, input.keywords, afterCalls - beforeCalls, resultsCount);
      completedAreas += 1;
      updateResearchJob(jobId, {
        completed: completedAreas,
        newCompanies: createdCount,
        updatedCompanies: updatedCount,
        currentLabel: `Finished ${area}; ${found.size} unique businesses found`,
      });
    }
    if (cancellationRequested(jobId)) {
      updateResearchJob(jobId, { status: "cancelled", phase: "cancelled", currentLabel: null });
      return;
    }

    recomputeOsmValueScores();
    const companyIds = [...found.keys()];
    const idsToCheck = companyIds.filter(isCheckStale);
    const alreadyChecked = companyIds.length - idsToCheck.length;
    const searchProgress = getResearchJob(jobId)?.completed ?? completedAreas;
    updateResearchJob(jobId, {
      phase: "checking",
      total: searchProgress + idsToCheck.length,
      skippedCompanies: (getResearchJob(jobId)?.skippedCompanies ?? 0) + alreadyChecked,
      currentLabel: idsToCheck.length ? `Checking websites for ${idsToCheck.length} businesses` : "All matching businesses have recent website checks",
    });

    let checksFailed = 0;
    let completedChecks = 0;
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < idsToCheck.length) {
        if (cancellationRequested(jobId)) return;
        const companyId = idsToCheck[nextIndex++]!;
        const company = getCompany(companyId);
        if (!company) {
          completedChecks += 1;
          continue;
        }
        updateResearchJob(jobId, { currentLabel: `Checking ${company.name}` });
        const result = await withWebsiteCheckLimit(() => checkCompanyWebsite(companyId));
        if (result.failed) checksFailed += 1;
        completedChecks += 1;
        updateResearchJob(jobId, {
          completed: searchProgress + completedChecks,
          checksFailed,
          currentLabel: `Checked ${completedChecks} of ${idsToCheck.length} businesses`,
        });
      }
    };
    await Promise.all([worker(), worker()]);
    if (cancellationRequested(jobId)) {
      updateResearchJob(jobId, { status: "cancelled", phase: "cancelled", checksFailed, currentLabel: null });
      return;
    }
    updateResearchJob(jobId, {
      status: "completed",
      phase: "completed",
      checksFailed,
      currentLabel: null,
      error: warnings.length ? warnings.slice(0, 3).join(" · ").slice(0, 500) : null,
    });
  } catch (error) {
    failJob(jobId, error);
  }
}

async function runRecheckJob(jobId: string, companyId: number) {
  try {
    updateResearchJob(jobId, { status: "running", phase: "checking", currentLabel: "Preparing website checks" });
    const company = getCompany(companyId);
    if (!company) throw new Error("Company not found.");
    await withWebsiteCheckLimit(() => checkCompanyWebsite(companyId));
    const latest = getCompany(companyId);
    const failed = latest?.checks?.[0]?.checkStatus === "failed";
    updateResearchJob(jobId, {
      status: cancellationRequested(jobId) ? "cancelled" : "completed",
      phase: cancellationRequested(jobId) ? "cancelled" : "completed",
      completed: 1,
      checksFailed: failed ? 1 : 0,
      currentLabel: null,
      error: failed ? String(latest?.checks?.[0]?.lastError ?? "Some checks failed after one retry.") : null,
    });
  } catch (error) {
    failJob(jobId, error);
  }
}

async function runOsmRefreshJob(jobId: string, companyId: number, osmType: string, osmId: string) {
  try {
    updateResearchJob(jobId, { status: "running", phase: "refreshing", currentLabel: "Refreshing OpenStreetMap record" });
    const company = getCompany(companyId);
    if (!company) throw new Error("Company not found.");
    const element = await fetchOsmElement(osmType, osmId, () => incrementRequestCount(jobId));
    if (!element) throw new Error("This record is no longer present in OpenStreetMap.");
    const listing = listingFromElement(element, company.area, [company.keyword]);
    if (!listing) throw new Error("OpenStreetMap returned no name for this business.");
    upsertOsmListing(listing);
    recomputeOsmValueScores();
    updateResearchJob(jobId, {
      status: "completed",
      phase: "completed",
      completed: 1,
      updatedCompanies: 1,
      currentLabel: null,
    });
  } catch (error) {
    failJob(jobId, error);
  }
}

function normalizeInput(input: SearchInput): SearchInput {
  const unique = (values: string[], maximum: number) =>
    [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, maximum);
  const areas = unique(input.areas, 20);
  const keywords = unique(input.keywords, 30);
  if (!areas.length || !keywords.length) throw new Error("Choose at least one area and one keyword.");
  if (areas.some((value) => value.length > 100) || keywords.some((value) => value.length > 100)) {
    throw new Error("Search areas and keywords must be 100 characters or fewer.");
  }
  return { areas, keywords };
}

export function startOsmSearch(input: SearchInput) {
  const normalized = normalizeInput(input);
  const estimate = estimateOsmRequests(normalized.areas, normalized.keywords);
  const job = createResearchJob("search", normalized.areas.length, estimate.totalCalls, normalized);
  void runSearchJob(job.id, normalized);
  return job;
}

export function startCompanyRecheck(companyId: number) {
  const job = createResearchJob("recheck", 1, 0, { companyId });
  void runRecheckJob(job.id, companyId);
  return job;
}

export function isOsmRecordStale(companyId: number) {
  const company = getCompany(companyId);
  if (!company || company.source !== "openstreetmap") return false;
  if (!company.osmUpdatedAt) return true;
  return Date.now() - new Date(company.osmUpdatedAt).getTime() >= 30 * 24 * 60 * 60 * 1000;
}

export function startOsmRefresh(companyId: number) {
  const company = getCompany(companyId);
  if (!company || company.source !== "openstreetmap" || !company.osmType || !company.osmId) return null;
  const job = createResearchJob("osm_refresh", 1, 1, { companyId });
  void runOsmRefreshJob(job.id, companyId, company.osmType, company.osmId);
  return job;
}
