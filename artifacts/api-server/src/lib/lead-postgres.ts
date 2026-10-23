import { AsyncLocalStorage } from "node:async_hooks";
import { pool } from "@workspace/db";

export type SQLInputValue = string | number | bigint | null | Uint8Array;
type Scope = { demo: boolean; all?: boolean; client?: Pick<typeof pool, "query"> };
const context = new AsyncLocalStorage<Scope>();
const scopedTables = ["companies", "outreach", "activity", "checks", "searches", "research_jobs", "ai_api_usage"];
const schema = process.env.NODE_ENV === "test" && /^lead_test_[a-z0-9_]+$/.test(process.env.LEAD_TEST_SCHEMA ?? "")
  ? process.env.LEAD_TEST_SCHEMA! : "public";

export function withDataMode<T>(demo: boolean, work: () => T): T {
  return context.run({ ...context.getStore(), demo, all: false }, work);
}
export function withAllData<T>(work: () => T): T {
  return context.run({ ...context.getStore(), demo: false, all: true }, work);
}
export function inDemoMode() { return context.getStore()?.demo ?? false; }
export async function withTransaction<T>(work: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await context.run({ demo: inDemoMode(), ...context.getStore(), client }, work);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
function connection() { return context.getStore()?.client ?? pool; }

// Preserve the single database boundary while moving every query to async PostgreSQL.
// Read CTEs apply the same isolation to totals, nested subqueries, details and CSVs.
function sqlForPostgres(input: string) {
  let sql = input.replace(/COLLATE NOCASE/g, "")
    .replace(
      /strftime\('%Y-%m-%d',\s*([\w.]+),\s*'\+8 hours'\)/g,
      (_match, column: string) => `to_char(${column}::timestamptz AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD')`,
    )
    .replace(/substr\((\w+),\s*-(\d+)\)/g, "right($1, $2)");
  const ignored = /INSERT OR IGNORE INTO/i.test(sql);
  sql = sql.replace(/INSERT OR IGNORE INTO/gi, "INSERT INTO");
  if (ignored) sql += " ON CONFLICT DO NOTHING";
  const scope = context.getStore() ?? { demo: false };
  const insert = sql.match(/INSERT INTO\s+(companies|outreach|activity|checks|searches|research_jobs|ai_api_usage)\s*\(([^)]+)\)\s*VALUES\s*\(/i);
  if (insert) {
    const [, table, columns] = insert;
    const field = table === "companies" ? "source" : "is_demo";
    if (!columns!.split(",").map(x => x.trim()).includes(field)) {
      sql = sql.replace(insert[0], `INSERT INTO ${table} (${columns}, ${field}) VALUES (${table === "companies" ? `'${scope.demo ? "demo" : "manual"}'` : scope.demo ? "1" : "0"}, `);
      // Put the synthetic column first, matching the synthetic value.
      sql = sql.replace(`(${columns}, ${field})`, `(${field}, ${columns})`);
    }
  }
  if (/^\s*SELECT\b/i.test(sql) && !scope.all) {
    const ctes = scopedTables.map(table => {
      const predicate = table === "companies"
        ? `source ${scope.demo ? "=" : "<>"} 'demo'`
        : `is_demo = ${scope.demo ? 1 : 0}`;
      return `${table} AS (SELECT * FROM ${schema}.${table} WHERE ${predicate})`;
    });
    sql = `WITH ${ctes.join(", ")} ${sql}`;
  }
  let index = 0;
  // All application statements use ? only for bind parameters, never SQL literals.
  sql = sql.replace(/\?/g, () => `$${++index}`);
  if (schema !== "public") {
    sql = sql.replace(/\b(INTO|UPDATE|DELETE FROM)\s+(companies|checks|outreach|activity|searches|settings|app_meta|research_jobs|osm_area_cache|ai_api_usage)\b/gi, `$1 ${schema}.$2`);
    sql = sql.replace(/\b(FROM|JOIN)\s+(settings|app_meta|osm_area_cache)\b/gi, `$1 ${schema}.$2`);
    if (scope.all) sql = sql.replace(/\b(FROM|JOIN)\s+(companies|checks|outreach|activity|searches|research_jobs|ai_api_usage)\b/gi, `$1 ${schema}.$2`);
  }
  return sql;
}

export const leadDb = {
  prepare(input: string) {
    const sql = () => sqlForPostgres(input);
    // Preserve camelCase API aliases without changing SQL alias resolution in ORDER BY.
    const aliases = new Map([...input.matchAll(/\bAS\s+([A-Za-z_]\w*)/gi)]
      .map(match => [match[1]!.toLowerCase(), match[1]!]));
    const apiRow = (row: Record<string, unknown>) => Object.fromEntries(
      Object.entries(row).map(([key, value]) => [aliases.get(key) ?? key, value]),
    );
    return {
      async all(...values: SQLInputValue[]): Promise<Record<string, unknown>[]> {
        return (await connection().query(sql(), values)).rows.map(apiRow);
      },
      async get(...values: SQLInputValue[]): Promise<Record<string, unknown> | undefined> {
        const row = (await connection().query(sql(), values)).rows[0];
        return row ? apiRow(row) : undefined;
      },
      async run(...values: SQLInputValue[]) {
        let text = sql();
        const insert = /^\s*INSERT INTO (?:\w+\.)?(companies|outreach|activity|checks|searches)\b/i.test(text);
        if (insert && !/\bRETURNING\b/i.test(text)) text += " RETURNING id";
        const result = await connection().query(text, values);
        return { changes: result.rowCount ?? 0, lastInsertRowid: result.rows[0]?.id ?? 0 };
      },
    };
  },
};
