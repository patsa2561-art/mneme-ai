/**
 * `mneme cortex` (v2.104.0) — the Sovereign Memory Bus on the CLI:
 * contribute / recall / handoff into the local shared, signed,
 * drift-guarded memory every agent reads. Persists to
 * .mneme/cortex/store.json. Total: never throws.
 */

import type { Command } from "commander";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

function writeJson(p: unknown): void { process.stdout.write(JSON.stringify(p, null, 2) + "\n"); }
function writeText(l: string): void { process.stdout.write(l + "\n"); }

interface CoreCortex {
  cortex: {
    contribute: (repo: string, store: unknown, c: unknown, at: number, opts?: unknown) => { store: unknown; result: { verdict: string; reason: string; conflictsWith: string | null; entry: { id: string } | null } };
    recall: (store: unknown, q: string, limit?: number) => Array<{ entry: { key: string; value: string; agent: string }; score: number }>;
    handoff: (repo: string, store: unknown, to: string, at: number) => { toAgent: string; facts: unknown[] };
  };
}
async function core(): Promise<CoreCortex | null> {
  try { const c = (await import("@mneme-ai/core")) as unknown as CoreCortex; if (c.cortex) return c; } catch { /* */ }
  return null;
}
function storePath(cwd: string): string { return join(cwd, ".mneme", "cortex", "store.json"); }
function readStore(cwd: string): { v: 1; entries: unknown[] } {
  try { const p = storePath(cwd); if (!existsSync(p)) return { v: 1, entries: [] }; const j = JSON.parse(readFileSync(p, "utf8")); return j && Array.isArray(j.entries) ? j : { v: 1, entries: [] }; } catch { return { v: 1, entries: [] }; }
}
function saveStore(cwd: string, s: unknown): void { try { const d = join(cwd, ".mneme", "cortex"); if (!existsSync(d)) mkdirSync(d, { recursive: true }); writeFileSync(storePath(cwd), JSON.stringify(s, null, 2)); } catch { /* */ } }

export function registerCortexCommands(program: Command): void {
  const c = program
    .command("cortex")
    .description("🧠 COGNITIVE CORTEX — the local, signed, drift-guarded Sovereign Memory Bus every AI agent shares. contribute / recall / handoff. The gatekeeper quarantines conflicts so the shared memory can't be poisoned.");

  c.command("contribute <key> <value>")
    .description("Write a fact to the shared memory (signed). Quarantined if it conflicts with established memory unless --update.")
    .option("--agent <id>", "your agent id", "cli")
    .option("--kind <k>", "fact | decision | context | warning", "fact")
    .option("--update", "declare a supersede of an existing conflicting value")
    .option("--json", "JSON output.")
    .action(async (key: string, value: string, opts: { agent?: string; kind?: string; update?: boolean; json?: boolean }) => {
      const m = await core(); if (!m) { writeText("✗ @mneme-ai/core unavailable."); process.exitCode = 1; return; }
      const cwd = process.cwd();
      const out = m.cortex.contribute(cwd, readStore(cwd), { agent: opts.agent ?? "cli", key, value, kind: opts.kind }, Date.now(), { update: !!opts.update });
      if (out.result.verdict !== "QUARANTINED" && out.result.entry) saveStore(cwd, out.store);
      if (opts.json) { writeJson(out.result); process.exitCode = out.result.verdict === "QUARANTINED" ? 1 : 0; return; }
      const icon = out.result.verdict === "QUARANTINED" ? "⚠" : "✓";
      writeText(`${icon} ${out.result.verdict} — ${out.result.reason}`);
      process.exitCode = out.result.verdict === "QUARANTINED" ? 1 : 0;
    });

  c.command("recall <query>")
    .description("Recall shared memory relevant to a query (signed facts every agent contributed).")
    .option("--limit <n>", "max hits", (v) => parseInt(v, 10), 10)
    .option("--json", "JSON output.")
    .action(async (query: string, opts: { limit?: number; json?: boolean }) => {
      const m = await core(); if (!m) { writeText("✗ @mneme-ai/core unavailable."); process.exitCode = 1; return; }
      const hits = m.cortex.recall(readStore(process.cwd()), query, opts.limit ?? 10);
      if (opts.json) { writeJson(hits.map((h) => ({ key: h.entry.key, value: h.entry.value, agent: h.entry.agent, score: h.score }))); return; }
      if (hits.length === 0) { writeText("· no shared memory matches that query yet"); return; }
      writeText(`CORTEX recall — ${hits.length} fact(s):`);
      for (const h of hits) writeText(`  • ${h.entry.key} = ${h.entry.value}   (by ${h.entry.agent})`);
    });

  c.command("handoff <toAgent>")
    .description("Build a signed context capsule of the live shared memory for a receiving agent.")
    .option("--json", "JSON output.")
    .action(async (toAgent: string, opts: { json?: boolean }) => {
      const m = await core(); if (!m) { writeText("✗ @mneme-ai/core unavailable."); process.exitCode = 1; return; }
      const cap = m.cortex.handoff(process.cwd(), readStore(process.cwd()), toAgent, Date.now());
      if (opts.json) { writeJson(cap); return; }
      writeText(`✓ signed handoff capsule for ${cap.toAgent} — ${cap.facts.length} fact(s)`);
    });
}
