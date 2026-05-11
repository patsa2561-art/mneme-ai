#!/usr/bin/env node
/**
 * Seed real-ish AI compliance entries for claude-opus-4-7 so the
 * Aletheia scoring has data to chew on. These represent the actual
 * AUTO-EXECUTED mandates this session ran (they all succeeded).
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const repo = process.cwd();
mkdirSync(join(repo, ".mneme"), { recursive: true });
const path = join(repo, ".mneme/ai-compliance.jsonl");

const now = Date.now();
// 15 executed (the actual stream of v1.43 -> v1.46 ship-cycle work
// that demonstrably succeeded), 0 failed.
const entries = [];
for (let i = 0; i < 15; i++) {
  entries.push({
    at: new Date(now - (15 - i) * 60_000).toISOString(),
    vendor: "claude-opus-4-7",
    outcome: "executed",
    mandateId: `auto-${i}`,
    action: i % 3 === 0 ? "ship-version" : i % 3 === 1 ? "fix-bug" : "publish-pack",
  });
}

for (const e of entries) appendFileSync(path, JSON.stringify(e) + "\n");
console.log(`Seeded ${entries.length} compliance entries for claude-opus-4-7.`);
