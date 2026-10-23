import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

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
  "Write one short cold email (max 100 words) from Dylan Jong, a freelance web designer, to a local business owner in Malaysia. Use only the facts provided. Never invent numbers or claims. Use the company name and ONE real finding from the data; if none is provided, reply 'Need a real finding first.' Follow the structure of the template exactly: found on Google Maps and checked on phone + the finding + 'That might be costing you some enquiries'; one sentence on who I am; one small free offer (free concept of the top of their homepage, no strings, ask 'Want me to send it over?'); one portfolio link; one opt-out line; sign-off. Simple spoken English, short sentences. Avoid: 'I hope this email finds you well', exclamation marks, ALL CAPS, buzzwords, guarantees, percentages, prices. Use 'might' or 'seems' for anything not directly measured. Also write a WhatsApp version, max 40 words.";

const dbFile = process.env.LEAD_DB_PATH
  ? path.resolve(process.env.LEAD_DB_PATH)
  : path.join(process.cwd(), "data", "lead-finder.sqlite");
mkdirSync(path.dirname(dbFile), { recursive: true });

export const leadDb = new DatabaseSync(dbFile);
leadDb.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    place_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    area TEXT NOT NULL DEFAULT '',
    keyword TEXT NOT NULL DEFAULT '',
    phone TEXT,
    website_url TEXT,
    maps_url TEXT,
    rating REAL NOT NULL DEFAULT 0,
    review_count INTEGER NOT NULL DEFAULT 0,
    price_level TEXT,
    email TEXT,
    whatsapp TEXT,
    first_name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'New',
    value_score INTEGER NOT NULL DEFAULT 0,
    problem_score INTEGER NOT NULL DEFAULT 0,
    opportunity_score INTEGER NOT NULL DEFAULT 0,
    reasons_json TEXT NOT NULL DEFAULT '[]',
    finding_type TEXT,
    notes TEXT NOT NULL DEFAULT '',
    fetched_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    is_sample_data INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    checked_at TEXT NOT NULL,
    website_type TEXT NOT NULL,
    psi_mobile_score INTEGER,
    lcp_seconds REAL,
    https INTEGER,
    has_viewport INTEGER,
    copyright_year INTEGER,
    has_tel_link INTEGER,
    has_whatsapp_link INTEGER,
    has_contact_form INTEGER,
    site_builder TEXT,
    design_score INTEGER,
    design_reason TEXT,
    cta_obvious INTEGER
  );
  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    timestamp TEXT NOT NULL,
    action TEXT NOT NULL,
    channel TEXT,
    sequence_no INTEGER,
    note TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS outreach (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    sequence_no INTEGER NOT NULL,
    subject TEXT,
    body TEXT NOT NULL,
    sent_at TEXT,
    replied_at TEXT,
    result TEXT,
    next_followup_at TEXT
  );
  CREATE TABLE IF NOT EXISTS searches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword TEXT NOT NULL,
    area TEXT NOT NULL,
    ran_at TEXT NOT NULL,
    api_calls INTEGER NOT NULL DEFAULT 0,
    results_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_activity_company_time ON activity(company_id, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_outreach_company_time ON outreach(company_id, sent_at DESC);
  CREATE INDEX IF NOT EXISTS idx_outreach_sent_channel ON outreach(channel, sent_at);
`);

const DEFAULT_SETTINGS = {
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
};

const COMPANY_COLUMNS = `
  c.*,
  (SELECT MAX(o.sent_at) FROM outreach o WHERE o.company_id = c.id) AS last_contacted_at,
  (SELECT MIN(o.next_followup_at) FROM outreach o
    WHERE o.company_id = c.id AND o.next_followup_at IS NOT NULL AND o.result IS NULL) AS next_followup_at,
  (SELECT COUNT(*) FROM outreach o WHERE o.company_id = c.id AND o.channel = 'email' AND o.sent_at IS NOT NULL) AS email_count,
  (SELECT COUNT(*) FROM outreach o WHERE o.company_id = c.id AND o.channel = 'whatsapp' AND o.sent_at IS NOT NULL) AS whatsapp_count
`;

function toCompany(row: CompanyRow): Company {
  const reasonsJson = String(row.reasons_json ?? "[]");
  let reasons: string[] = [];
  try {
    const parsed: unknown = JSON.parse(reasonsJson);
    if (Array.isArray(parsed)) reasons = parsed.filter((item) => typeof item === "string");
  } catch {
    reasons = [];
  }
  return {
    id: Number(row.id),
    placeId: String(row.place_id),
    name: String(row.name),
    address: String(row.address ?? ""),
    area: String(row.area ?? ""),
    keyword: String(row.keyword ?? ""),
    phone: row.phone == null ? null : String(row.phone),
    websiteUrl: row.website_url == null ? null : String(row.website_url),
    mapsUrl: row.maps_url == null ? null : String(row.maps_url),
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
    isSampleData: Number(row.is_sample_data ?? 0) === 1,
  };
}

function nowIso() {
  return new Date().toISOString();
}

function setSetting(key: string, value: unknown) {
  leadDb
    .prepare(
      `INSERT INTO settings (key, value_json) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
    )
    .run(key, JSON.stringify(value));
}

function seedSettings() {
  const insert = leadDb.prepare(
    "INSERT OR IGNORE INTO settings (key, value_json) VALUES (?, ?)",
  );
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    insert.run(key, JSON.stringify(value));
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

function seedSampleCompanies() {
  const existing = Number(
    (leadDb.prepare("SELECT COUNT(*) AS count FROM companies").get() as { count: number }).count,
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
      fetched_at, created_at, is_sample_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 1)
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
    const result = insertCompany.run(
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
    );
    const companyId = Number(result.lastInsertRowid);
    const psiScore = findingType === "slow_mobile" ? 28 + (index % 4) * 5 : null;
    const lcp = findingType === "slow_mobile" ? Number((5.2 + (index % 5) * 0.7).toFixed(1)) : null;
    insertCheck.run(
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
    );
    if (index % 3 === 0) {
      leadDb
        .prepare(
          "INSERT INTO activity (company_id, timestamp, action, channel, note) VALUES (?, ?, 'copied_email', 'email', 'Sample activity only; no message was sent.')",
        )
        .run(companyId, fetchedAt);
    }
  }
}

seedSettings();
seedSampleCompanies();

function seedSamplePipelineOnce() {
  const alreadySeeded = leadDb
    .prepare("SELECT value FROM app_meta WHERE key = 'sample_pipeline_seeded'")
    .get() as { value: string } | undefined;
  if (alreadySeeded) return;

  const sampleCompanies = leadDb
    .prepare("SELECT id FROM companies WHERE is_sample_data = 1 ORDER BY id")
    .all() as { id: number }[];
  if (sampleCompanies.length !== 30) return;
  leadDb
    .prepare(
      `DELETE FROM activity WHERE company_id IN
       (SELECT id FROM companies WHERE is_sample_data = 1)
       AND note LIKE 'Sample activity%'`,
    )
    .run();

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
    statusUpdate.run(status, companyId);
    if (status === "New") continue;
    if (status === "Claimed") {
      addHistory.run(
        companyId,
        stampDaysAgo(5),
        "copied_email",
        "email",
        null,
        "Sample activity only; no message was sent.",
      );
      continue;
    }
    if (status === "Do not contact") {
      addHistory.run(
        companyId,
        stampDaysAgo(5),
        "marked_do_not_contact",
        null,
        null,
        "Sample status only.",
      );
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
      addOutreach.run(
        companyId,
        sequence,
        `Sample subject ${sequence}`,
        "Fictional sample draft. No message was actually sent.",
        sentAt,
        repliedAt,
        result,
        nextFollowupAt,
      );
      addHistory.run(
        companyId,
        sentAt,
        "marked_sent",
        "email",
        sequence,
        "Sample activity only; no message was sent.",
      );
    }
    if (status === "Replied") {
      addHistory.run(
        companyId,
        stampDaysAgo(2),
        "reply_logged",
        "email",
        null,
        "Fictional sample reply; no real response was received.",
      );
    } else if (status !== "Sent #1" && status !== "Sent #2" && status !== "Sent #3") {
      addHistory.run(
        companyId,
        stampDaysAgo(1),
        "status_changed",
        null,
        null,
        `Sample status only: ${status}.`,
      );
    }
  }

  leadDb
    .prepare("INSERT INTO app_meta (key, value) VALUES ('sample_pipeline_seeded', 'true')")
    .run();
}

seedSamplePipelineOnce();

export function getSettings() {
  const rows = leadDb.prepare("SELECT key, value_json FROM settings").all() as {
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

export function updateSettings(patch: Record<string, unknown>) {
  const allowed = new Set(Object.keys(DEFAULT_SETTINGS));
  for (const [key, value] of Object.entries(patch)) {
    if (allowed.has(key)) setSetting(key, value);
  }
  return getSettings();
}

export type CompanyFilters = {
  search?: string;
  status?: string;
  area?: string;
  hasWebsite?: boolean;
  hasContact?: boolean;
  showAll?: boolean;
};

export function listCompanies(filters: CompanyFilters = {}) {
  const conditions: string[] = [];
  const values: SQLInputValue[] = [];
  if (!filters.showAll) {
    conditions.push("c.value_score >= 15 AND c.problem_score >= 25");
  }
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
  const rows = leadDb
    .prepare(
      `SELECT ${COMPANY_COLUMNS} FROM companies c ${where}
       ORDER BY c.opportunity_score DESC, c.name COLLATE NOCASE ASC`,
    )
    .all(...values) as CompanyRow[];
  return rows.map(toCompany);
}

export function getCompany(id: number) {
  const row = leadDb
    .prepare(`SELECT ${COMPANY_COLUMNS} FROM companies c WHERE c.id = ?`)
    .get(id) as CompanyRow | undefined;
  if (!row) return null;
  const checks = leadDb
    .prepare(
      `SELECT checked_at AS checkedAt, website_type AS websiteType,
        psi_mobile_score AS psiMobileScore, lcp_seconds AS lcpSeconds,
        https, has_viewport AS hasViewport, copyright_year AS copyrightYear,
        has_tel_link AS hasTelLink, has_whatsapp_link AS hasWhatsappLink,
        has_contact_form AS hasContactForm, site_builder AS siteBuilder,
        design_score AS designScore, design_reason AS designReason,
        cta_obvious AS ctaObvious FROM checks WHERE company_id = ? ORDER BY checked_at DESC`,
    )
    .all(id);
  const activity = listActivity({ companyId: id, limit: 50 });
  const outreach = leadDb
    .prepare(
      `SELECT id, channel, sequence_no AS sequenceNo, subject, body, sent_at AS sentAt,
        replied_at AS repliedAt, result, next_followup_at AS nextFollowupAt
       FROM outreach WHERE company_id = ? ORDER BY id DESC`,
    )
    .all(id);
  return { ...toCompany(row), checks, activity, outreach };
}

export function createCompany(input: Record<string, unknown>) {
  const now = nowIso();
  const placeId = `manual:${randomUUID()}`;
  const suppliedReasons = Array.isArray(input.reasons)
    ? input.reasons.filter((item) => typeof item === "string")
    : [];
  const observation = typeof input.findingType === "string" ? input.findingType.trim() : "";
  const reasons = suppliedReasons.length ? suppliedReasons : observation ? [observation] : [];
  const findingType = observation ? "manual" : null;
  const result = leadDb
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
      String(input.area),
      String(input.keyword ?? ""),
      input.phone == null ? null : String(input.phone),
      input.websiteUrl == null ? null : String(input.websiteUrl),
      Number(input.rating ?? 0),
      Number(input.reviewCount ?? 0),
      JSON.stringify(reasons),
      findingType,
      now,
      now,
    );
  const id = Number(result.lastInsertRowid);
  addActivity(id, "status_changed", null, null, "Company added manually.");
  return getCompany(id);
}

export function updateCompany(id: number, patch: Record<string, unknown>) {
  const allowed: Record<string, string> = {
    firstName: "first_name",
    email: "email",
    whatsapp: "whatsapp",
    notes: "notes",
  };
  const entries = Object.entries(patch).filter(([key]) => key in allowed);
  if (entries.length) {
    const assignments = entries.map(([key]) => `${allowed[key]} = ?`).join(", ");
    const values = entries.map(([, value]) => (value === "" ? null : value as SQLInputValue));
    leadDb.prepare(`UPDATE companies SET ${assignments} WHERE id = ?`).run(...values, id);
  }
  return getCompany(id);
}

export function updateCompanyStatus(id: number, status: string) {
  const existing = getCompany(id);
  if (!existing) return null;
  if (existing.isDoNotContact && status !== "Do not contact") {
    throw new Error("Do not contact is permanent and cannot be changed.");
  }
  leadDb.prepare("UPDATE companies SET status = ? WHERE id = ?").run(status, id);
  addActivity(id, "status_changed", null, null, `Status changed to ${status}.`);
  return getCompany(id);
}

export function markDoNotContact(id: number) {
  const existing = getCompany(id);
  if (!existing) return null;
  leadDb.prepare("UPDATE companies SET status = 'Do not contact' WHERE id = ?").run(id);
  leadDb
    .prepare("UPDATE outreach SET result = 'do_not_contact', next_followup_at = NULL WHERE company_id = ?")
    .run(id);
  addActivity(id, "marked_do_not_contact", null, null, "Do not contact set permanently.");
  return getCompany(id);
}

export function addActivity(
  companyId: number,
  action: string,
  channel: string | null,
  sequenceNo: number | null,
  note: string,
) {
  leadDb
    .prepare(
      "INSERT INTO activity (company_id, timestamp, action, channel, sequence_no, note) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(companyId, nowIso(), action, channel, sequenceNo, note);
}

export function listActivity(filters: {
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
    conditions.push("LOWER(c.name) LIKE ?");
    values.push(`%${filters.search.trim().toLowerCase()}%`);
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
  return leadDb
    .prepare(
      `SELECT a.id, a.company_id AS companyId, c.name AS companyName, a.timestamp,
        a.action, a.channel, a.sequence_no AS sequenceNo, a.note
       FROM activity a JOIN companies c ON c.id = a.company_id
       ${where} ORDER BY a.timestamp DESC LIMIT ?`,
    )
    .all(...values, limit);
}

export function listFollowups() {
  return leadDb
    .prepare(
      `SELECT o.company_id AS companyId, c.name AS companyName, c.area,
        o.sequence_no AS sequenceNo, o.channel, o.next_followup_at AS dueAt,
        c.status
       FROM outreach o JOIN companies c ON c.id = o.company_id
       WHERE o.next_followup_at IS NOT NULL AND o.result IS NULL
         AND c.status <> 'Do not contact'
         AND o.next_followup_at <= ?
       ORDER BY o.next_followup_at ASC`,
    )
    .all(nowIso());
}

function malaysiaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function countSentToday(channel: "email" | "whatsapp") {
  return Number(
    (
      leadDb
        .prepare(
          `SELECT COUNT(*) AS count FROM outreach
           WHERE channel = ? AND sent_at IS NOT NULL
             AND strftime('%Y-%m-%d', sent_at, '+8 hours') = ?`,
        )
        .get(channel, malaysiaDate()) as { count: number }
    ).count,
  );
}

export function getDashboard() {
  const settings = getSettings();
  const count = (sql: string, ...args: SQLInputValue[]) =>
    Number((leadDb.prepare(sql).get(...args) as { count: number }).count);
  const totalCompanies = count("SELECT COUNT(*) AS count FROM companies");
  const contacted = count("SELECT COUNT(DISTINCT company_id) AS count FROM outreach WHERE sent_at IS NOT NULL");
  const replies = count("SELECT COUNT(DISTINCT company_id) AS count FROM outreach WHERE replied_at IS NOT NULL");
  const sentWhatsApp = count("SELECT COUNT(*) AS count FROM outreach WHERE channel = 'whatsapp' AND sent_at IS NOT NULL");
  const statusCount = (status: string) => count("SELECT COUNT(*) AS count FROM companies WHERE status = ?", status);
  const byStatus = leadDb
    .prepare("SELECT status, COUNT(*) AS count FROM companies GROUP BY status ORDER BY count DESC")
    .all();
  const bySequence = leadDb
    .prepare(
      "SELECT sequence_no AS sequenceNo, COUNT(*) AS count FROM outreach WHERE channel = 'email' AND sent_at IS NOT NULL GROUP BY sequence_no ORDER BY sequence_no",
    )
    .all();
  const placesSearchCount = count(
    "SELECT COALESCE(SUM(api_calls), 0) AS count FROM searches WHERE substr(ran_at, 1, 7) = ?",
    malaysiaDate().slice(0, 7),
  );
  return {
    totals: {
      companies: totalCompanies,
      contacted,
      replies,
      replyRate: contacted ? Math.round((replies / contacted) * 1000) / 10 : 0,
      wantsHero: statusCount("Wants hero"),
      heroSent: statusCount("Hero sent"),
      won: statusCount("Won"),
      whatsappSent: sentWhatsApp,
    },
    sentToday: { email: countSentToday("email"), whatsapp: countSentToday("whatsapp") },
    limits: {
      email: Number(settings.emailDailyLimit),
      whatsapp: Number(settings.whatsappDailyLimit),
    },
    byStatus,
    bySequence,
    placesSearchCount,
    aiCallsToday: 0,
  };
}

export function generateDraft(id: number) {
  const company = getCompany(id);
  if (!company) return { error: "Company not found." } as const;
  if (company.isDoNotContact) return { error: "This company is marked Do not contact." } as const;
  if (!company.findingType || company.reasons.length === 0) {
    return { error: "Need a real finding first." } as const;
  }
  const settings = getSettings();
  if (!settings.myWhatsapp) {
    return { error: "Add your WhatsApp number in Settings before generating a draft." } as const;
  }
  const leadFinding = company.reasons[0]!;
  let finding: string;
  switch (company.findingType) {
    case "no_contact_button":
      finding = "I couldn't find a WhatsApp or call button.";
      break;
    case "slow_mobile": {
      const time = leadFinding.match(/about ([\d.]+) seconds/i)?.[1];
      finding = time
        ? `The homepage takes about ${time} seconds to load.`
        : "The homepage takes longer to load on mobile.";
      break;
    }
    case "not_secure":
      finding = "The browser shows the site as not secure.";
      break;
    case "site_down":
      finding = "The site didn't open when I tried it.";
      break;
    case "outdated": {
      const year = leadFinding.match(/\b(19|20)\d{2}\b/)?.[0];
      finding = year
        ? `The site looks like it hasn't been updated since around ${year}.`
        : "The site looks like it hasn't been updated recently.";
      break;
    }
    case "no_website":
      finding = "I couldn't find a website for it, only a social page.";
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
  const emailBody = `${greeting}

I found ${company.name} on Google Maps and had a look at your website on my phone. ${finding} That might be costing you some enquiries.

I'm ${settings.myName}, a web designer. I build custom websites that make it easier for visitors to call, WhatsApp or book, so more of them turn into enquiries.

I'd like to send you a free concept of how the top of your homepage could look. No strings. Want me to send it over?

My work: ${settings.portfolioUrl}

If you're not interested, just tell me and I won't message again.

${settings.myName}
${settings.myTitle}
WhatsApp: ${settings.myWhatsapp}`;
  const whatsappBody = `Hi ${company.firstName.trim() || "there"}, this is ${settings.myName}, a web designer. I checked ${company.name}'s website on my phone: ${finding} Can I send you a free concept of a better homepage top section? No strings. My work: ${settings.portfolioUrl}`;
  addActivity(id, "generated", null, null, "Generated an email and WhatsApp draft.");
  return {
    subject,
    emailBody,
    whatsappBody,
    finding,
    canOpenWhatsapp: Boolean(company.whatsapp),
  };
}

export function logCopiedMessage(id: number, channel: "email" | "whatsapp") {
  const company = getCompany(id);
  if (!company) return null;
  if (company.isDoNotContact) throw new Error("Do not contact is permanent.");
  addActivity(
    id,
    channel === "email" ? "copied_email" : "copied_whatsapp",
    channel,
    null,
    `Copied ${channel} draft.`,
  );
  if (company.status === "New") {
    leadDb.prepare("UPDATE companies SET status = 'Claimed' WHERE id = ?").run(id);
  }
  return { ok: true };
}

export function markMessageSent(
  id: number,
  input: { channel: "email" | "whatsapp"; sequenceNo: number; subject?: string; body: string },
) {
  const company = getCompany(id);
  if (!company) return { error: "Company not found." } as const;
  if (company.isDoNotContact) return { error: "Do not contact is permanent." } as const;
  const settings = getSettings();
  const sentToday = countSentToday(input.channel);
  const dailyLimit = Number(
    input.channel === "email" ? settings.emailDailyLimit : settings.whatsappDailyLimit,
  );
  if (sentToday >= dailyLimit) {
    return { error: `Daily ${input.channel} limit reached (${dailyLimit}).` } as const;
  }
  if (input.channel === "email") {
    if (company.emailCount >= 3) return { error: "Maximum 3 emails per company reached." } as const;
    if (input.sequenceNo !== company.emailCount + 1) {
      return { error: `The next email sequence for this company is #${company.emailCount + 1}.` } as const;
    }
  }
  const now = nowIso();
  if (input.channel === "email" && input.sequenceNo > 1) {
    leadDb
      .prepare(
        `UPDATE outreach SET result = 'followed_up', next_followup_at = NULL
         WHERE company_id = ? AND channel = 'email' AND sequence_no = ? AND result IS NULL`,
      )
      .run(id, input.sequenceNo - 1);
  }
  let nextFollowupAt: string | null = null;
  if (input.channel === "email" && input.sequenceNo < 3) {
    const firstSent = leadDb
      .prepare(
        "SELECT sent_at AS sentAt FROM outreach WHERE company_id = ? AND channel = 'email' AND sequence_no = 1 AND sent_at IS NOT NULL",
      )
      .get(id) as { sentAt: string } | undefined;
    const anchor = firstSent ? new Date(firstSent.sentAt) : new Date(now);
    const days = input.sequenceNo === 1 ? Number(settings.followup1Days) : Number(settings.followup2Days);
    anchor.setUTCDate(anchor.getUTCDate() + days);
    nextFollowupAt = anchor.toISOString();
  }
  leadDb
    .prepare(
      `INSERT INTO outreach (company_id, channel, sequence_no, subject, body, sent_at, next_followup_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.channel, input.sequenceNo, input.subject ?? null, input.body, now, nextFollowupAt);
  const nextStatus =
    input.channel === "email"
      ? input.sequenceNo >= 3
        ? "Closed: no reply"
        : `Sent #${input.sequenceNo}`
      : company.status === "New" || company.status === "Claimed"
        ? "Sent #1"
        : company.status;
  leadDb.prepare("UPDATE companies SET status = ? WHERE id = ?").run(nextStatus, id);
  addActivity(
    id,
    "marked_sent",
    input.channel,
    input.sequenceNo,
    `Manually marked ${input.channel} #${input.sequenceNo} as sent.`,
  );
  return getCompany(id);
}

export function logReply(id: number, note: string) {
  const company = getCompany(id);
  if (!company) return null;
  const now = nowIso();
  const latest = leadDb
    .prepare(
      "SELECT id FROM outreach WHERE company_id = ? AND sent_at IS NOT NULL ORDER BY sent_at DESC LIMIT 1",
    )
    .get(id) as { id: number } | undefined;
  if (latest) {
    leadDb
      .prepare("UPDATE outreach SET replied_at = ?, result = 'replied', next_followup_at = NULL WHERE id = ?")
      .run(now, latest.id);
  }
  leadDb
    .prepare(
      "UPDATE outreach SET result = COALESCE(result, 'replied'), next_followup_at = NULL WHERE company_id = ? AND next_followup_at IS NOT NULL",
    )
    .run(id);
  leadDb.prepare("UPDATE companies SET status = 'Replied' WHERE id = ?").run(id);
  addActivity(id, "reply_logged", null, null, note);
  return getCompany(id);
}
