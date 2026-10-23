import { randomUUID } from "node:crypto";
import { getCompany, leadDb, markGoogleLiveLookup, recordGooglePlacesRequest, upsertGooglePlace } from "./lead-db";
import {
  estimateGooglePlacesRequests,
  fetchGooglePlaceDetails,
  MAX_GOOGLE_SEARCH_PAIRS,
  searchGooglePlacesText,
  type GooglePlace,
} from "./google-places";
import { checkCompanyWebsite } from "./website-checks";
import { logger } from "./logger";

export type ResearchJobKind = "search" | "recheck" | "google_refresh";
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

(await leadDb.prepare(`
  UPDATE research_jobs SET status = 'failed', phase = 'failed',
    error = 'The API server restarted before this job finished.',
    current_label = NULL, updated_at = ?
  WHERE status IN ('queued', 'running')
`).run(new Date().toISOString()));

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

export async function getResearchJob(id: string) {
  const row = (await leadDb.prepare("SELECT * FROM research_jobs WHERE id = ?").get(id)) as JobRow | undefined;
  return row ? asJob(row) : null;
}

async function createResearchJob(kind: ResearchJobKind, total: number, requestsEstimated: number, input: unknown) {
  const id = randomUUID();
  const now = new Date().toISOString();
  (await leadDb.prepare(`
    INSERT INTO research_jobs (
      id, kind, status, phase, total, completed, requests_estimated, requests_made,
      input_json, created_at, updated_at
    ) VALUES (?, ?, 'queued', 'queued', ?, 0, ?, 0, ?, ?, ?)
  `).run(id, kind, total, requestsEstimated, JSON.stringify(input), now, now));
  return (await getResearchJob(id))!;
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

async function updateResearchJob(id: string, patch: Partial<ResearchJob>) {
  const entries = Object.entries(patch).filter(([key]) => key in jobColumnMap);
  if (entries.length) {
    const assignments = entries.map(([key]) => `${jobColumnMap[key]} = ?`).join(", ");
    const values = entries.map(([, value]) => value ?? null);
    (await leadDb.prepare(`UPDATE research_jobs SET ${assignments}, updated_at = ? WHERE id = ?`).run(
      ...values,
      new Date().toISOString(),
      id,
    ));
  }
  return (await getResearchJob(id));
}

export async function cancelResearchJob(id: string) {
  const job = (await getResearchJob(id));
  if (!job) return null;
  if (job.status === "queued") {
    (await leadDb.prepare(`
      UPDATE research_jobs SET status = 'cancelled', phase = 'cancelled',
        cancel_requested = 1, updated_at = ? WHERE id = ?
    `).run(new Date().toISOString(), id));
  } else if (job.status === "running") {
    (await leadDb.prepare(`
      UPDATE research_jobs SET cancel_requested = 1, phase = 'cancelling',
        updated_at = ? WHERE id = ?
    `).run(new Date().toISOString(), id));
  }
  return (await getResearchJob(id));
}

async function cancellationRequested(id: string) {
  const row = (await leadDb.prepare("SELECT cancel_requested FROM research_jobs WHERE id = ?").get(id)) as { cancel_requested: number } | undefined;
  return !row || Number(row.cancel_requested) === 1;
}

async function incrementRequestCount(id: string) {
  (await leadDb.prepare("UPDATE research_jobs SET requests_made = requests_made + 1, updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id));
}

let activeWebsiteChecks = 0;
const websiteCheckWaiters: Array<() => void> = [];

async function withWebsiteCheckLimit<T>(work: () => Promise<T>): Promise<T> {
  if (activeWebsiteChecks >= 2) await new Promise<void>((resolve) => websiteCheckWaiters.push(resolve));
  activeWebsiteChecks += 1;
  try {
    return await work();
  } finally {
    activeWebsiteChecks -= 1;
    websiteCheckWaiters.shift()?.();
  }
}

async function isCheckStale(companyId: number) {
  const row = (await leadDb.prepare("SELECT MAX(checked_at) AS checkedAt FROM checks WHERE company_id = ?").get(companyId)) as { checkedAt: string | null };
  return !row.checkedAt || Date.now() - new Date(row.checkedAt).getTime() >= 30 * 24 * 60 * 60 * 1000;
}

async function failJob(id: string, error: unknown) {
  const message = error instanceof Error ? error.message : "Research job failed.";
  (await updateResearchJob(id, { status: "failed", phase: "failed", error: message.slice(0, 500), currentLabel: null }));
  logger.error({ jobId: id, err: error }, "Lead research job failed");
}

function listingFromGooglePlace(place: GooglePlace, area: string, keyword: string) {
  const name = place.displayName?.text?.trim();
  if (!name || place.businessStatus === "CLOSED_PERMANENTLY") return null;
  const placeId = place.id.replace(/^places\//, "");
  return {
    placeId,
    area,
    keyword,
  };
}

async function runSearchJob(jobId: string, input: SearchInput) {
  const warnings: string[] = [];
  try {
    const pairs = input.areas.flatMap((area) => input.keywords.map((keyword) => ({ area, keyword })));
    (await updateResearchJob(jobId, {
      status: "running",
      phase: "searching",
      currentLabel: `Searching ${pairs.length} keyword-area pairs`,
    }));
    const found = new Set<number>();
    const livePlaces = new Map<number, GooglePlace>();
    let completedPairs = 0;
    let createdCount = 0;
    let updatedCount = 0;

    for (const { area, keyword } of pairs) {
      if ((await cancellationRequested(jobId))) break;
      (await updateResearchJob(jobId, {
        phase: "searching",
        currentLabel: `Searching ${keyword} in ${area}`,
      }));
      let places: GooglePlace[] = [];
      try {
        places = await searchGooglePlacesText(keyword, area, async () => {
          (await incrementRequestCount(jobId));
          (await recordGooglePlacesRequest(keyword, area));
        });
        for (const place of places) {
          const listing = listingFromGooglePlace(place, area, keyword);
          if (!listing) continue;
          const record = (await upsertGooglePlace(listing));
          livePlaces.set(record.id, place);
          if (!found.has(record.id)) {
            found.add(record.id);
            if (record.isNew) createdCount += 1;
            else updatedCount += 1;
          }
        }
      } catch (error) {
        warnings.push(`${keyword} · ${area}: ${error instanceof Error ? error.message : "Google Places search failed."}`);
      }
      completedPairs += 1;
      (await updateResearchJob(jobId, {
        completed: completedPairs,
        newCompanies: createdCount,
        updatedCompanies: updatedCount,
        currentLabel: `Finished ${completedPairs} of ${pairs.length} searches; ${found.size} unique businesses found`,
      }));
    }
    if ((await cancellationRequested(jobId))) {
      (await updateResearchJob(jobId, { status: "cancelled", phase: "cancelled", currentLabel: null }));
      return;
    }

    const companyIds = [...found];
    const stale = await Promise.all(companyIds.map(isCheckStale));
    const idsToCheck = companyIds.filter((_, index) => stale[index]);
    const alreadyChecked = companyIds.length - idsToCheck.length;
    (await updateResearchJob(jobId, {
      phase: "checking",
      total: completedPairs + idsToCheck.length,
      skippedCompanies: alreadyChecked,
      currentLabel: idsToCheck.length
        ? `Checking websites and screenshots for ${idsToCheck.length} businesses`
        : "All matching businesses have recent website checks",
    }));

    let checksFailed = 0;
    let completedChecks = 0;
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < idsToCheck.length) {
        if ((await cancellationRequested(jobId))) return;
        const companyId = idsToCheck[nextIndex++]!;
        const company = (await getCompany(companyId));
        if (!company) {
          completedChecks += 1;
          continue;
        }
        (await updateResearchJob(jobId, { currentLabel: `Checking ${company.name}` }));
        const result = await withWebsiteCheckLimit(async () => (await checkCompanyWebsite(companyId, livePlaces.get(companyId)?.websiteUri ?? null)));
        if (result.failed) checksFailed += 1;
        completedChecks += 1;
        (await updateResearchJob(jobId, {
          completed: completedPairs + completedChecks,
          checksFailed,
          currentLabel: `Checked ${completedChecks} of ${idsToCheck.length} businesses`,
        }));
      }
    };
    await Promise.all([worker(), worker()]);
    if ((await cancellationRequested(jobId))) {
      (await updateResearchJob(jobId, { status: "cancelled", phase: "cancelled", checksFailed, currentLabel: null }));
      return;
    }
    (await updateResearchJob(jobId, {
      status: "completed",
      phase: "completed",
      checksFailed,
      currentLabel: null,
      error: warnings.length ? warnings.slice(0, 3).join(" · ").slice(0, 500) : null,
    }));
  } catch (error) {
    (await failJob(jobId, error));
  }
}

async function runRecheckJob(jobId: string, companyId: number) {
  try {
    (await updateResearchJob(jobId, { status: "running", phase: "checking", currentLabel: "Preparing website checks" }));
    const company = (await getCompany(companyId));
    if (!company) throw new Error("Company not found.");
    let websiteUrl: string | null | undefined;
    if (company.source === "google_places") {
      const place = await fetchGooglePlaceDetails(company.placeId, async () => {
        (await incrementRequestCount(jobId));
        (await recordGooglePlacesRequest("Website re-check live lookup", company.area, "details"));
      });
      (await markGoogleLiveLookup(companyId));
      websiteUrl = place.websiteUri ?? null;
    }
    const result = await withWebsiteCheckLimit(async () => (await checkCompanyWebsite(companyId, websiteUrl)));
    (await updateResearchJob(jobId, {
      status: (await cancellationRequested(jobId)) ? "cancelled" : "completed",
      phase: (await cancellationRequested(jobId)) ? "cancelled" : "completed",
      completed: 1,
      checksFailed: result.failed ? 1 : 0,
      currentLabel: null,
      error: result.failed ? result.error ?? "Website checks failed after one retry." : null,
    }));
  } catch (error) {
    (await failJob(jobId, error));
  }
}

async function runGoogleRefreshJob(jobId: string, companyId: number) {
  let requestCounted = false;
  let area = "";
  try {
    (await updateResearchJob(jobId, { status: "running", phase: "refreshing", currentLabel: "Refreshing Google Places details" }));
    const company = (await getCompany(companyId));
    if (!company || company.source !== "google_places") throw new Error("This record is not from Google Places.");
    area = company.area;
    const place = await fetchGooglePlaceDetails(company.placeId, async () => {
      requestCounted = true;
      (await incrementRequestCount(jobId));
    });
    if (!place.id) throw new Error("Google Places returned no place ID.");
    (await markGoogleLiveLookup(companyId));
    (await updateResearchJob(jobId, {
      status: (await cancellationRequested(jobId)) ? "cancelled" : "completed",
      phase: (await cancellationRequested(jobId)) ? "cancelled" : "completed",
      completed: 1,
      updatedCompanies: 1,
      currentLabel: null,
    }));
  } catch (error) {
    (await failJob(jobId, error));
  } finally {
    if (requestCounted) (await recordGooglePlacesRequest("Google Places details refresh", area, "details"));
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
  if (areas.length * keywords.length > MAX_GOOGLE_SEARCH_PAIRS) {
    throw new Error(`A search is limited to ${MAX_GOOGLE_SEARCH_PAIRS} keyword-area pairs to control Google Places usage.`);
  }
  return { areas, keywords };
}

export function estimateGooglePlacesSearch(input: SearchInput) {
  const normalized = normalizeInput(input);
  return estimateGooglePlacesRequests(normalized.areas, normalized.keywords);
}

export async function startGooglePlacesSearch(input: SearchInput) {
  const normalized = normalizeInput(input);
  if (!process.env.GOOGLE_API_KEY) {
    throw new Error("Google Places is not configured. Add GOOGLE_API_KEY in Replit Secrets.");
  }
  const estimate = estimateGooglePlacesRequests(normalized.areas, normalized.keywords);
  const job = (await createResearchJob("search", estimate.pairCount, estimate.requestsEstimated, normalized));
  void runSearchJob(job.id, normalized);
  return job;
}

export async function startCompanyRecheck(companyId: number) {
  const job = (await createResearchJob("recheck", 1, (await getCompany(companyId))?.source === "google_places" ? 1 : 0, { companyId }));
  void runRecheckJob(job.id, companyId);
  return job;
}

export async function isGoogleRecordStale(companyId: number) {
  const company = (await getCompany(companyId));
  if (!company || company.source !== "google_places") return false;
  if (!company.googleUpdatedAt) return true;
  const refreshedAt = new Date(company.googleUpdatedAt).getTime();
  return !Number.isFinite(refreshedAt) || Date.now() - refreshedAt >= 30 * 24 * 60 * 60 * 1000;
}

export async function startGoogleRefresh(companyId: number) {
  const company = (await getCompany(companyId));
  if (!company || company.source !== "google_places") return null;
  if (!process.env.GOOGLE_API_KEY) {
    throw new Error("Google Places is not configured. Add GOOGLE_API_KEY in Replit Secrets.");
  }
  const job = (await createResearchJob("google_refresh", 1, 1, { companyId }));
  void runGoogleRefreshJob(job.id, companyId);
  return job;
}
