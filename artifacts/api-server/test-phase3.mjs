import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const temp = mkdtempSync(path.join(tmpdir(), "lead-phase3-"));
try {
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
      PATH: process.env.PATH,
      NODE_ENV: "production",
      LEAD_DB_PATH: path.join(temp, "test.sqlite"),
      GOOGLE_API_KEY: "test-only-placeholder",
      GEMINI_API_KEY: "",
    },
  });
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(temp, { recursive: true, force: true });
}
