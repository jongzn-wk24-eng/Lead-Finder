import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.dirname(fileURLToPath(import.meta.url));
const temp = mkdtempSync(path.join(tmpdir(), "lead-phase3-"));
const require = createRequire(new URL("../../lib/db/package.json", import.meta.url));
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const schema = `lead_test_${Date.now()}`;
try {
  await pool.query(`CREATE SCHEMA ${schema}`);
  for (const table of ["companies","checks","activity","outreach","searches","settings","app_meta","osm_area_cache","research_jobs","ai_api_usage"]) {
    await pool.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
    if (["companies","checks","activity","outreach","searches"].includes(table)) {
      await pool.query(`CREATE SEQUENCE ${schema}.${table}_id_seq; ALTER TABLE ${schema}.${table} ALTER COLUMN id SET DEFAULT nextval('${schema}.${table}_id_seq')`);
    }
  }
  const output = path.join(temp, "tests.mjs");
  await build({
    entryPoints: [path.join(root, "tests/phase3.test.ts")],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    banner: { js: `import {createRequire as testCreateRequire} from "node:module"; const require=testCreateRequire(${JSON.stringify(path.join(root, "package.json"))});` },
    logLevel: "warning",
  });
  const result = spawnSync(process.execPath, ["--test", output], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      PATH: process.env.PATH,
      NODE_ENV: "test",
      LEAD_TEST_SCHEMA: schema,
      GOOGLE_API_KEY: "test-only-placeholder",
      GEMINI_API_KEY: "",
    },
  });
  process.exitCode = result.status ?? 1;
} finally {
  await pool.query(`DROP SCHEMA ${schema} CASCADE`);
  await pool.end();
  rmSync(temp, { recursive: true, force: true });
}
