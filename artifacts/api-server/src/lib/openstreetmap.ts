import { leadDb } from "./lead-db";

const NOMINATIM_URL = process.env.OSM_NOMINATIM_URL ?? "https://nominatim.openstreetmap.org";
const OVERPASS_URL = process.env.OSM_OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";
export const MAX_LISTINGS_PER_AREA = 60;
const GEOCODE_CACHE_MS = 30 * 24 * 60 * 60 * 1000;
const OSM_USER_AGENT = "KLLeadFinder/2.0 (OpenStreetMap research client)";

const defaultHighValue = [
  "dental clinic",
  "medical specialist",
  "aesthetic clinic",
  "law firm",
  "accounting firm",
  "interior design",
  "renovation contractor",
  "real estate agency",
  "private school",
  "tuition centre",
  "car dealership",
  "hotel",
  "wedding services",
  "trading company",
];

export type AreaBounds = {
  south: number;
  west: number;
  north: number;
  east: number;
};

export type OsmListing = {
  placeId: string;
  osmType: string;
  osmId: string;
  name: string;
  address: string;
  area: string;
  keyword: string;
  phone: string | null;
  websiteUrl: string | null;
  email: string | null;
  whatsapp: string | null;
  openingHours: string | null;
  mapsUrl: string;
  valueScoreBase: number;
  valueScoreDetails: string[];
};

type OverpassElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

let osmTail: Promise<void> = Promise.resolve();
let lastNominatimRequestAt = 0;

function serializedOsmRequest<T>(action: () => Promise<T>): Promise<T> {
  const result = osmTail.then(action, action);
  osmTail = result.then(() => undefined, () => undefined);
  return result;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeArea(value: string) {
  return value.trim().toLocaleLowerCase("en-MY").replace(/\s+/g, " ");
}

function cachedBounds(area: string): AreaBounds | null {
  const row = leadDb.prepare(
    "SELECT south, west, north, east, fetched_at AS fetchedAt FROM osm_area_cache WHERE area_key = ?",
  ).get(normalizeArea(area)) as (AreaBounds & { fetchedAt: string }) | undefined;
  if (!row || Date.now() - new Date(row.fetchedAt).getTime() > GEOCODE_CACHE_MS) return null;
  return { south: row.south, west: row.west, north: row.north, east: row.east };
}

export function estimateOsmRequests(areas: string[], keywords: string[]) {
  const cachedAreas = areas.filter((area) => cachedBounds(area) !== null);
  const geocodingCalls = areas.length - cachedAreas.length;
  return {
    areaCount: areas.length,
    keywordCount: keywords.length,
    geocodingCalls,
    cachedAreas,
    overpassCalls: areas.length,
    totalCalls: geocodingCalls + areas.length,
    maxListingsPerArea: MAX_LISTINGS_PER_AREA,
    strategy: "One cached Nominatim lookup when needed and one Overpass query per area; selected keywords are matched together. Public OSM services are shared and rate-limited.",
  };
}

async function geocodeArea(area: string, onRequest?: () => void): Promise<{ bounds: AreaBounds; madeRequest: boolean }> {
  const existing = cachedBounds(area);
  if (existing) return { bounds: existing, madeRequest: false };
  return serializedOsmRequest(async () => {
    const racedCache = cachedBounds(area);
    if (racedCache) return { bounds: racedCache, madeRequest: false };
    const waitMs = Math.max(0, 1100 - (Date.now() - lastNominatimRequestAt));
    if (waitMs) await delay(waitMs);
    lastNominatimRequestAt = Date.now();
    const url = new URL("/search", NOMINATIM_URL);
    url.searchParams.set("q", `${area}, Kuala Lumpur, Malaysia`);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    onRequest?.();
    const response = await fetch(url, {
      headers: { "User-Agent": OSM_USER_AGENT, "Accept-Language": "en" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`OpenStreetMap area lookup returned ${response.status}.`);
    const rows = await response.json() as Array<{ boundingbox?: string[] }>;
    const box = rows[0]?.boundingbox?.map(Number);
    if (!box || box.length !== 4 || box.some((part) => !Number.isFinite(part))) {
      throw new Error(`Could not find the area "${area}" in OpenStreetMap.`);
    }
    const bounds = { south: box[0]!, north: box[1]!, west: box[2]!, east: box[3]! };
    leadDb.prepare(`
      INSERT INTO osm_area_cache (area_key, area_name, south, west, north, east, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(area_key) DO UPDATE SET
        area_name = excluded.area_name, south = excluded.south, west = excluded.west,
        north = excluded.north, east = excluded.east, fetched_at = excluded.fetched_at
    `).run(normalizeArea(area), area.trim(), bounds.south, bounds.west, bounds.north, bounds.east, new Date().toISOString());
    return { bounds, madeRequest: true };
  });
}

function keywordTags(keyword: string) {
  const normalized = keyword.toLowerCase();
  if (/dental|dentist/.test(normalized)) return ["amenity=dentist", "healthcare=dentist"];
  if (/medical|specialist|clinic|aesthetic/.test(normalized)) return ["healthcare=clinic", "healthcare=doctor", "healthcare=beauty", "amenity=clinic"];
  if (/law firm|lawyer/.test(normalized)) return ["office=lawyer"];
  if (/account|bookkeep/.test(normalized)) return ["office=accountant"];
  if (/interior/.test(normalized)) return ["office=interior_design", "shop=furniture"];
  if (/renovat|contractor/.test(normalized)) return ["craft=builder", "office=construction_company"];
  if (/real estate|property/.test(normalized)) return ["office=estate_agent"];
  if (/private school|school/.test(normalized)) return ["amenity=school"];
  if (/tuition|tutor|education/.test(normalized)) return ["amenity=language_school", "office=educational_institution"];
  if (/car dealership|car dealer/.test(normalized)) return ["shop=car"];
  if (/hotel|accommodation/.test(normalized)) return ["tourism=hotel", "tourism=motel", "tourism=guest_house"];
  if (/wedding|bridal/.test(normalized)) return ["shop=bridal", "amenity=events_venue"];
  if (/trading|company/.test(normalized)) return ["office=company"];
  return [];
}

function regexTokens(keywords: string[]) {
  const terms = new Set<string>();
  for (const keyword of keywords) {
    for (const word of keyword.toLowerCase().split(/[^a-z0-9]+/).filter((part) => part.length > 2)) {
      terms.add(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    }
  }
  return [...terms].slice(0, 60).join("|");
}

function overpassQuery(bounds: AreaBounds, keywords: string[]) {
  const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
  const selectors = new Set<string>();
  for (const keyword of keywords) {
    for (const selector of keywordTags(keyword)) {
      const [key, value] = selector.split("=");
      selectors.add(`  nwr["${key}"="${value}"](${bbox});`);
    }
  }
  const namePattern = regexTokens(keywords);
  if (namePattern) selectors.add(`  nwr["name"~"${namePattern}",i](${bbox});`);
  return `[out:json][timeout:25];\n(\n${[...selectors].join("\n")}\n);\nout center tags ${MAX_LISTINGS_PER_AREA};`;
}

function firstTag(tags: Record<string, string>, ...keys: string[]) {
  for (const key of keys) {
    const value = tags[key]?.trim();
    if (value) return value;
  }
  return null;
}

function keywordMatches(tags: Record<string, string>, name: string, keyword: string) {
  if (keywordTags(keyword).some((selector) => {
    const [key, value] = selector.split("=");
    return tags[key!] === value;
  })) return true;
  const normalizedName = name.toLowerCase();
  const words = keyword.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3);
  return words.some((word) => normalizedName.includes(word));
}

export function listingFromElement(element: OverpassElement, area: string, keywords: string[]): OsmListing | null {
  const tags = element.tags ?? {};
  const name = tags.name?.trim();
  if (!name) return null;
  const keyword = keywords.find((candidate) => keywordMatches(tags, name, candidate));
  if (!keyword) return null;
  const phone = firstTag(tags, "contact:phone", "phone", "telephone");
  const websiteUrl = firstTag(tags, "contact:website", "website", "url");
  const email = firstTag(tags, "contact:email", "email");
  const whatsapp = firstTag(tags, "contact:whatsapp", "whatsapp");
  const address =
    firstTag(tags, "addr:full") ??
    [
      firstTag(tags, "addr:unit", "addr:housenumber"),
      firstTag(tags, "addr:street"),
      firstTag(tags, "addr:suburb", "addr:district"),
      firstTag(tags, "addr:city"),
      firstTag(tags, "addr:postcode"),
    ].filter(Boolean).join(", ");
  const normalizedKeyword = keyword.toLowerCase();
  const details: string[] = [];
  let base = 0;
  if (defaultHighValue.some((item) => normalizedKeyword.includes(item) || item.includes(normalizedKeyword))) {
    base += 8;
    details.push(`High-value category: ${keyword} (+8)`);
  }
  if (websiteUrl) {
    base += 5;
    details.push("Website listed in OpenStreetMap (+5)");
  }
  if (phone) {
    base += 4;
    details.push("Phone number listed in OpenStreetMap (+4)");
  }
  if (address) {
    base += 4;
    details.push("Address details listed in OpenStreetMap (+4)");
  }
  if (tags.opening_hours) {
    base += 3;
    details.push("Opening hours listed in OpenStreetMap (+3)");
  }
  if (email) {
    base += 3;
    details.push("Email listed in OpenStreetMap (+3)");
  }
  const osmType = element.type;
  const osmId = String(element.id);
  return {
    placeId: `osm:${osmType}:${osmId}`,
    osmType,
    osmId,
    name,
    address,
    area,
    keyword,
    phone,
    websiteUrl,
    email,
    whatsapp,
    openingHours: tags.opening_hours ?? null,
    mapsUrl: `https://www.openstreetmap.org/${osmType}/${osmId}`,
    valueScoreBase: base,
    valueScoreDetails: details,
  };
}

export async function searchOpenStreetMapArea(area: string, keywords: string[], onRequest?: () => void) {
  const { bounds, madeRequest: geocoded } = await geocodeArea(area, onRequest);
  const query = overpassQuery(bounds, keywords);
  const elements = await serializedOsmRequest(async () => {
    onRequest?.();
    const response = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": OSM_USER_AGENT,
      },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(40_000),
    });
    if (!response.ok) throw new Error(`OpenStreetMap search returned ${response.status}.`);
    const data = await response.json() as { elements?: OverpassElement[] };
    return data.elements ?? [];
  });
  const listings = new Map<string, OsmListing>();
  for (const element of elements) {
    const listing = listingFromElement(element, area, keywords);
    if (listing) listings.set(listing.placeId, listing);
  }
  return { listings: [...listings.values()], geocoded, overpassCalls: 1 };
}

export async function fetchOsmElement(osmType: string, osmId: string, onRequest?: () => void) {
  if (!["node", "way", "relation"].includes(osmType) || !/^\d+$/.test(osmId)) {
    throw new Error("OpenStreetMap reference is invalid.");
  }
  const query = `[out:json][timeout:20];${osmType}(${osmId});out center tags;`;
  return serializedOsmRequest(async () => {
    onRequest?.();
    const response = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": OSM_USER_AGENT },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(35_000),
    });
    if (!response.ok) throw new Error(`OpenStreetMap refresh returned ${response.status}.`);
    const data = await response.json() as { elements?: OverpassElement[] };
    return data.elements?.[0] ?? null;
  });
}

export function upsertOsmListing(listing: OsmListing) {
  const now = new Date().toISOString();
  const existing = leadDb.prepare("SELECT id FROM companies WHERE place_id = ?").get(listing.placeId) as { id: number } | undefined;
  leadDb.prepare(`
    INSERT INTO companies (
      place_id, name, address, area, keyword, phone, website_url, maps_url,
      rating, review_count, email, whatsapp, status, value_score, problem_score,
      opportunity_score, reasons_json, fetched_at, created_at, source, osm_type,
      osm_id, osm_updated_at, rating_available, value_score_method,
      value_score_base, value_score_details_json, osm_opening_hours
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 'New', ?, 0, ?, '[]', ?, ?, 'openstreetmap', ?, ?, ?, 0,
      'OSM estimate: category, branches and listing completeness', ?, ?, ?)
    ON CONFLICT(place_id) DO UPDATE SET
      name = excluded.name,
      address = CASE WHEN excluded.address <> '' THEN excluded.address ELSE companies.address END,
      area = excluded.area,
      keyword = excluded.keyword,
      phone = COALESCE(excluded.phone, companies.phone),
      website_url = COALESCE(excluded.website_url, companies.website_url),
      maps_url = excluded.maps_url,
      email = COALESCE(excluded.email, companies.email),
      whatsapp = COALESCE(excluded.whatsapp, companies.whatsapp),
      fetched_at = excluded.fetched_at,
      source = 'openstreetmap',
      osm_type = excluded.osm_type,
      osm_id = excluded.osm_id,
      osm_updated_at = excluded.osm_updated_at,
      rating = 0,
      review_count = 0,
      rating_available = 0,
      value_score_method = excluded.value_score_method,
      value_score_base = excluded.value_score_base,
      value_score_details_json = excluded.value_score_details_json,
      osm_opening_hours = excluded.osm_opening_hours
  `).run(
    listing.placeId,
    listing.name,
    listing.address,
    listing.area,
    listing.keyword,
    listing.phone,
    listing.websiteUrl,
    listing.mapsUrl,
    listing.email,
    listing.whatsapp,
    listing.valueScoreBase,
    listing.valueScoreBase,
    now,
    now,
    listing.osmType,
    listing.osmId,
    now,
    listing.valueScoreBase,
    JSON.stringify(listing.valueScoreDetails),
    listing.openingHours,
  );
  const row = leadDb.prepare("SELECT id FROM companies WHERE place_id = ?").get(listing.placeId) as { id: number };
  return { id: Number(row.id), isNew: !existing };
}

export function recomputeOsmValueScores() {
  const rows = leadDb.prepare(`
    SELECT id, name, value_score_base AS baseScore, value_score_details_json AS detailsJson
    FROM companies WHERE source = 'openstreetmap'
  `).all() as Array<{ id: number; name: string; baseScore: number; detailsJson: string }>;
  const counts = new Map<string, Set<number>>();
  for (const row of rows) {
    const key = row.name.trim().toLocaleLowerCase("en-MY").replace(/\s+/g, " ");
    const ids = counts.get(key) ?? new Set<number>();
    ids.add(row.id);
    counts.set(key, ids);
  }
  const update = leadDb.prepare(`
    UPDATE companies SET value_score = ?, opportunity_score = problem_score + ?,
      value_score_details_json = ? WHERE id = ?
  `);
  for (const row of rows) {
    let details: string[] = [];
    try {
      const parsed: unknown = JSON.parse(row.detailsJson);
      if (Array.isArray(parsed)) details = parsed.filter((value) => typeof value === "string");
    } catch {
      details = [];
    }
    const branches = (counts.get(row.name.trim().toLocaleLowerCase("en-MY").replace(/\s+/g, " "))?.size ?? 0) >= 2;
    if (branches) details.push("Same business name at 2 or more OSM locations (+5)");
    const valueScore = Math.min(30, Number(row.baseScore) + (branches ? 5 : 0));
    update.run(valueScore, valueScore, JSON.stringify(details), row.id);
  }
}

export function isOsmAreaCached(area: string) {
  return cachedBounds(area) !== null;
}
