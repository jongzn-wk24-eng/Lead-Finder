import { randomUUID } from "node:crypto";
import { leadDb, type SQLInputValue } from "./lead-postgres";
export { leadDb } from "./lead-postgres";
import { generateOutreachDraft, MODEL } from "./gemini-ai";
import { inDemoMode, withDataMode, withAllData, withTransaction, ensureOsmSchema } from "./lead-postgres";
import { CATEGORIES, AREA_CENTRES } from "./osm/defaults";
import { normalizePhone, normalizeWebsite, isMobile, groupName, distance, type NormalizedBusiness } from "./osm/normalize";
await ensureOsmSchema();

export const COMPANY_STATUSES = [
  "New",
  "Claimed",
  "Sent #1",
  "Sent #2",
  "Sent #3",
  "Replied",
  "Wants hero",
  "Hero sent",
  "Won",
  "Not interested",
  "Do not contact",
  "Closed: no reply",
] as const;

const DEFAULT_AREAS = [
  "KLCC",
  "Bukit Bintang",
  "Bangsar",
  "Mont Kiara",
  "Damansara Heights",
  "Sri Hartamas",
  "Cheras",
  "Setapak",
  "Sentul",
  "Kepong",
  "Bukit Jalil",
];

const DEFAULT_KEYWORDS = [
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

const DEFAULT_AI_INSTRUCTION =
  "Write one short cold email (under 100 words) from Dylan Jong, a freelance web designer, to a local business owner in Malaysia. Use only provided facts. Include the company name and ONE exact finding; if none, reply 'Need a real finding first.' Structure: found online + finding + 'That might be costing you some enquiries'; who I am; free concept of the top of their homepage, no strings, ask 'Want me to send it over?'; one portfolio link; one opt-out line; sign-off. Never claim a personal phone visit or phone test that was not performed. Simple spoken English. Avoid 'I hope this email finds you well', exclamation marks, ALL CAPS, buzzwords, guarantees, percentages and prices. Also write WhatsApp, at most 40 words.";

const DEFAULT_SETTINGS = {
  osmContact: "https://my-portfolio.jongzhenyat0121.workers.dev/",
  overpassEndpoint: "https://overpass-api.de/api/interpreter",
  categories: CATEGORIES,
  areaCentres: AREA_CENTRES,
  minValue: 10,
  minProblem: 25,
  chainThreshold: 8,
  demoMode: false,
  areas: DEFAULT_AREAS,
  keywords: DEFAULT_KEYWORDS,
  emailDailyLimit: 15,
  whatsappDailyLimit: 10,
  followup1Days: 4,
  followup2Days: 10,
  myName: "Dylan Jong",
  myTitle: "Web Designer",
  myWhatsapp: "",
  portfolioUrl: "https://my-portfolio.jongzhenyat0121.workers.dev/",
  aiInstruction: DEFAULT_AI_INSTRUCTION,
};

type CompanyRow = Record<string, unknown>;
type OsmProfile = Partial<NormalizedBusiness> & { editedFields?: string[]; manualValue?:number; websiteConfirmedNone?:boolean; branchCount?:number; isChain?:boolean; duplicateWarning?:string|null };
function parseProfile(raw:unknown):OsmProfile { try {return JSON.parse(String(raw??"{}")) as OsmProfile;}catch{return {};} }

export type Company = {
  id: number;
  placeId: string;
  name: string;
  address: string;
  area: string;
  keyword: string;
  phone: string | null;
  websiteUrl: string | null;
  mapsUrl: string | null;
  source: "demo" | "google_places" | "manual" | "openstreetmap";
  nameEn: string | null;
  websiteType: string;
  socialUrl: string | null;
  phones: string[];
  phoneIsMobile: boolean;
  whatsappDerived: boolean;
  manualValue: number;
  websiteConfirmedNone: boolean;
  branchCount: number;
  isChain: boolean;
  duplicateWarning: string | null;
  osmStale: boolean;
  osmType: string | null;
  osmId: string | null;
  osmUpdatedAt: string | null;
  googleUpdatedAt: string | null;
  ratingAvailable: boolean;
  valueScoreMethod: string;
  valueScoreDetails: string[];
  rating: number;
  reviewCount: number;
  priceLevel: string | null;
  email: string | null;
  whatsapp: string | null;
  firstName: string;
  status: string;
  valueScore: number;
  problemScore: number;
  opportunityScore: number;
  reasons: string[];
  findingType: string | null;
  notes: string;
  fetchedAt: string;
  createdAt: string;
  lastContactedAt: string | null;
  nextFollowupAt: string | null;
  emailCount: number;
  whatsappCount: number;
  isDoNotContact: boolean;
  isSampleData: boolean;
  automatedCheckStatus: string;
  automatedCheckedAt: string | null;
  aiStatus: string;
  aiModel: string | null;
  aiGeneratedAt: string | null;
};

const COMPANY_COLUMNS = `
  c.*,
  (SELECT ch.check_status FROM checks ch WHERE ch.company_id = c.id ORDER BY ch.checked_at DESC, ch.id DESC LIMIT 1) AS automated_check_status,
  (SELECT ch.checked_at FROM checks ch WHERE ch.company_id = c.id ORDER BY ch.checked_at DESC, ch.id DESC LIMIT 1) AS automated_checked_at,
  (SELECT ch.design_status FROM checks ch WHERE ch.company_id = c.id ORDER BY ch.checked_at DESC, ch.id DESC LIMIT 1) AS ai_status,
  (SELECT MAX(o.sent_at) FROM outreach o WHERE o.company_id = c.id) AS last_contacted_at,
  (SELECT MIN(o.next_followup_at) FROM outreach o
    WHERE o.company_id = c.id AND o.next_followup_at IS NOT NULL AND o.result IS NULL) AS next_followup_at,
  (SELECT COUNT(*) FROM outreach o WHERE o.company_id = c.id AND o.channel = 'email' AND o.sent_at IS NOT NULL) AS email_count,
  (SELECT COUNT(*) FROM outreach o WHERE o.company_id = c.id AND o.channel = 'whatsapp' AND o.sent_at IS NOT NULL) AS whatsapp_count
`;

function toCompany(row: CompanyRow): Company {
  const profile = parseProfile(row.osm_profile_json);
  const reasonsJson = String(row.reasons_json ?? "[]");
  let reasons: string[] = [];
  try {
    const parsed: unknown = JSON.parse(reasonsJson);
    if (Array.isArray(parsed)) reasons = parsed.filter((item) => typeof item === "string");
  } catch {
    reasons = [];
  }
  let valueScoreDetails: string[] = [];
  try {
    const parsed: unknown = JSON.parse(String(row.value_score_details_json ?? "[]"));
    if (Array.isArray(parsed)) valueScoreDetails = parsed.filter((item) => typeof item === "string");
  } catch {
    valueScoreDetails = [];
  }
  return {
    nameEn: profile.nameEn ?? null,
    websiteType: profile.websiteConfirmedNone ? "none" : String(row.website_url ? "own" : profile.websiteType ?? "unknown"),
    socialUrl: profile.socialUrl ?? null,
    phones: profile.phones ?? [],
    phoneIsMobile: isMobile(row.phone == null ? null : String(row.phone)),
    whatsappDerived: profile.whatsappDerived ?? false,
    manualValue: profile.manualValue ?? 0,
    websiteConfirmedNone: profile.websiteConfirmedNone ?? false,
    branchCount: profile.branchCount ?? 1,
    isChain: profile.isChain ?? false,
    duplicateWarning: profile.duplicateWarning ?? null,
    osmStale: Boolean(row.osm_updated_at) && Date.now()-Date.parse(String(row.osm_updated_at))>30*86400_000,
    id: Number(row.id),
    placeId: String(row.place_id),
    name: String(row.name),
    address: String(row.address ?? ""),
    area: String(row.area ?? ""),
    keyword: String(row.keyword ?? ""),
    phone: row.phone == null ? null : String(row.phone),
    websiteUrl: row.website_url == null ? null : String(row.website_url),
    mapsUrl: row.maps_url == null ? null : String(row.maps_url),
    source: String(row.source ?? (Number(row.is_sample_data ?? 0) ? "demo" : "manual")) as Company["source"],
    osmType: row.osm_type == null ? null : String(row.osm_type),
    osmId: row.osm_id == null ? null : String(row.osm_id),
    osmUpdatedAt: row.osm_updated_at == null ? null : String(row.osm_updated_at),
    googleUpdatedAt: row.google_updated_at == null ? null : String(row.google_updated_at),
    ratingAvailable: Number(row.rating_available ?? 1) === 1,
    valueScoreMethod: String(row.value_score_method ?? "manual"),
    valueScoreDetails,
    rating: Number(row.rating ?? 0),
    reviewCount: Number(row.review_count ?? 0),
    priceLevel: row.price_level == null ? null : String(row.price_level),
    email: row.email == null ? null : String(row.email),
    whatsapp: row.whatsapp == null ? null : String(row.whatsapp),
    firstName: String(row.first_name ?? ""),
    status: String(row.status),
    valueScore: Number(row.value_score ?? 0),
    problemScore: Number(row.problem_score ?? 0),
    opportunityScore: Number(row.opportunity_score ?? 0),
    reasons,
    findingType: row.finding_type == null ? null : String(row.finding_type),
    notes: String(row.notes ?? ""),
    fetchedAt: String(row.fetched_at),
    createdAt: String(row.created_at),
    lastContactedAt: row.last_contacted_at == null ? null : String(row.last_contacted_at),
    nextFollowupAt: row.next_followup_at == null ? null : String(row.next_followup_at),
    emailCount: Number(row.email_count ?? 0),
    whatsappCount: Number(row.whatsapp_count ?? 0),
    isDoNotContact: row.status === "Do not contact",
    isSampleData: row.source === "demo",
    automatedCheckStatus: String(row.automated_check_status ?? "unavailable"),
    automatedCheckedAt: row.automated_checked_at == null ? null : String(row.automated_checked_at),
    aiStatus: String(row.ai_status ?? "unavailable"),
    aiModel: row.ai_model == null ? null : String(row.ai_model),
    aiGeneratedAt: row.ai_generated_at == null ? null : String(row.ai_generated_at),
  };
}

function nowIso() {
  return new Date().toISOString();
}

async function setSetting(key: string, value: unknown) {
  (await leadDb
    .prepare(
      `INSERT INTO settings (key, value_json) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
    )
    .run(key, JSON.stringify(value)));
}

async function seedSettings() {
  const insert = leadDb.prepare(
    "INSERT OR IGNORE INTO settings (key, value_json) VALUES (?, ?)",
  );
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    (await insert.run(key, JSON.stringify(value)));
  }
}

function sampleReason(type: string, index: number): string {
  switch (type) {
    case "no_website":
      return "No website was listed; only a social page was found.";
    case "site_down":
      return "The website did not open when checked.";
    case "slow_mobile":
      return `Homepage takes about ${(5.2 + (index % 5) * 0.7).toFixed(1)} seconds to load on mobile.`;
    case "not_secure":
      return "The browser shows the site as not secure.";
    case "outdated":
      return `Copyright year shown on the homepage is ${2017 + (index % 4)}.`;
    case "no_contact_button":
      return "No WhatsApp or call button found.";
    default:
      return "The main contact button is not easy to spot.";
  }
}

async function seedSampleCompanies() {
  const existing = Number(
    ((await leadDb.prepare("SELECT COUNT(*) AS count FROM companies WHERE place_id LIKE 'sample-kl-%'").get()) as { count: number }).count,
  );
  if (existing > 0) return;

  const categories = [
    ["dental clinic", "Dental Care"],
    ["medical specialist", "Medical Clinic"],
    ["aesthetic clinic", "Aesthetic Studio"],
    ["law firm", "Law Chambers"],
    ["accounting firm", "Accounting"],
    ["interior design", "Interior Studio"],
    ["renovation contractor", "Renovation Co"],
    ["real estate agency", "Property Group"],
    ["private school", "Learning Academy"],
    ["tuition centre", "Tuition Centre"],
    ["car dealership", "Auto Gallery"],
    ["hotel", "City Hotel"],
    ["wedding services", "Wedding Studio"],
    ["trading company", "Trading Co"],
  ];
  const areas = DEFAULT_AREAS;
  const findingTypes = [
    "no_contact_button",
    "slow_mobile",
    "outdated",
    "no_website",
    "site_down",
    "not_secure",
    "cta_hidden",
  ];
  const highValueKeywords = new Set(DEFAULT_KEYWORDS);
  const insertCompany = leadDb.prepare(`
    INSERT INTO companies (
      place_id, name, address, area, keyword, phone, website_url, maps_url,
      rating, review_count, price_level, email, whatsapp, status,
      value_score, problem_score, opportunity_score, reasons_json, finding_type,
      fetched_at, created_at, is_sample_data, source, rating_available, value_score_method
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'demo', 1, 'demo legacy score')
  `);
  const insertCheck = leadDb.prepare(`
    INSERT INTO checks (
      company_id, checked_at, website_type, psi_mobile_score, lcp_seconds,
      https, has_viewport, copyright_year, has_tel_link, has_whatsapp_link,
      has_contact_form, site_builder, design_score, design_reason, cta_obvious
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const fetchedAt = nowIso();
  for (let index = 0; index < 30; index += 1) {
    const [keyword, category] = categories[index % categories.length]!;
    const findingType = findingTypes[index % findingTypes.length]!;
    const reviews = [18, 32, 68, 124, 248, 510][index % 6]!;
    const rating = [3.9, 4.1, 4.2, 4.4, 4.7][index % 5]!;
    const reviewScore = reviews >= 200 ? 12 : reviews >= 50 ? 8 : reviews >= 20 ? 4 : 0;
    const ratingScore = rating >= 4.2 ? 5 : rating >= 4 ? 3 : 0;
    const branchScore = index % 6 === 0 ? 5 : 0;
    const valueScore = Math.min(
      30,
      reviewScore + ratingScore + branchScore + (highValueKeywords.has(keyword) ? 8 : 0),
    );
    const problemScore =
      findingType === "no_website"
        ? 50
        : findingType === "site_down"
          ? 30
          : findingType === "slow_mobile"
            ? 20
            : findingType === "outdated"
              ? 10
              : findingType === "not_secure"
                ? 5
                : findingType === "no_contact_button"
                  ? 7
                  : 10;
    const websiteUrl =
      findingType === "no_website"
        ? null
        : `https://example.com/sample-business-${String(index + 1).padStart(2, "0")}`;
    const websiteType =
      findingType === "no_website"
        ? "social"
        : findingType === "site_down"
          ? "down"
          : "own";
    const result = (await insertCompany.run(
      `sample-kl-${String(index + 1).padStart(3, "0")}`,
      index < 2 ? "Sample Dental Group" : `Sample ${category} ${String(index + 1).padStart(2, "0")}`,
      `${100 + index}, Jalan Demo ${index + 1}, Kuala Lumpur`,
      areas[index % areas.length]!,
      keyword,
      `+603-5550-${String(1000 + index)}`,
      websiteUrl,
      null,
      rating,
      reviews,
      index % 3 === 0 ? "PRICE_LEVEL_MODERATE" : null,
      index % 3 === 0 ? "Claimed" : "New",
      valueScore,
      problemScore,
      valueScore + problemScore,
      JSON.stringify([sampleReason(findingType, index)]),
      findingType,
      fetchedAt,
      fetchedAt,
    ));
    const companyId = Number(result.lastInsertRowid);
    const psiScore = findingType === "slow_mobile" ? 28 + (index % 4) * 5 : null;
    const lcp = findingType === "slow_mobile" ? Number((5.2 + (index % 5) * 0.7).toFixed(1)) : null;
    (await insertCheck.run(
      companyId,
      fetchedAt,
      websiteType,
      psiScore,
      lcp,
      findingType === "not_secure" ? 0 : websiteUrl ? 1 : null,
      websiteUrl ? 1 : null,
      findingType === "outdated" ? 2017 + (index % 4) : null,
      findingType === "no_contact_button" ? 0 : null,
      findingType === "no_contact_button" ? 0 : null,
      null,
      index % 2 === 0 ? "WordPress" : "Wix",
      findingType === "outdated" ? 4 : findingType === "cta_hidden" ? 5 : null,
      findingType === "outdated" ? "Sample design finding for preview only." : null,
      findingType === "cta_hidden" ? 0 : null,
    ));
    if (index % 3 === 0) {
      (await leadDb
        .prepare(
          "INSERT INTO activity (company_id, timestamp, action, channel, note) VALUES (?, ?, 'copied_email', 'email', 'Sample activity only; no message was sent.')",
        )
        .run(companyId, fetchedAt));
    }
  }
}

async function seedSamplePipelineOnce() {
  const alreadySeeded = (await leadDb
    .prepare("SELECT value FROM app_meta WHERE key = 'sample_pipeline_seeded'")
    .get()) as { value: string } | undefined;
  if (alreadySeeded) return;

  const sampleCompanies = (await leadDb
    .prepare("SELECT id FROM companies WHERE is_sample_data = 1 ORDER BY id")
    .all()) as { id: number }[];
  if (sampleCompanies.length !== 30) return;
  (await leadDb
    .prepare(
      `DELETE FROM activity WHERE company_id IN
       (SELECT id FROM companies WHERE is_sample_data = 1)
       AND note LIKE 'Sample activity%'`,
    )
    .run());

  const statuses = [
    "New",
    "Claimed",
    "Sent #1",
    "Sent #2",
    "Sent #3",
    "Replied",
    "Wants hero",
    "Hero sent",
    "Won",
    "Not interested",
    "Do not contact",
    "Closed: no reply",
  ];
  const statusUpdate = leadDb.prepare("UPDATE companies SET status = ? WHERE id = ?");
  const addOutreach = leadDb.prepare(`
    INSERT INTO outreach (
      company_id, channel, sequence_no, subject, body, sent_at,
      replied_at, result, next_followup_at
    ) VALUES (?, 'email', ?, ?, ?, ?, ?, ?, ?)
  `);
  const addHistory = leadDb.prepare(`
    INSERT INTO activity (company_id, timestamp, action, channel, sequence_no, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const now = Date.now();
  const stampDaysAgo = (days: number) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();

  for (let index = 0; index < sampleCompanies.length; index += 1) {
    const companyId = Number(sampleCompanies[index]!.id);
    const status = statuses[index % statuses.length]!;
    (await statusUpdate.run(status, companyId));
    if (status === "New") continue;
    if (status === "Claimed") {
      (await addHistory.run(
        companyId,
        stampDaysAgo(5),
        "copied_email",
        "email",
        null,
        "Sample activity only; no message was sent.",
      ));
      continue;
    }
    if (status === "Do not contact") {
      (await addHistory.run(
        companyId,
        stampDaysAgo(5),
        "marked_do_not_contact",
        null,
        null,
        "Sample status only.",
      ));
      continue;
    }

    const emailCount =
      status === "Sent #2" ? 2 : status === "Sent #3" || status === "Closed: no reply" ? 3 : 1;
    const firstSentAt = stampDaysAgo(18);
    for (let sequence = 1; sequence <= emailCount; sequence += 1) {
      const sentAt = sequence === 1 ? firstSentAt : sequence === 2 ? stampDaysAgo(8) : stampDaysAgo(1);
      const shouldFollowUp =
        (status === "Sent #1" && sequence === 1) ||
        (status === "Sent #2" && sequence === 2);
      const followupDays = sequence === 1 ? 4 : 10;
      const nextFollowupAt = shouldFollowUp
        ? new Date(new Date(firstSentAt).getTime() + followupDays * 24 * 60 * 60 * 1000).toISOString()
        : null;
      const repliedAt = status === "Replied" && sequence === emailCount ? stampDaysAgo(2) : null;
      const result =
        repliedAt ? "replied" : status === "Not interested" ? "not_interested" : status === "Closed: no reply" && sequence === 3 ? "no_reply" : null;
      (await addOutreach.run(
        companyId,
        sequence,
        `Sample subject ${sequence}`,
        "Fictional sample draft. No message was actually sent.",
        sentAt,
        repliedAt,
        result,
        nextFollowupAt,
      ));
      (await addHistory.run(
        companyId,
        sentAt,
        "marked_sent",
        "email",
        sequence,
        "Sample activity only; no message was sent.",
      ));
    }
    if (status === "Replied") {
      (await addHistory.run(
        companyId,
        stampDaysAgo(2),
        "reply_logged",
        "email",
        null,
        "Fictional sample reply; no real response was received.",
      ));
    } else if (status !== "Sent #1" && status !== "Sent #2" && status !== "Sent #3") {
      (await addHistory.run(
        companyId,
        stampDaysAgo(1),
        "status_changed",
        null,
        null,
        `Sample status only: ${status}.`,
      ));
    }
  }

  (await leadDb
    .prepare("INSERT INTO app_meta (key, value) VALUES ('sample_pipeline_seeded', 'true')")
    .run());
}


export async function getSettings() {
  const rows = (await leadDb.prepare("SELECT key, value_json FROM settings").all()) as {
    key: string;
    value_json: string;
  }[];
  const values: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    try {
      values[row.key] = JSON.parse(row.value_json);
    } catch {
      values[row.key] = DEFAULT_SETTINGS[row.key as keyof typeof DEFAULT_SETTINGS];
    }
  }
  return values as typeof DEFAULT_SETTINGS;
}

export async function updateSettings(patch: Record<string, unknown>) {
  const combined = {...await getSettings(),...patch};
  if(Number(combined.followup2Days)<=Number(combined.followup1Days)) throw new Error("The final follow-up must be later than the first follow-up.");
  const allowed = new Set(Object.keys(DEFAULT_SETTINGS));
  for (const [key, value] of Object.entries(patch)) {
    if (allowed.has(key)) (await setSetting(key, value));
  }
  if(["categories","areaCentres","chainThreshold"].some(k=>k in patch))await recomputeOsmValues();
  return (await getSettings());
}

export async function readOsmCache(hash:string) {
  const row=await leadDb.prepare("SELECT raw_json, fetched_at FROM osm_cache WHERE query_hash = ?").get(hash);
  if(!row || Date.now()-Date.parse(String(row.fetched_at))>=86400_000)return null;
  try{return JSON.parse(String(row.raw_json));}catch{return null;}
}
export async function writeOsmCache(hash:string,data:unknown) {
  await leadDb.prepare("INSERT INTO osm_cache (query_hash,fetched_at,raw_json) VALUES (?,?,?) ON CONFLICT(query_hash) DO UPDATE SET fetched_at = excluded.fetched_at, raw_json = excluded.raw_json")
    .run(hash,nowIso(),JSON.stringify(data));
}
export async function upsertOsmBusiness(b:NormalizedBusiness) {
  return withTransaction(async()=>{
    const placeId=`osm:${b.osmType}:${b.osmId}`;
    await leadDb.prepare("SELECT pg_advisory_xact_lock(hashtext(?))").get(placeId);
    let row=await leadDb.prepare("SELECT * FROM companies WHERE place_id = ? OR (osm_type = ? AND osm_id = ?)").get(placeId,b.osmType,b.osmId);
    const isNew=!row;
    if(!row){
      const inserted=await leadDb.prepare("INSERT INTO companies (place_id,name,address,area,keyword,source,osm_type,osm_id,fetched_at,created_at,rating_available) VALUES (?,?,?,?,?,'openstreetmap',?,?,?,?,0)")
        .run(placeId,b.name,b.address,b.area,b.keyword,b.osmType,b.osmId,nowIso(),nowIso());
      row=await leadDb.prepare("SELECT * FROM companies WHERE id = ?").get(Number(inserted.lastInsertRowid));
    }
    const old=parseProfile(row!.osm_profile_json);
    const edited=old.editedFields ?? (!isNew ? ["name","phone","websiteUrl","email","whatsapp"].filter(k=>Boolean(row![{websiteUrl:"website_url"}[k]??k])) : []);
    const profile:OsmProfile={...b,...old,...Object.fromEntries(Object.entries(b).filter(([k])=>!edited.includes(k))),editedFields:edited};
    if(edited.includes("websiteUrl"))Object.assign(profile,{websiteType:old.websiteType,socialUrl:old.socialUrl,websiteConfirmedNone:old.websiteConfirmedNone});
    if(edited.includes("whatsapp"))profile.whatsappDerived=old.whatsappDerived??false;
    const columns:Record<string,unknown>={name:b.name,address:b.address,area:b.area,keyword:b.keyword,phone:b.phone,website_url:b.websiteUrl,email:b.email,whatsapp:b.whatsapp};
    for(const key of ["email","whatsapp"])if(columns[key]===null&&row![key])delete columns[key];
    for(const key of edited)delete columns[{websiteUrl:"website_url"}[key]??key];
    const assignments=Object.keys(columns).map(k=>`${k} = ?`).join(", ");
    await leadDb.prepare(`UPDATE companies SET ${assignments}, source = 'openstreetmap', osm_profile_json = ?, osm_updated_at = ?, rating_available = 0, value_score_method = 'OSM estimate (not reviews)', maps_url = ? WHERE id = ?`)
      .run(...Object.values(columns) as SQLInputValue[],JSON.stringify(profile),nowIso(),`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${b.name} ${b.address}`)}`,Number(row!.id));
    await addActivity(Number(row!.id),"imported",null,null,isNew?"Imported from OpenStreetMap.":"OpenStreetMap data refreshed; manual edits preserved.");
    return {id:Number(row!.id),isNew};
  });
}
export async function recordOsmImport(category:string,requests:number,found:number) {
  await leadDb.prepare("INSERT INTO searches (keyword,area,ran_at,api_calls,results_count,provider) VALUES (?,'Kuala Lumpur',?,?,?,'openstreetmap')").run(category,nowIso(),requests,found);
}
export async function recomputeOsmValues() {
  const settings=await getSettings();
  const rows=await leadDb.prepare("SELECT id,name,keyword,source,osm_profile_json FROM companies WHERE source IN ('openstreetmap','manual')").all() as Array<{id:number;name:string;keyword:string;source:string;osm_profile_json:string}>;
  const profiles=rows.map(r=>({...r,profile:parseProfile(r.osm_profile_json)}));
  const parents=new Map<number,number>(), keys=new Map<string,number>();
  const root=(id:number):number=>{const parent=parents.get(id)??id;if(parent===id)return id;const result=root(parent);parents.set(id,result);return result;};
  for(const r of profiles.filter(r=>r.source==="openstreetmap")){
    for(const raw of [r.name,r.profile.brand,r.profile.operator]){
      const key=groupName(raw??"");if(!key)continue;
      const prior=keys.get(key);if(prior!=null)parents.set(root(r.id),root(prior));else keys.set(key,r.id);
    }
  }
  const groups=new Map<number,number>();
  for(const r of profiles.filter(r=>r.source==="openstreetmap"))groups.set(root(r.id),(groups.get(root(r.id))??0)+1);
  for(const r of profiles){
    const p=r.profile;
    const branches=r.source==="openstreetmap"?(groups.get(root(r.id))??1):1;
    const chain=branches>=settings.chainThreshold;
    const category=settings.categories.find(c=>c.label===r.keyword);
    const premium=p.lat!=null&&p.lng!=null&&settings.areaCentres.some(c=>c.premium&&distance({lat:p.lat!,lng:p.lng!},c)<=2000);
    let score=0;const reasons:string[]=[];
    if(category?.highValue){score+=10;reasons.push("High-value category (+10)");}
    if(branches>=2&&!chain){score+=6;reasons.push(`${branches} KL branches (+6)`);}
    if(premium){score+=6;reasons.push("Within 2 km of a premium area (+6)");}
    const manual=[0,2,5,8][p.manualValue??0]??0;if(manual){score+=manual;reasons.push(`Your manual rating (+${manual})`);}
    p.branchCount=branches;p.isChain=chain;
    p.duplicateWarning=null;
    if(p.lat!=null&&p.lng!=null){
      const near=profiles.find(other=>other.id!==r.id&&groupName(String(other.name))===groupName(String(r.name))&&other.profile.lat!=null&&other.profile.lng!=null&&distance({lat:p.lat!,lng:p.lng!},{lat:other.profile.lat!,lng:other.profile.lng!})<=30);
      if(near)p.duplicateWarning="Similar name within 30 metres. Review manually; records were not merged.";
    }
    await leadDb.prepare("UPDATE companies SET value_score = ?, value_score_base = ?, opportunity_score = problem_score + ?, value_score_details_json = ?, osm_profile_json = ?, value_score_method = 'OSM estimate (not reviews)' WHERE id = ?")
      .run(Math.min(30,score),Math.min(30,score),Math.min(30,score),JSON.stringify(reasons),JSON.stringify(p),Number(r.id));
  }
}

export type CompanyFilters = {
  keyword?: string;
  search?: string;
  status?: string;
  area?: string;
  hasWebsite?: boolean;
  hasContact?: boolean;
  showAll?: boolean;
};

export async function listCompanies(filters: CompanyFilters = {}) {
  const settings = await getSettings();
  const conditions: string[] = [];
  const values: SQLInputValue[] = [];
  if (!filters.showAll) {
    conditions.push("c.value_score >= ? AND c.problem_score >= ? AND COALESCE(c.osm_profile_json::jsonb->>'isChain','false') <> 'true'");
    values.push(settings.minValue,settings.minProblem);
  }
  conditions.push("c.status <> 'Do not contact'");
  if(filters.keyword){conditions.push("c.keyword = ?");values.push(filters.keyword);}
  if (filters.search?.trim()) {
    conditions.push("(LOWER(c.name) LIKE ? OR LOWER(c.area) LIKE ? OR LOWER(c.keyword) LIKE ?)");
    const needle = `%${filters.search.trim().toLowerCase()}%`;
    values.push(needle, needle, needle);
  }
  if (filters.status) {
    conditions.push("c.status = ?");
    values.push(filters.status);
  }
  if (filters.area) {
    conditions.push("c.area = ?");
    values.push(filters.area);
  }
  if (filters.hasWebsite === true) conditions.push("c.website_url IS NOT NULL");
  if (filters.hasWebsite === false) conditions.push("c.website_url IS NULL");
  if (filters.hasContact === true) conditions.push("(c.phone IS NOT NULL OR c.email IS NOT NULL OR c.whatsapp IS NOT NULL)");
  if (filters.hasContact === false) conditions.push("(c.phone IS NULL AND c.email IS NULL AND c.whatsapp IS NULL)");
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = (await leadDb
    .prepare(
      `SELECT ${COMPANY_COLUMNS} FROM companies c ${where}
       ORDER BY c.opportunity_score DESC, c.name COLLATE NOCASE ASC`,
    )
    .all(...values)) as CompanyRow[];
  return rows.map(toCompany);
}

export async function getCompany(id: number) {
  const row = (await leadDb
    .prepare(`SELECT ${COMPANY_COLUMNS} FROM companies c WHERE c.id = ?`)
    .get(id)) as CompanyRow | undefined;
  if (!row) return null;
  const checks = (await leadDb
    .prepare(
      `SELECT checked_at AS checkedAt, website_type AS websiteType,
        psi_mobile_score AS psiMobileScore, lcp_seconds AS lcpSeconds,
        https, has_viewport AS hasViewport, copyright_year AS copyrightYear,
        has_tel_link AS hasTelLink, has_whatsapp_link AS hasWhatsappLink,
        has_contact_form AS hasContactForm, has_contact_page AS hasContactPage,
        site_builder AS siteBuilder,
      design_score AS designScore, design_reason AS designReason,
      ai_model AS aiModel, ai_generated_at AS aiGeneratedAt,
        design_status AS designStatus,
        cta_obvious AS ctaObvious, retry_count AS retryCount,
        check_status AS checkStatus, last_error AS lastError,
        CASE WHEN screenshot_desktop_path IS NOT NULL
          THEN '/api/companies/' || company_id || '/screenshots/desktop' END AS screenshotDesktopUrl,
        CASE WHEN screenshot_mobile_path IS NOT NULL
          THEN '/api/companies/' || company_id || '/screenshots/mobile' END AS screenshotMobileUrl
       FROM checks WHERE company_id = ? ORDER BY checked_at DESC`,
    )
    .all(id));
  const activity = (await listActivity({ companyId: id, limit: 50 }));
  const outreach = (await leadDb
    .prepare(
      `SELECT id, channel, sequence_no AS sequenceNo, subject, body, sent_at AS sentAt,
        replied_at AS repliedAt, result, next_followup_at AS nextFollowupAt
       FROM outreach WHERE company_id = ? ORDER BY id DESC`,
    )
    .all(id));
  return { ...toCompany(row), checks, activity, outreach };
}

export async function createCompany(input: Record<string, unknown>) {
  const web = normalizeWebsite(typeof input.websiteUrl === "string" ? input.websiteUrl : null);
  const phone = normalizePhone(String(input.phone ?? ""));
  const now = nowIso();
  const placeId = `manual:${randomUUID()}`;
  const suppliedReasons = Array.isArray(input.reasons)
    ? input.reasons.filter((item) => typeof item === "string")
    : [];
  const observation = typeof input.findingType === "string" ? input.findingType.trim() : "";
  const reasons = suppliedReasons.length ? suppliedReasons : observation ? [observation] : [];
  const findingType = observation ? "manual" : null;
  const result = (await leadDb
    .prepare(
      `INSERT INTO companies (
        place_id, name, address, area, keyword, phone, website_url, rating,
        review_count, status, value_score, problem_score, opportunity_score,
        reasons_json, finding_type, fetched_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'New', 0, 0, 0, ?, ?, ?, ?)`,
    )
    .run(
      placeId,
      String(input.name),
      String(input.address ?? ""),
      String(input.area ?? "Other KL"),
      String(input.keyword ?? ""),
      phone,
      web.websiteUrl,
      Number(input.rating ?? 0),
      Number(input.reviewCount ?? 0),
      JSON.stringify(reasons),
      findingType,
      now,
      now,
    ));
  const id = Number(result.lastInsertRowid);
  await leadDb.prepare("UPDATE companies SET osm_profile_json = ?, rating_available = 0 WHERE id = ?")
    .run(JSON.stringify({...web,phones:phone?[phone]:[],manualValue:0,editedFields:["name","websiteUrl","phone"]}),id);
  (await addActivity(id, "status_changed", null, null, "Company added manually."));
  return (await getCompany(id));
}

export type GooglePlaceInput = {
  placeId: string;
  area: string;
  keyword: string;
};

export async function upsertGooglePlace(input: GooglePlaceInput) {
  const placeId = `google:${input.placeId.replace(/^google:/, "")}`;
  const now = nowIso();
  const existing = (await leadDb.prepare("SELECT id FROM companies WHERE place_id = ?").get(placeId)) as { id: number } | undefined;
  (await leadDb.prepare(`
    INSERT INTO companies (
      place_id, name, address, area, keyword, fetched_at, created_at, source,
      google_updated_at, rating_available, value_score_method, value_score_base,
      value_score_details_json
    ) VALUES (?, ?, '', ?, ?, ?, ?, 'google_places', ?, 0, 'Live Google Places estimate (not stored)', 0, '[]')
    ON CONFLICT(place_id) DO UPDATE SET
      fetched_at = excluded.fetched_at,
      google_updated_at = excluded.google_updated_at,
      source = 'google_places'
  `).run(
    placeId,
    `Google Place ${placeId.slice(-6)}`,
    input.area,
    input.keyword,
    now,
    now,
    now,
  ));
  const row = (await leadDb.prepare("SELECT id FROM companies WHERE place_id = ?").get(placeId)) as { id: number };
  return { id: Number(row.id), isNew: !existing };
}

export function calculateLiveGoogleValue(input: { keyword: string; rating?: number; reviewCount?: number }) {
    const reviewCount = Math.max(0, Number(input.reviewCount) || 0);
    const rating = Math.max(0, Number(input.rating) || 0);
    const categoryText = input.keyword.toLowerCase();
    const categoryScore = /dental|medical|clinic|law|legal|account|aesthetic|hotel|real estate|property|renovation|interior|school|wedding/.test(categoryText) ? 8 : 0;
    const reviewScore = reviewCount >= 200 ? 12 : reviewCount >= 50 ? 8 : reviewCount >= 20 ? 4 : 0;
    const ratingScore = rating >= 4.2 ? 5 : rating >= 4 ? 3 : 0;
    const score = Math.min(30, categoryScore + reviewScore + ratingScore);
    const details = [
      ...(categoryScore ? [`Business category match (+${categoryScore})`] : []),
      ...(reviewScore ? [`${reviewCount.toLocaleString()} Google reviews (+${reviewScore})`] : []),
      ...(ratingScore ? [`Google rating ${rating.toFixed(1)} (+${ratingScore})`] : []),
      ...(!rating && !reviewCount ? ["No published rating or review count; category estimate only."] : []),
    ];
    const method = rating || reviewCount
      ? "Google Places rating/review proxy"
      : "Google Places category estimate";
    return { valueScore: score, valueScoreMethod: `${method} (live only)`, valueScoreDetails: details };
}

export async function recordGooglePlacesRequest(keyword: string, area: string, kind: "search" | "details" = "search") {
  (await leadDb.prepare(`
    INSERT INTO searches (keyword, area, ran_at, api_calls, results_count, provider, request_kind)
    VALUES (?, ?, ?, 1, 0, 'google_places', ?)
  `).run(keyword, area, nowIso(), kind));
}

export async function recordGeminiRequest() {
  (await leadDb.prepare("INSERT INTO ai_api_usage (requested_at) VALUES (?)").run(nowIso()));
}

export async function markGoogleLiveLookup(id: number) {
  const now = nowIso();
  (await leadDb.prepare("UPDATE companies SET google_updated_at = ? WHERE id = ?").run(now, id));
  return now;
}

export async function deleteSampleData() {
  return withAllData(() => withTransaction(async () => {
    const row = await leadDb.prepare("SELECT COUNT(*) AS count FROM companies WHERE source = 'demo'").get();
    await leadDb.prepare("DELETE FROM companies WHERE source = 'demo'").run();
    for (const table of ["outreach", "activity", "checks", "searches", "research_jobs", "ai_api_usage"]) {
      await leadDb.prepare(`DELETE FROM ${table} WHERE is_demo = 1`).run();
    }
    await leadDb.prepare("DELETE FROM app_meta WHERE key = 'sample_pipeline_seeded'").run();
    return { deletedCompanies: Number(row?.count ?? 0) };
  }));
}

export async function loadDemoData() {
  return withDataMode(true, () => withTransaction(async () => {
    // Serialise explicit loads so double-clicks cannot create a partial fixture.
    await leadDb.prepare("SELECT pg_advisory_xact_lock(4170624)").get();
    await seedSampleCompanies();
    await seedSamplePipelineOnce();
    const row = await leadDb.prepare("SELECT COUNT(*) AS count FROM companies").get();
    return { companies: Number(row?.count ?? 0) };
  }));
}

export type WebsiteCheckInput = {
  websiteType: "own" | "social" | "down" | "none" | "unknown";
  psiMobileScore: number | null;
  lcpSeconds: number | null;
  https: boolean | null;
  hasViewport: boolean | null;
  copyrightYear: number | null;
  hasTelLink: boolean | null;
  hasWhatsappLink: boolean | null;
  hasContactForm: boolean | null;
  hasContactPage: boolean | null;
  siteBuilder: string | null;
  retryCount: number;
  checkStatus: "completed" | "failed" | "skipped";
  lastError: string | null;
  screenshotDesktopPath: string | null;
  screenshotMobilePath: string | null;
  problemScore: number;
  reasons: string[];
  findingType: string | null;
  email: string | null;
  whatsapp: string | null;
};

export async function saveWebsiteCheck(companyId: number, input: WebsiteCheckInput) {
  const now = nowIso();
  const company = (await leadDb.prepare("SELECT value_score FROM companies WHERE id = ?").get(companyId)) as { value_score: number } | undefined;
  if (!company) return false;
  (await leadDb.prepare(`
    UPDATE companies SET
      email = CASE WHEN jsonb_exists(COALESCE(osm_profile_json::jsonb->'editedFields','[]'::jsonb),'email') THEN email ELSE COALESCE(NULLIF(email, ''), ?) END,
      whatsapp = CASE WHEN jsonb_exists(COALESCE(osm_profile_json::jsonb->'editedFields','[]'::jsonb),'whatsapp') THEN whatsapp ELSE COALESCE(NULLIF(whatsapp, ''), ?) END,
      problem_score = ?,
      opportunity_score = value_score + ?,
      reasons_json = ?,
      finding_type = ?,
      fetched_at = ?
    WHERE id = ?
  `).run(
    input.email,
    input.whatsapp,
    input.problemScore,
    input.problemScore,
    JSON.stringify(input.reasons.slice(0, 3)),
    input.findingType,
    now,
    companyId,
  ));
  const designStatus = input.screenshotDesktopPath && input.screenshotMobilePath ? "pending" : "unavailable";
  (await leadDb.prepare(`
    INSERT INTO checks (
      company_id, checked_at, website_type, psi_mobile_score, lcp_seconds,
      https, has_viewport, copyright_year, has_tel_link, has_whatsapp_link,
      has_contact_form, has_contact_page, site_builder, design_score, design_reason, cta_obvious,
      design_status, website_problem_score, retry_count, check_status, last_error,
      screenshot_desktop_path, screenshot_mobile_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    companyId,
    now,
    input.websiteType,
    input.psiMobileScore,
    input.lcpSeconds,
    input.https == null ? null : Number(input.https),
    input.hasViewport == null ? null : Number(input.hasViewport),
    input.copyrightYear,
    input.hasTelLink == null ? null : Number(input.hasTelLink),
    input.hasWhatsappLink == null ? null : Number(input.hasWhatsappLink),
    input.hasContactForm == null ? null : Number(input.hasContactForm),
    input.hasContactPage == null ? null : Number(input.hasContactPage),
    input.siteBuilder,
    designStatus === "pending" ? null : "Screenshots were unavailable for design scoring.",
    designStatus,
    input.problemScore,
    input.retryCount,
    input.checkStatus,
    input.lastError,
    input.screenshotDesktopPath,
    input.screenshotMobilePath,
  ));
  return true;
}

export async function getLatestDesignScreenshotPaths(companyId: number) {
  const row = (await leadDb.prepare(`
    SELECT screenshot_desktop_path AS desktopPath, screenshot_mobile_path AS mobilePath
    FROM checks WHERE company_id = ? ORDER BY checked_at DESC, id DESC LIMIT 1
  `).get(companyId)) as { desktopPath: string | null; mobilePath: string | null } | undefined;
  if (!row?.desktopPath || !row.mobilePath) return null;
  return { desktopPath: row.desktopPath, mobilePath: row.mobilePath };
}

export async function updateLatestDesignResult(input: {
  companyId: number;
  status: "pending" | "completed" | "failed" | "unavailable";
  score?: number | null;
  ctaObvious?: boolean | null;
  reasons?: string[];
  message?: string | null;
}) {
  const check = (await leadDb.prepare(`
    SELECT id, website_problem_score AS websiteProblemScore
    FROM checks WHERE company_id = ? ORDER BY checked_at DESC, id DESC LIMIT 1
  `).get(input.companyId)) as { id: number; websiteProblemScore: number } | undefined;
  if (!check) return false;
  const score = input.status === "completed" ? Number(input.score ?? 0) : null;
  const ctaObvious = input.status === "completed" && typeof input.ctaObvious === "boolean"
    ? Number(input.ctaObvious)
    : null;
  const reason = input.reasons?.length
    ? input.reasons.slice(0, 3).join(" ")
    : input.message ?? null;
  (await leadDb.prepare(`
    UPDATE checks SET design_score = ?, design_reason = ?, cta_obvious = ?, design_status = ?,
      ai_model = ?, ai_generated_at = ?
    WHERE id = ?
  `).run(score, reason, ctaObvious, input.status, input.status === "completed" ? MODEL : null, input.status === "completed" ? nowIso() : null, check.id));
  if (input.status === "completed") {
    await leadDb.prepare("UPDATE companies SET ai_model = ?, ai_generated_at = ? WHERE id = ?").run(MODEL, nowIso(), input.companyId);
  }
  const websiteScore = Number(check.websiteProblemScore) || 0;
  const problemScore = input.status === "completed"
    ? Math.min(70, websiteScore + ((score ?? 10)<=4 ? 20 : (score ?? 10)<=6 ? 10 : 0))
    : websiteScore;
  if (input.status === "completed" && input.reasons?.length) {
    const company = (await leadDb.prepare("SELECT reasons_json FROM companies WHERE id = ?").get(input.companyId)) as { reasons_json: string } | undefined;
    let existingReasons: string[] = [];
    try {
      const parsed: unknown = JSON.parse(company?.reasons_json ?? "[]");
      if (Array.isArray(parsed)) existingReasons = parsed.filter((item): item is string => typeof item === "string");
    } catch {
      existingReasons = [];
    }
    const combined = [...existingReasons, ...input.reasons].filter((item, index, items) => items.indexOf(item) === index).slice(0, 3);
    (await leadDb.prepare("UPDATE companies SET reasons_json = ? WHERE id = ?").run(JSON.stringify(combined), input.companyId));
  }
  if(input.status==="completed"&&(input.ctaObvious===false||(score??10)<=6)){
    await leadDb.prepare("UPDATE companies SET finding_type = COALESCE(finding_type, ?) WHERE id = ?")
      .run(input.ctaObvious===false?"cta_hidden":"outdated",input.companyId);
  }
  (await leadDb.prepare(`
    UPDATE companies SET problem_score = ?, opportunity_score = value_score + ? WHERE id = ?
  `).run(problemScore, problemScore, input.companyId));
  return true;
}

export async function getCompanyScreenshotPath(companyId: number, variant: "desktop" | "mobile") {
  const column = variant === "desktop" ? "screenshot_desktop_path" : "screenshot_mobile_path";
  const row = (await leadDb.prepare(
    `SELECT ${column} AS screenshotPath FROM checks WHERE company_id = ? AND ${column} IS NOT NULL ORDER BY checked_at DESC LIMIT 1`,
  ).get(companyId)) as { screenshotPath: string } | undefined;
  return row?.screenshotPath ?? null;
}

export async function updateCompany(id: number, patch: Record<string, unknown>) {
  return withTransaction(async()=>{
  const before = await getCompany(id);
  if(!before)return null;
  const raw = await leadDb.prepare("SELECT osm_profile_json FROM companies WHERE id = ?").get(id);
  const profile = parseProfile(raw?.osm_profile_json);
  if("websiteUrl" in patch){
    const web=normalizeWebsite(patch.websiteUrl as string|null);patch.websiteUrl=web.websiteUrl;
    Object.assign(profile,web,{websiteConfirmedNone:false});
  }
  if("phone" in patch)patch.phone=normalizePhone(String(patch.phone??""));
  if("whatsapp" in patch){patch.whatsapp=normalizePhone(String(patch.whatsapp??""));profile.whatsappDerived=false;}
  if("manualValue" in patch)profile.manualValue=Number(patch.manualValue);
  if("websiteConfirmedNone" in patch){
    profile.websiteConfirmedNone=Boolean(patch.websiteConfirmedNone);
    if(profile.websiteConfirmedNone){patch.websiteUrl=null;profile.websiteType="none";}
  }
  profile.editedFields=[...new Set([...(profile.editedFields??[]),...Object.keys(patch)])];
  await leadDb.prepare("UPDATE companies SET osm_profile_json = ? WHERE id = ?").run(JSON.stringify(profile),id);
  const allowed: Record<string, string> = {
    name: "name",
    phone: "phone",
    websiteUrl: "website_url",
    firstName: "first_name",
    email: "email",
    whatsapp: "whatsapp",
    notes: "notes",
  };
  const entries = Object.entries(patch).filter(([key]) => key in allowed);
  if (entries.length) {
    const assignments = entries.map(([key]) => `${allowed[key]} = ?`).join(", ");
    const values = entries.map(([key,value]) => ["name","firstName","notes"].includes(key) ? String(value??"") : value === "" ? null : value as SQLInputValue);
    (await leadDb.prepare(`UPDATE companies SET ${assignments} WHERE id = ?`).run(...values, id));
  }
  await recomputeOsmValues();
  return (await getCompany(id));
  });
}

export async function updateCompanyStatus(id: number, status: string) {
  const existing = (await getCompany(id));
  if (!existing) return null;
  if (existing.isDoNotContact && status !== "Do not contact") {
    throw new Error("Do not contact is permanent and cannot be changed.");
  }
  (await leadDb.prepare("UPDATE companies SET status = ? WHERE id = ? AND (status <> 'Do not contact' OR ? = 'Do not contact')").run(status, id, status));
  (await addActivity(id, "status_changed", null, null, `Status changed to ${status}.`));
  return (await getCompany(id));
}

export async function markDoNotContact(id: number) {
  return withTransaction(async()=>{
  await leadDb.prepare("SELECT pg_advisory_xact_lock(hashtext(?))").get(`company:${id}`);
  const existing = (await getCompany(id));
  if (!existing) return null;
  (await leadDb.prepare("UPDATE companies SET status = 'Do not contact' WHERE id = ?").run(id));
  (await leadDb
    .prepare("UPDATE outreach SET result = 'do_not_contact', next_followup_at = NULL WHERE company_id = ?")
    .run(id));
  (await addActivity(id, "marked_do_not_contact", null, null, "Do not contact set permanently."));
  return (await getCompany(id));
  });
}

export async function addActivity(
  companyId: number,
  action: string,
  channel: string | null,
  sequenceNo: number | null,
  note: string,
) {
  (await leadDb
    .prepare(
      "INSERT INTO activity (company_id, timestamp, action, channel, sequence_no, note) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(companyId, nowIso(), action, channel, sequenceNo, note));
}

export async function listActivity(filters: {
  search?: string;
  action?: string;
  channel?: string;
  date?: string;
  companyId?: number;
  limit?: number;
} = {}) {
  const conditions: string[] = [];
  const values: SQLInputValue[] = [];
  if (filters.search?.trim()) {
    conditions.push("(c.source = 'google_places' OR LOWER(c.name) LIKE ? OR LOWER(a.note) LIKE ?)");
    const needle = `%${filters.search.trim().toLowerCase()}%`;
    values.push(needle, needle);
  }
  if (filters.action) {
    conditions.push("a.action = ?");
    values.push(filters.action);
  }
  if (filters.channel) {
    conditions.push("a.channel = ?");
    values.push(filters.channel);
  }
  if (filters.date) {
    conditions.push("strftime('%Y-%m-%d', a.timestamp, '+8 hours') = ?");
    values.push(filters.date);
  }
  if (filters.companyId) {
    conditions.push("a.company_id = ?");
    values.push(filters.companyId);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filters.limit ?? 500, 1), 1000);
  return (await leadDb
    .prepare(
      `SELECT a.id, a.company_id AS companyId, c.name AS companyName, a.timestamp,
        a.action, a.channel, a.sequence_no AS sequenceNo, a.note
       FROM activity a JOIN companies c ON c.id = a.company_id
       ${where} ORDER BY a.timestamp DESC LIMIT ?`,
    )
    .all(...values, limit));
}

function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(headers: string[], rows: unknown[][]) {
  return `\uFEFF# Map data © OpenStreetMap contributors (ODbL)\r\n${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}

export async function exportCompaniesCsv() {
  const rows = (await leadDb.prepare(`
    SELECT place_id AS placeId, name, area, keyword, address, phone, website_url AS websiteUrl,
      maps_url AS mapsUrl, rating, review_count AS reviewCount, price_level AS priceLevel,
      email, whatsapp, status, value_score AS valueScore,
      problem_score AS problemScore, opportunity_score AS opportunityScore,
      finding_type AS findingType, reasons_json AS reasonsJson, source,
      google_updated_at AS googleUpdatedAt, is_sample_data AS isSampleData
    FROM companies ORDER BY opportunity_score DESC, name COLLATE NOCASE ASC
  `).all()) as Array<Record<string, unknown>>;
  return toCsv(
    ["Place ID", "Name", "Area", "Category", "Address", "Phone", "Website", "Maps URL", "Rating", "Review count", "Price level", "Email", "WhatsApp", "Status", "Value score", "Problem score", "Opportunity score", "Finding type", "Top reasons", "Source", "Google updated at", "Fictional sample"],
    rows.map((row) => {
      let reasons = "";
      try {
        const parsed: unknown = JSON.parse(String(row.reasonsJson ?? "[]"));
        if (Array.isArray(parsed)) reasons = parsed.filter((item) => typeof item === "string").join(" | ");
      } catch {
        reasons = "";
      }
      const google = row.source === "google_places";
      return [
        row.placeId, google ? "" : row.name, row.area, row.keyword, google ? "" : row.address, google ? "" : row.phone, google ? "" : row.websiteUrl,
        google ? "" : row.mapsUrl, google ? "" : row.rating, google ? "" : row.reviewCount, google ? "" : row.priceLevel, row.email,
        row.whatsapp, row.status, google ? "" : row.valueScore, row.problemScore,
        google ? "" : row.opportunityScore, row.findingType, reasons, row.source,
        row.googleUpdatedAt, row.source === "demo" ? "yes" : "no",
      ];
    }),
  );
}

export async function exportOutreachCsv() {
  const rows = (await leadDb.prepare(`
    SELECT c.place_id AS placeId, c.source, c.name AS companyName, c.area, o.channel, o.sequence_no AS sequenceNo,
      o.subject, o.body, o.sent_at AS sentAt, o.replied_at AS repliedAt,
      o.result, o.next_followup_at AS nextFollowupAt
    FROM outreach o JOIN companies c ON c.id = o.company_id
    ORDER BY COALESCE(o.sent_at, '') DESC, c.name COLLATE NOCASE ASC
  `).all()) as Array<Record<string, unknown>>;
  return toCsv(
    ["Place ID", "Company", "Area", "Channel", "Sequence", "Subject", "Body", "Marked sent at (self-reported)", "Reply logged at (self-reported)", "Result (self-reported)", "Next follow-up at"],
    rows.map((row) => [
      row.placeId, row.source === "google_places" ? "" : row.companyName, row.area, row.channel, row.sequenceNo, row.subject,
      row.body, row.sentAt, row.repliedAt, row.result, row.nextFollowupAt,
    ]),
  );
}

export async function listFollowups() {
  const through = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  return (await leadDb
    .prepare(
      `SELECT o.company_id AS companyId, c.name AS companyName, c.area,
        o.sequence_no AS sequenceNo, o.channel, o.next_followup_at AS dueAt,
        c.status
       FROM outreach o JOIN companies c ON c.id = o.company_id
       WHERE o.next_followup_at IS NOT NULL AND o.result IS NULL
         AND c.status <> 'Do not contact'
         AND o.next_followup_at <= ?
       ORDER BY o.next_followup_at ASC LIMIT 500`,
    )
    .all(through));
}

function malaysiaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function countSentToday(channel: "email" | "whatsapp") {
  return Number(
    (
      (await leadDb
        .prepare(
          `SELECT COUNT(*) AS count FROM outreach
           WHERE channel = ? AND sent_at IS NOT NULL
             AND strftime('%Y-%m-%d', sent_at, '+8 hours') = ?`,
        )
        .get(channel, malaysiaDate())) as { count: number }
    ).count,
  );
}

export async function getDashboard() {
  const settings = (await getSettings());
  const count = async (sql: string, ...args: SQLInputValue[]) =>
    Number(((await leadDb.prepare(sql).get(...args)) as { count: number }).count);
  const totalCompanies = (await count("SELECT COUNT(*) AS count FROM companies"));
  const contacted = (await count("SELECT COUNT(DISTINCT company_id) AS count FROM outreach WHERE sent_at IS NOT NULL"));
  const replies = (await count("SELECT COUNT(DISTINCT company_id) AS count FROM outreach WHERE replied_at IS NOT NULL"));
  const sentWhatsApp = (await count("SELECT COUNT(*) AS count FROM outreach WHERE channel = 'whatsapp' AND sent_at IS NOT NULL"));
  const statusCount = async (status: string) => (await count("SELECT COUNT(*) AS count FROM companies WHERE status = ?", status));
  const byStatus = (await leadDb
    .prepare("SELECT status, COUNT(*) AS count FROM companies GROUP BY status ORDER BY count DESC")
    .all());
  const bySequence = (await leadDb
    .prepare(
      "SELECT sequence_no AS sequenceNo, COUNT(*) AS count FROM outreach WHERE channel = 'email' AND sent_at IS NOT NULL GROUP BY sequence_no ORDER BY sequence_no",
    )
    .all());
  const googlePlacesRequestsCount = (await count(
    "SELECT COALESCE(SUM(api_calls), 0) AS count FROM searches WHERE provider = 'google_places' AND substr(ran_at, 1, 7) = ?",
    malaysiaDate().slice(0, 7),
  ));
  const replyRatesByFindingType = (await leadDb.prepare(`
    SELECT COALESCE(NULLIF(o.finding_type_at_send, ''), NULLIF(c.finding_type, ''), 'unclassified') AS findingType,
      COUNT(DISTINCT o.company_id) AS sent,
      COUNT(DISTINCT CASE WHEN o.replied_at IS NOT NULL THEN o.company_id END) AS replied
    FROM outreach o JOIN companies c ON c.id = o.company_id
    WHERE o.sent_at IS NOT NULL
    GROUP BY COALESCE(NULLIF(o.finding_type_at_send, ''), NULLIF(c.finding_type, ''), 'unclassified')
    ORDER BY sent DESC, findingType ASC
  `).all()) as Array<{ findingType: string; sent: number; replied: number }>;
  const replyRatesByChannel = (await leadDb.prepare(`
    SELECT channel, COUNT(DISTINCT company_id) AS sent,
      COUNT(DISTINCT CASE WHEN replied_at IS NOT NULL THEN company_id END) AS replied
    FROM outreach
    WHERE sent_at IS NOT NULL
    GROUP BY channel
    ORDER BY sent DESC, channel ASC
  `).all()) as Array<{ channel: string; sent: number; replied: number }>;
  const withRates = <T extends { sent: number; replied: number }>(rows: T[]) =>
    rows.map((row) => ({
      ...row,
      sent: Number(row.sent),
      replied: Number(row.replied),
      replyRate: row.sent && row.replied ? Math.round((row.replied / row.sent) * 1000) / 10 : null,
    }));
  return {
    totals: {
      companies: totalCompanies,
      contacted,
      replies,
      replyRate: contacted && replies ? Math.round((replies / contacted) * 1000) / 10 : null,
      wantsHero: (await statusCount("Wants hero")),
      heroSent: (await statusCount("Hero sent")),
      won: (await statusCount("Won")),
      whatsappSent: sentWhatsApp,
    },
    sentToday: { email: (await countSentToday("email")), whatsapp: (await countSentToday("whatsapp")) },
    limits: {
      email: Number(settings.emailDailyLimit),
      whatsapp: Number(settings.whatsappDailyLimit),
    },
    byStatus: byStatus.map(row => ({ ...row, count: Number(row.count) })),
    bySequence: bySequence.map(row => ({ ...row, count: Number(row.count) })),
    googlePlacesRequestsCount,
    googleSearchRequestsCount: await count("SELECT COALESCE(SUM(api_calls),0) AS count FROM searches WHERE provider='google_places' AND request_kind='search' AND substr(ran_at,1,7)=?", malaysiaDate().slice(0,7)),
    googleDetailsRequestsCount: await count("SELECT COALESCE(SUM(api_calls),0) AS count FROM searches WHERE provider='google_places' AND request_kind='details' AND substr(ran_at,1,7)=?", malaysiaDate().slice(0,7)),
    aiCallsToday: (await count("SELECT COUNT(*) AS count FROM ai_api_usage WHERE strftime('%Y-%m-%d', requested_at, '+8 hours') = ?", malaysiaDate())),
    importsThisWeek: await count("SELECT COUNT(*) AS count FROM searches WHERE provider = 'openstreetmap' AND ran_at >= ?",new Date(Date.now()-7*86400_000).toISOString()),
    replyRatesByFindingType: withRates(replyRatesByFindingType),
    replyRatesByChannel: withRates(replyRatesByChannel),
  };
}

const BANNED_DRAFT_PHRASES = [
  /\bguarantee(?:d|s)?\b/i,
  /\b\d+(?:\.\d+)?\s*%/i,
  /(?:\bRM|\bMYR|\bUSD|\$)\s?\d+(?:\.\d{1,2})?\b/i,
  /\bI (?:already )?(?:called|visited)\b/i,
  /\bI checked (?:your|the) (?:website|site) on my phone\b/i,
  /\bI found you on Google Maps\b/i,
  /\bwe(?:'ve| have) worked together\b/i,
  /\b(?:will|can|could) (?:bring|get|increase|generate) (?:you )?(?:more )?(?:leads|enquiries|customers|sales)\b/i,
  /I hope this email finds you well/i,
  /!/,
  /\b(?:synergy|leverage|game[- ]changer|world[- ]class|cutting[- ]edge|transformative|revolutionary)\b/i,
];

function countWords(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function normalizedWords(value: string) {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function validateAiDraft(
  draft: { emailBody: string; whatsappBody: string; subject: string },
  companyName: string,
  finding: string,
) {
  const text = [draft.subject, draft.emailBody, draft.whatsappBody].join("\n");
  const company = normalizedWords(companyName);
  const exactFinding = normalizedWords(finding);
  const email = normalizedWords(draft.emailBody);
  const whatsapp = normalizedWords(draft.whatsappBody);
  return (
    Boolean(company && exactFinding) &&
    normalizedWords(draft.subject).includes(company) &&
    email.includes(company) &&
    whatsapp.includes(company) &&
    email.includes(exactFinding) &&
    whatsapp.includes(exactFinding) &&
    countWords(draft.emailBody) < 100 &&
    countWords(draft.whatsappBody) <= 40 &&
    countWords(draft.subject) < 100 &&
    !text.split(/[\n.!?]/).some(line=>/[A-Z]/.test(line)&&!/[a-z]/.test(line)&&line.trim().split(/\s+/).length>=4) &&
    !BANNED_DRAFT_PHRASES.some((phrase) => phrase.test(text))
  );
}

export async function generateDraft(id: number, liveName?: string) {
  const company = (await getCompany(id));
  if (!company) return { error: "Company not found." } as const;
  if (company.source === "google_places") return { error: "This is an archived Google record. Add independently verified details or import from OpenStreetMap before drafting." } as const;
  if (liveName) company.name = liveName;
  if (company.isDoNotContact) return { error: "This company is marked Do not contact." } as const;
  if(company.emailCount>=3)return {error:"Maximum 3 emails per company reached."} as const;
  if(company.emailCount>0&&company.outreach.some(o=>o.repliedAt))return {error:"A reply is recorded. Follow-up drafts are not available."} as const;
  if (!company.findingType || company.reasons.length === 0) {
    return { error: "Need a real finding first." } as const;
  }
  if(!company.websiteUrl&&!company.websiteConfirmedNone&&company.findingType!=="manual")return {error:"Need a real finding first. Add a website or confirm no website."} as const;
  const settings = (await getSettings());
  if (!settings.myWhatsapp) {
    return { error: "Add your WhatsApp number in Settings before generating a draft." } as const;
  }
  const leadFinding = company.reasons[0]!;
  const check=company.checks[0];
  let finding: string;
  switch (company.findingType) {
    case "no_contact_button":
      finding = check?.hasTelLink===0&&check?.hasWhatsappLink===0 ? "I couldn't find a WhatsApp or call button." : check?.hasWhatsappLink===0 ? "I couldn't find a WhatsApp link." : "I couldn't find a call link.";
      break;
    case "slow_mobile": {
      const time = check?.lcpSeconds;
      finding = time
        ? `Mobile largest contentful paint takes about ${time} seconds.`
        : `The stored mobile performance score is ${check?.psiMobileScore ?? "unavailable"}/100.`;
      break;
    }
    case "not_secure":
      finding = "The browser shows the site as not secure.";
      break;
    case "site_down":
      finding = "The site didn't open when I tried it.";
      break;
    case "outdated": {
      const year = check?.copyrightYear;
      finding = year
        ? `The copyright notice shows ${year}.`
        : `The visual design review rated the homepage ${check?.designScore ?? "unavailable"}/10.`;
      break;
    }
    case "no_website":
      if(!company.websiteConfirmedNone)return {error:"Need a real finding first. Confirm no website before using this finding."} as const;
      finding = company.socialUrl ? "I couldn't find a website for it, only a social page." : "No website was found in my manual check.";
      break;
    case "cta_hidden":
      finding = "The main contact button isn't easy to spot.";
      break;
    case "manual":
      finding = leadFinding.trim();
      if (!finding) return { error: "Need a real finding first." } as const;
      if (!/[.!?]$/.test(finding)) finding = `${finding}.`;
      break;
    default:
      return { error: "Need a real finding first." } as const;
  }
  const greeting = company.firstName.trim() ? `Hi ${company.firstName.trim()},` : "Hi there,";
  const subject = `Quick note about ${company.name}'s website`;
  const sourceIntro = `I found ${company.name} online.`;
  const emailBody = `${greeting}

${sourceIntro} ${finding} That might be costing you some enquiries.

I'm ${settings.myName}, a ${settings.myTitle.toLowerCase()}.

I'd like to offer a free homepage top-section concept. No strings. Want me to send it over?

My work: ${settings.portfolioUrl}

Not interested? Tell me and I won't message again.

${settings.myName}
${settings.myTitle}
WhatsApp: ${settings.myWhatsapp}`;
  const whatsappBody = `Hi ${company.firstName.trim() || "there"}, I'm ${settings.myName.split(" ")[0]}, a web designer. ${company.name}: ${finding} Free homepage concept? No strings. ${settings.portfolioUrl}`;
  let finalDraft = { subject, emailBody, whatsappBody };
  let draftMode: "gemini" | "template" = "template";
  try {
    if(company.emailCount>0)throw new Error("Use the prescribed local follow-up template.");
    if (inDemoMode()) throw new Error("Demo drafts use the local template; no external AI call.");
    const aiDraft = await generateOutreachDraft({
      companyName: company.name,
      area: company.area,
      keyword: company.keyword,
      finding,
      aiInstruction: String(settings.aiInstruction ?? ""),
      senderName: String(settings.myName ?? ""),
      senderTitle: String(settings.myTitle ?? ""),
      portfolioUrl: String(settings.portfolioUrl ?? ""),
      whatsappNumber: String(settings.myWhatsapp ?? ""),
    }, recordGeminiRequest);
    if (validateAiDraft(aiDraft, company.name, finding)) {
      finalDraft = aiDraft;
      draftMode = "gemini";
      await leadDb.prepare("UPDATE companies SET ai_model = ?, ai_generated_at = ? WHERE id = ?").run(MODEL, nowIso(), id);
    }
  } catch {
    // Keep the plain, fact-based template when Gemini is unavailable.
  }
  if(draftMode==="template"){
    if(countWords(finalDraft.emailBody)>=100)finalDraft.emailBody=`${greeting}\n\n${company.name}: ${finding} That might be costing you some enquiries.\n\nI'm ${settings.myName}, a ${settings.myTitle.toLowerCase()}. Free homepage top-section concept, no strings. Want me to send it over?\n\n${settings.portfolioUrl}\nNot interested? Tell me and I won't message again.\n\n${settings.myName}\nWhatsApp: ${settings.myWhatsapp}`;
    if(countWords(finalDraft.whatsappBody)>40)finalDraft.whatsappBody=`Hi there. ${company.name}: ${finding} Free homepage concept? No strings. ${settings.portfolioUrl}`;
  }
  if(company.emailCount>0){
    finalDraft.subject=`Re: Quick note about ${company.name}'s website`;
    finalDraft.emailBody=company.emailCount===1
      ? `${greeting}\n\nJust checking you saw my note. Happy to send the free homepage concept for ${company.name} if you're interested. If not, no worries.\n\n${settings.myName.split(" ")[0]}`
      : `${greeting}\n\nLast message from me about ${company.name}. If your website ever becomes a priority, the free homepage concept offer still stands. My WhatsApp is below.\n\n${settings.myName.split(" ")[0]}\nWhatsApp: ${settings.myWhatsapp}`;
  }
  if (countWords(finalDraft.emailBody) >= 100 || countWords(finalDraft.whatsappBody) > 40) {
    return { error: "The finding or sender details are too long for a draft under 100 words. Shorten them and try again." } as const;
  }
  (await addActivity(
    id,
    "generated",
    null,
    null,
    draftMode === "gemini"
      ? "Generated Gemini drafts and passed content validation."
      : "Gemini was unavailable or its draft failed validation; generated the plain template.",
  ));
  return {
    ...finalDraft,
    finding,
    canOpenWhatsapp: isMobile(normalizePhone(company.whatsapp??company.phone??"")),
    draftMode,
    aiModel: draftMode === "gemini" ? MODEL : null,
  };
}

export async function logCopiedMessage(id: number, channel: "email" | "whatsapp") {
  const company = (await getCompany(id));
  if (!company) return null;
  if (company.isDoNotContact) throw new Error("Do not contact is permanent.");
  (await addActivity(
    id,
    channel === "email" ? "copied_email" : "copied_whatsapp",
    channel,
    null,
    `Copied ${channel} draft.`,
  ));
  if (company.status === "New") {
    (await leadDb.prepare("UPDATE companies SET status = 'Claimed' WHERE id = ? AND status = 'New'").run(id));
  }
  return { ok: true };
}

export async function markMessageSent(
  id: number,
  input: { channel: "email" | "whatsapp"; sequenceNo: number; subject?: string; body: string },
) {
  return withTransaction(async()=>{
  await leadDb.prepare("SELECT pg_advisory_xact_lock(hashtext(?))").get(`daily:${input.channel}:${malaysiaDate()}`);
  await leadDb.prepare("SELECT pg_advisory_xact_lock(hashtext(?))").get(`company:${id}`);
  const company = (await getCompany(id));
  if (!company) return { error: "Company not found." } as const;
  if (company.isDoNotContact) return { error: "Do not contact is permanent." } as const;
  const settings = (await getSettings());
  const sentToday = (await countSentToday(input.channel));
  const dailyLimit = Number(
    input.channel === "email" ? settings.emailDailyLimit : settings.whatsappDailyLimit,
  );
  if (input.channel === "email") {
    if(input.sequenceNo>1&&company.outreach.some(o=>o.repliedAt))return {error:"A reply is recorded. No further cold follow-up should be sent."} as const;
    if (company.emailCount >= 3) return { error: "Maximum 3 emails per company reached." } as const;
    if (input.sequenceNo !== company.emailCount + 1) {
      return { error: `The next email sequence for this company is #${company.emailCount + 1}.` } as const;
    }
  }
  const now = nowIso();
  if (input.channel === "email" && input.sequenceNo > 1) {
    (await leadDb
      .prepare(
        `UPDATE outreach SET result = 'followed_up', next_followup_at = NULL
         WHERE company_id = ? AND channel = 'email' AND sequence_no = ? AND result IS NULL`,
      )
      .run(id, input.sequenceNo - 1));
  }
  let nextFollowupAt: string | null = null;
  if (input.channel === "email" && input.sequenceNo < 3) {
    const firstSent = (await leadDb
      .prepare(
        "SELECT sent_at AS sentAt FROM outreach WHERE company_id = ? AND channel = 'email' AND sequence_no = 1 AND sent_at IS NOT NULL",
      )
      .get(id)) as { sentAt: string } | undefined;
    const anchor = firstSent ? new Date(firstSent.sentAt) : new Date(now);
    const days = input.sequenceNo === 1 ? Number(settings.followup1Days) : Number(settings.followup2Days);
    anchor.setUTCDate(anchor.getUTCDate() + days);
    nextFollowupAt = anchor.toISOString();
  }
  (await leadDb
    .prepare(
      `INSERT INTO outreach (company_id, channel, sequence_no, subject, body, sent_at, next_followup_at, finding_type_at_send)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.channel, input.sequenceNo, input.subject ?? null, input.body, now, nextFollowupAt, company.findingType));
  const nextStatus =
    input.channel === "email"
      ? input.sequenceNo >= 3
        ? "Closed: no reply"
        : `Sent #${input.sequenceNo}`
      : company.status === "New" || company.status === "Claimed"
        ? "Sent #1"
        : company.status;
  (await leadDb.prepare("UPDATE companies SET status = ? WHERE id = ?").run(nextStatus, id));
  (await addActivity(
    id,
    "marked_sent",
    input.channel,
    input.sequenceNo,
    `Manually marked ${input.channel} #${input.sequenceNo} as sent.${sentToday>=dailyLimit?" Daily limit exceeded; self-reported manual send.":""}`,
  ));
  return (await getCompany(id));
  });
}

export async function logReply(id: number, note: string) {
  const company = (await getCompany(id));
  if (!company) return null;
  if(company.isDoNotContact){await addActivity(id,"reply_logged",null,null,note);return company;}
  const now = nowIso();
  const latest = (await leadDb
    .prepare(
      "SELECT id FROM outreach WHERE company_id = ? AND sent_at IS NOT NULL ORDER BY sent_at DESC LIMIT 1",
    )
    .get(id)) as { id: number } | undefined;
  if (latest) {
    (await leadDb
      .prepare("UPDATE outreach SET replied_at = ?, result = 'replied', next_followup_at = NULL WHERE id = ?")
      .run(now, latest.id));
  }
  (await leadDb
    .prepare(
      "UPDATE outreach SET result = COALESCE(result, 'replied'), next_followup_at = NULL WHERE company_id = ? AND next_followup_at IS NOT NULL",
    )
    .run(id));
  (await leadDb.prepare("UPDATE companies SET status = 'Replied' WHERE id = ?").run(id));
  (await addActivity(id, "reply_logged", null, null, note));
  return (await getCompany(id));
}
