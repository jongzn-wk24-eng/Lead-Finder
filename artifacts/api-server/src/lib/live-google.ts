import {
  calculateLiveGoogleValue,
  getCompany,
  listCompanies,
  markGoogleLiveLookup,
  recordGooglePlacesRequest,
} from "./lead-db";
import { fetchGooglePlaceDetails } from "./google-places";
import { logger } from "./logger";

type StoredCompany = Awaited<ReturnType<typeof listCompanies>>[number];
type LiveCompany<T> = T & {
  googleDataWarning: string | null;
  googleAttributions: Array<{ provider?: string; providerUri?: string }>;
};

// Request-scoped enrichment only: none of the returned Places fields are saved.
export async function withLiveGoogleData<T extends StoredCompany>(company: T): Promise<LiveCompany<T>> {
  if (company.source !== "google_places") return { ...company, googleDataWarning: null, googleAttributions: [] };
  try {
    const place = await fetchGooglePlaceDetails(company.placeId, async () => {
      (await recordGooglePlacesRequest("Live Place Details", company.area, "details"));
    });
    const score = calculateLiveGoogleValue({
      keyword: company.keyword,
      rating: place.rating,
      reviewCount: place.userRatingCount,
    });
    return {
      ...company,
      name: place.displayName?.text || company.name,
      address: place.formattedAddress || "",
      phone: place.nationalPhoneNumber ?? null,
      websiteUrl: place.websiteUri ?? null,
      mapsUrl: place.googleMapsUri ?? null,
      rating: place.rating ?? 0,
      reviewCount: place.userRatingCount ?? 0,
      ratingAvailable: place.rating != null || place.userRatingCount != null,
      ...score,
      opportunityScore: score.valueScore + company.problemScore,
      googleUpdatedAt: (await markGoogleLiveLookup(company.id)),
      googleDataWarning: null,
      googleAttributions: place.attributions ?? [],
    };
  } catch (error) {
    logger.warn({ companyId: company.id, err: error }, "Live Google Place lookup unavailable");
    return {
      ...company,
      googleDataWarning: error instanceof Error ? error.message : "Live Google data could not load.",
      googleAttributions: [],
    };
  }
}

export async function withLiveGoogleList<T extends StoredCompany>(companies: T[]) {
  const results = new Array<LiveCompany<T>>(companies.length);
  let index = 0;
  const worker = async () => {
    while (index < companies.length) {
      const current = index++;
      results[current] = await withLiveGoogleData(companies[current]!);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return results;
}

export async function withLiveCompanyNames<T extends Record<string, unknown>>(rows: T[]) {
  const ids = [...new Set(rows.map((row) => Number(row.companyId)).filter(Number.isFinite))];
  const companies = (await Promise.all(ids.map(getCompany))).filter((company) => company != null);
  const live = await withLiveGoogleList(companies);
  const names = new Map(live.map((company) => [company.id, company.name]));
  return rows.map((row) => ({ ...row, companyName: names.get(Number(row.companyId)) ?? row.companyName }));
}
