import { sql } from "drizzle-orm";
import { pgTable, serial, text, integer, real, check, index } from "drizzle-orm/pg-core";

export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  place_id: text("place_id").notNull().unique(),
  name: text("name").notNull(),
  address: text("address").notNull().default(sql`''`),
  area: text("area").notNull().default(sql`''`),
  keyword: text("keyword").notNull().default(sql`''`),
  phone: text("phone"),
  website_url: text("website_url"),
  maps_url: text("maps_url"),
  rating: real("rating").notNull().default(sql`0`),
  review_count: integer("review_count").notNull().default(sql`0`),
  price_level: text("price_level"),
  email: text("email"),
  whatsapp: text("whatsapp"),
  first_name: text("first_name").notNull().default(sql`''`),
  status: text("status").notNull().default(sql`'New'`),
  value_score: integer("value_score").notNull().default(sql`0`),
  problem_score: integer("problem_score").notNull().default(sql`0`),
  opportunity_score: integer("opportunity_score").notNull().default(sql`0`),
  reasons_json: text("reasons_json").notNull().default(sql`'[]'`),
  finding_type: text("finding_type"),
  notes: text("notes").notNull().default(sql`''`),
  fetched_at: text("fetched_at").notNull(),
  created_at: text("created_at").notNull(),
  is_sample_data: integer("is_sample_data").notNull().default(sql`0`),
  source: text("source").notNull().default(sql`'manual'`),
  osm_type: text("osm_type"),
  osm_id: text("osm_id"),
  osm_updated_at: text("osm_updated_at"),
  rating_available: integer("rating_available").notNull().default(sql`1`),
  value_score_method: text("value_score_method").notNull().default(sql`'manual'`),
  value_score_base: integer("value_score_base").notNull().default(sql`0`),
  value_score_details_json: text("value_score_details_json").notNull().default(sql`'[]'`),
  osm_opening_hours: text("osm_opening_hours"),
  google_updated_at: text("google_updated_at"),
  ai_model: text("ai_model"),
  ai_generated_at: text("ai_generated_at"),
}, t => [check("company_source", sql`${t.source} IN ('demo', 'google_places', 'manual')`)]);

export const checks = pgTable("checks", {
  id: serial("id").primaryKey(),
  company_id: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  checked_at: text("checked_at").notNull(),
  website_type: text("website_type").notNull(),
  psi_mobile_score: integer("psi_mobile_score"),
  lcp_seconds: real("lcp_seconds"),
  https: integer("https"),
  has_viewport: integer("has_viewport"),
  copyright_year: integer("copyright_year"),
  has_tel_link: integer("has_tel_link"),
  has_whatsapp_link: integer("has_whatsapp_link"),
  has_contact_form: integer("has_contact_form"),
  site_builder: text("site_builder"),
  design_score: integer("design_score"),
  design_reason: text("design_reason"),
  cta_obvious: integer("cta_obvious"),
  retry_count: integer("retry_count").notNull().default(sql`0`),
  check_status: text("check_status").notNull().default(sql`'completed'`),
  last_error: text("last_error"),
  screenshot_desktop_path: text("screenshot_desktop_path"),
  screenshot_mobile_path: text("screenshot_mobile_path"),
  has_contact_page: integer("has_contact_page"),
  design_status: text("design_status").notNull().default(sql`'unavailable'`),
  website_problem_score: integer("website_problem_score").notNull().default(sql`0`),
  ai_model: text("ai_model"),
  ai_generated_at: text("ai_generated_at"),
  is_demo: integer("is_demo").notNull().default(sql`0`),
}, t => [index("checks_company_idx").on(t.company_id)]);

export const activity = pgTable("activity", {
  id: serial("id").primaryKey(),
  company_id: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  timestamp: text("timestamp").notNull(),
  action: text("action").notNull(),
  channel: text("channel"),
  sequence_no: integer("sequence_no"),
  note: text("note").notNull().default(sql`''`),
  is_demo: integer("is_demo").notNull().default(sql`0`),
}, t => [index("activity_company_idx").on(t.company_id)]);

export const outreach = pgTable("outreach", {
  id: serial("id").primaryKey(),
  company_id: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  sequence_no: integer("sequence_no").notNull(),
  subject: text("subject"),
  body: text("body").notNull(),
  sent_at: text("sent_at"),
  replied_at: text("replied_at"),
  result: text("result"),
  next_followup_at: text("next_followup_at"),
  finding_type_at_send: text("finding_type_at_send"),
  is_demo: integer("is_demo").notNull().default(sql`0`),
}, t => [index("outreach_company_idx").on(t.company_id)]);

export const searches = pgTable("searches", {
  id: serial("id").primaryKey(),
  keyword: text("keyword").notNull(),
  area: text("area").notNull(),
  ran_at: text("ran_at").notNull(),
  api_calls: integer("api_calls").notNull().default(sql`0`),
  results_count: integer("results_count").notNull().default(sql`0`),
  provider: text("provider").notNull().default(sql`'openstreetmap'`),
  is_demo: integer("is_demo").notNull().default(sql`0`),
  request_kind: text("request_kind").notNull().default(sql`'search'`),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value_json: text("value_json").notNull(),
});

export const app_meta = pgTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const osm_area_cache = pgTable("osm_area_cache", {
  area_key: text("area_key").primaryKey(),
  area_name: text("area_name").notNull(),
  south: real("south").notNull(),
  west: real("west").notNull(),
  north: real("north").notNull(),
  east: real("east").notNull(),
  fetched_at: text("fetched_at").notNull(),
});

export const research_jobs = pgTable("research_jobs", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  phase: text("phase").notNull(),
  total: integer("total").notNull().default(sql`0`),
  completed: integer("completed").notNull().default(sql`0`),
  requests_estimated: integer("requests_estimated").notNull().default(sql`0`),
  requests_made: integer("requests_made").notNull().default(sql`0`),
  new_companies: integer("new_companies").notNull().default(sql`0`),
  updated_companies: integer("updated_companies").notNull().default(sql`0`),
  skipped_companies: integer("skipped_companies").notNull().default(sql`0`),
  checks_failed: integer("checks_failed").notNull().default(sql`0`),
  current_label: text("current_label"),
  error: text("error"),
  cancel_requested: integer("cancel_requested").notNull().default(sql`0`),
  input_json: text("input_json").notNull().default(sql`'{}'`),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
  is_demo: integer("is_demo").notNull().default(sql`0`),
});

export const ai_api_usage = pgTable("ai_api_usage", {
  requested_at: text("requested_at").notNull(),
  is_demo: integer("is_demo").notNull().default(sql`0`),
});

