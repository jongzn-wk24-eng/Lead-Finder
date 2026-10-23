export const MAX_GOOGLE_SEARCH_PAIRS = 60;
export const MAX_RESULTS_PER_PAIR = 20;

const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.googleMapsUri",
  "places.primaryType",
  "places.types",
  "places.businessStatus",
].join(",");
const DETAILS_FIELD_MASK = FIELD_MASK.split(",").map((field) => field.replace(/^places\./, "")).join(",");

export type GooglePlace = {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  googleMapsUri?: string;
  primaryType?: string;
  types?: string[];
  businessStatus?: string;
};

type PlacesResponse = { places?: GooglePlace[] };

export function estimateGooglePlacesRequests(areas: string[], keywords: string[]) {
  const uniqueAreas = [...new Set(areas.map((item) => item.trim()).filter(Boolean))];
  const uniqueKeywords = [...new Set(keywords.map((item) => item.trim()).filter(Boolean))];
  const pairCount = uniqueAreas.length * uniqueKeywords.length;
  if (!uniqueAreas.length || !uniqueKeywords.length) {
    throw new Error("Choose at least one area and one keyword.");
  }
  if (pairCount > MAX_GOOGLE_SEARCH_PAIRS) {
    throw new Error(`A search is limited to ${MAX_GOOGLE_SEARCH_PAIRS} keyword-area pairs to control Google Places usage.`);
  }
  return {
    areaCount: uniqueAreas.length,
    keywordCount: uniqueKeywords.length,
    pairCount,
    requestsEstimated: pairCount,
    maxResultsPerPair: MAX_RESULTS_PER_PAIR,
    maximumPairs: MAX_GOOGLE_SEARCH_PAIRS,
    strategy: "One Google Places Text Search request per unique keyword-area pair.",
  };
}

export class GooglePlacesError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GooglePlacesError";
  }
}

function apiKey() {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("Google Places is not configured. Add GOOGLE_API_KEY in Replit Secrets.");
  return key;
}

async function placesRequest(url: string, init: RequestInit, fieldMask: string, onRequest: () => void) {
  onRequest();
  const response = await fetch(url, {
    ...init,
    headers: {
      "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask": fieldMask,
      "Content-Type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    let message = `Google Places returned HTTP ${response.status}.`;
    try {
      const payload = await response.json() as { error?: { message?: string } };
      if (payload.error?.message) message = `Google Places: ${payload.error.message}`;
    } catch {
      // Keep the safe status-only message when the response is not JSON.
    }
    throw new GooglePlacesError(message.slice(0, 350), response.status);
  }
  return response.json();
}

export async function searchGooglePlacesText(
  keyword: string,
  area: string,
  onRequest: () => void,
): Promise<GooglePlace[]> {
  const data = await placesRequest(
    TEXT_SEARCH_URL,
    {
      method: "POST",
      body: JSON.stringify({
        textQuery: `${keyword} in ${area}, Kuala Lumpur, Malaysia`,
        languageCode: "en",
        regionCode: "MY",
        pageSize: MAX_RESULTS_PER_PAIR,
      }),
    },
    FIELD_MASK,
    onRequest,
  ) as PlacesResponse;
  return Array.isArray(data.places) ? data.places.filter((place) => typeof place.id === "string" && place.id) : [];
}

export async function fetchGooglePlaceDetails(placeId: string, onRequest: () => void) {
  const safeId = placeId.replace(/^google:/, "");
  const data = await placesRequest(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(safeId)}`,
    { method: "GET" },
    DETAILS_FIELD_MASK,
    onRequest,
  ) as GooglePlace;
  if (!data.id) throw new Error("Google Places returned no place ID for this record.");
  return data;
}
