#!/usr/bin/env node
/**
 * Generate the public/demo.json fixture for the Mneme web dashboard
 * by composing the live nervous-system data of Mneme's own repo.
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { MnemeStore, buildNervousSystem } from "../packages/core/dist/public.js";

const repoRoot = resolve(process.cwd());
const dbPath = resolve(repoRoot, ".mneme/mneme.db");
if (!existsSync(dbPath)) {
  console.error(`No indexed db at ${dbPath}. Run 'mneme index' first.`);
  process.exit(1);
}

const store = new MnemeStore(dbPath);
const data = await buildNervousSystem(store, {
  cwd: repoRoot,
  topPeople: 5,
  topFiles: 30,
});

const out = resolve(repoRoot, "packages/web/public/demo.json");
mkdirSync(resolve(out, ".."), { recursive: true });
writeFileSync(out, JSON.stringify(data, null, 2));
console.log(`Wrote ${out}: ${JSON.stringify(data).length} bytes`);
console.log(`Authors: ${data.passports?.length ?? 0}`);
console.log(`Telepathy pairs: ${data.telepathy?.pairs?.length ?? 0}`);
console.log(`Critical files: ${data.criticalFiles?.length ?? 0}`);
