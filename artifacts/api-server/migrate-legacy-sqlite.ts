/**
 * Development-only, atomic and repeatable legacy import. Never runs at app startup.
 * The original SQLite file is read-only and retained as a backup.
 */
import { DatabaseSync } from "node:sqlite";
import { pool } from "@workspace/db";
import { existsSync } from "node:fs";
import path from "node:path";

if (process.env.NODE_ENV === "production") throw new Error("Legacy import is development-only.");
const file = process.env.LEAD_DB_PATH || path.join(process.cwd(), "data/lead-finder.sqlite");
if (!existsSync(file)) {
  console.log("No legacy SQLite database to import.");
  await pool.end();
} else {
  const sqlite = new DatabaseSync(file, { readOnly: true });
  const client = await pool.connect();
  const tables = ["companies", "checks", "activity", "outreach", "searches", "settings", "app_meta", "osm_area_cache", "research_jobs", "ai_api_usage"];
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(4170623)");
    const imported = await client.query("SELECT value FROM app_meta WHERE key = 'legacy_sqlite_imported'");
    if (!imported.rows.length) {
      const occupied = await client.query("SELECT COUNT(*)::int AS count FROM companies");
      if (occupied.rows[0].count) throw new Error("PostgreSQL already has leads. Refusing to merge unrelated ID spaces.");
      const demoIds = new Set<number>();
      for (const table of tables) {
        const exists = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
        if (!exists) continue;
        for (const original of sqlite.prepare(`SELECT * FROM ${table}`).all()) {
          const row = { ...original } as Record<string, unknown>;
          if (table === "companies") {
            const demo = Number(row.is_sample_data) === 1 || row.source === "sample" || row.source === "demo" || String(row.place_id).startsWith("sample-kl-");
            if (demo) demoIds.add(Number(row.id));
            row.source = demo ? "demo" : row.source === "google_places" ? "google_places" : "manual";
            row.is_sample_data = demo ? 1 : 0;
            if (row.source === "google_places") {
              Object.assign(row, {name:`Google Place ${String(row.place_id).slice(-6)}`,address:"",phone:null,website_url:null,maps_url:null,rating:0,review_count:0,price_level:null,rating_available:0,value_score:0,value_score_base:0,value_score_details_json:"[]",value_score_method:"Live Google Places estimate (not stored)",opportunity_score:row.problem_score});
            }
          }
          if (["checks","outreach","activity"].includes(table)) row.is_demo = demoIds.has(Number(row.company_id)) ? 1 : 0;
          if (table === "searches") row.is_demo = row.provider === "sample" || row.provider === "demo" ? 1 : 0;
          if (table === "research_jobs" || table === "ai_api_usage") row.is_demo = 0;
          if (table === "settings" && row.key === "demoMode") row.value_json = "false";
          const columns = Object.keys(row);
          await client.query(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map((_, i) => `$${i+1}`).join(",")}) ON CONFLICT DO NOTHING`, Object.values(row));
        }
        if (["companies","checks","activity","outreach","searches"].includes(table)) {
          await client.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(MAX(id),1), MAX(id) IS NOT NULL) FROM ${table}`);
        }
      }
      await client.query("INSERT INTO settings (key,value_json) VALUES ('demoMode','false') ON CONFLICT(key) DO UPDATE SET value_json='false'");
      await client.query("INSERT INTO app_meta (key,value) VALUES ('legacy_sqlite_imported','true')");
      console.log(`Imported legacy records; ${demoIds.size} seeded companies and their child records marked demo.`);
    } else console.log("Legacy SQLite import already completed.");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    sqlite.close();
    await pool.end();
  }
}
