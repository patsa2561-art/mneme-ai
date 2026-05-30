/**
 * `mneme dig` (v2.107.0) — DATA ARCHAEOLOGY. Distill PUBLIC content (that
 * YOU fetched — a file, or an agent's WebFetch) into dense, signed,
 * provenance-tracked facts, deduped + contradiction-gated through the
 * Cognitive Cortex. Plus a robots/rate policy you clear before fetching, so
 * ingest stays legitimate. Mneme never crawls — it makes what you ingest
 * cryptographically accountable. Total: never throws.
 */

import type { Command } from "commander";
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

function writeJson(p: unknown): void { process.stdout.write(JSON.stringify(p, null, 2) + "\n"); }
function writeText(l: string): void { process.stdout.write(l + "\n"); }

interface CoreArch {
  archaeology: {
    ingestSource: (repo: string, src: { url: string; content: string; fetchedAt: number }, at: number, maxFacts?: number) => { facts: Array<{ statement: string; key: string; sourceUrl: string; receipt: unknown }>; contentHash: string; distilled: number };
    verifyProvenance: (f: unknown) => { bound: boolean; sourceUrl: string | null; reason: string };
    parseRobots: (txt: string, ua?: string) => { allow: string[]; disallow: string[]; crawlDelaySec: number | null };
    isPathAllowed: (rules: unknown, path: string) => boolean;
  };
  cortex: { contribute: (repo: string, store: unknown, c: unknown, at: number, opts?: unknown) => { store: unknown; result: { verdict: string } } };
}
async function core(): Promise<CoreArch | null> {
  try { const c = (await import("@mneme-ai/core")) as unknown as CoreArch; if (c.archaeology && c.cortex) return c; } catch { /* */ }
  return null;
}
function provPath(cwd: string): string { return join(cwd, ".mneme", "archaeology", "provenance.jsonl"); }
function cortexPath(cwd: string): string { return join(cwd, ".mneme", "cortex", "store.json"); }

export function registerDigCommands(program: Command): void {
  const d = program
    .command("dig")
    .description("⛏ DATA ARCHAEOLOGY — distill PUBLIC content into dense, SIGNED, provenance-tracked facts (deduped + contradiction-gated via the cortex). Every fact proves where it came from. `dig policy` checks robots before you fetch; `dig ingest` absorbs what you fetched; `dig provenance` proves a fact's source. Mneme never crawls — it makes ingest accountable.");

  d.command("policy <url>")
    .description("Clear a source BEFORE fetching: is this URL path allowed by robots.txt? (pass the fetched robots.txt with --robots-file). Keeps ingest legitimate.")
    .option("--robots-file <f>", "path to the source's robots.txt")
    .option("--agent <ua>", "user-agent", "mneme")
    .option("--json", "JSON output.")
    .action(async (url: string, opts: { robotsFile?: string; agent?: string; json?: boolean }) => {
      const m = await core(); if (!m) { writeText("✗ core unavailable"); process.exitCode = 1; return; }
      let robots = ""; try { if (opts.robotsFile && existsSync(opts.robotsFile)) robots = readFileSync(opts.robotsFile, "utf8"); } catch { /* */ }
      let path = "/"; try { path = new URL(url).pathname; } catch { /* */ }
      const rules = m.archaeology.parseRobots(robots, opts.agent ?? "mneme");
      const allowed = m.archaeology.isPathAllowed(rules, path);
      if (opts.json) { writeJson({ url, path, allowed, crawlDelaySec: rules.crawlDelaySec }); process.exitCode = allowed ? 0 : 1; return; }
      writeText(allowed ? `✓ allowed — ${path}${rules.crawlDelaySec ? ` (respect crawl-delay ${rules.crawlDelaySec}s)` : ""}` : `✗ DISALLOWED by robots.txt — do not fetch ${path}`);
      process.exitCode = allowed ? 0 : 1;
    });

  d.command("ingest")
    .description("Distill fetched content into signed provenance-facts → append to the provenance ledger + contribute each to the cortex (deduped + contradiction-gated).")
    .requiredOption("--url <u>", "the source URL (provenance)")
    .option("--file <f>", "file with the fetched content")
    .option("--content <c>", "inline content (else --file)")
    .option("--max <n>", "max facts to distill", (v) => parseInt(v, 10), 50)
    .option("--json", "JSON output.")
    .action(async (opts: { url: string; file?: string; content?: string; max?: number; json?: boolean }) => {
      const m = await core(); if (!m) { writeText("✗ core unavailable"); process.exitCode = 1; return; }
      const cwd = process.cwd();
      let content = opts.content ?? "";
      if (!content && opts.file) { try { if (existsSync(opts.file)) content = readFileSync(opts.file, "utf8"); } catch { /* */ } }
      if (!content) { writeText("✗ no content (pass --file or --content)"); process.exitCode = 1; return; }
      const ing = m.archaeology.ingestSource(cwd, { url: opts.url, content, fetchedAt: Date.now() }, Date.now(), opts.max ?? 50);
      // append to the signed provenance ledger
      try { const dir = join(cwd, ".mneme", "archaeology"); if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); for (const f of ing.facts) appendFileSync(provPath(cwd), JSON.stringify(f) + "\n"); } catch { /* */ }
      // contribute statements to the cortex
      let store: unknown = { v: 1, entries: [] };
      try { if (existsSync(cortexPath(cwd))) store = JSON.parse(readFileSync(cortexPath(cwd), "utf8")); } catch { /* */ }
      const tally: Record<string, number> = {};
      for (const f of ing.facts) { const o = m.cortex.contribute(cwd, store, { agent: "archaeology", key: f.key, value: `${f.statement}  [src: ${f.sourceUrl}]`, kind: "fact" }, Date.now()); store = o.store; tally[o.result.verdict] = (tally[o.result.verdict] ?? 0) + 1; }
      try { const dir = join(cwd, ".mneme", "cortex"); if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); writeFileSync(cortexPath(cwd), JSON.stringify(store, null, 2)); } catch { /* */ }
      if (opts.json) { writeJson({ url: opts.url, distilled: ing.distilled, contentHash: ing.contentHash, cortex: tally }); return; }
      writeText(`⛏ ingested ${opts.url}`);
      writeText(`  distilled ${ing.distilled} signed fact(s) → provenance ledger + cortex (${Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(", ") || "—"})`);
      for (const f of ing.facts.slice(0, 5)) writeText(`    • ${f.statement.slice(0, 70)}`);
    });

  d.command("provenance <query>")
    .description("Prove where an ingested fact came from: find matching facts in the signed ledger + verify each offline.")
    .option("--json", "JSON output.")
    .action(async (query: string, opts: { json?: boolean }) => {
      const m = await core(); if (!m) { writeText("✗ core unavailable"); process.exitCode = 1; return; }
      const cwd = process.cwd();
      if (!existsSync(provPath(cwd))) { writeText("· no provenance ledger yet — run `mneme dig ingest` first"); return; }
      const q = query.toLowerCase().split(/\W+/).filter((t) => t.length > 1);
      const hits: Array<{ statement: string; sourceUrl: string; verified: boolean }> = [];
      try {
        for (const line of readFileSync(provPath(cwd), "utf8").split("\n")) {
          if (!line.trim()) continue;
          let f: { statement?: string; sourceUrl?: string }; try { f = JSON.parse(line); } catch { continue; }
          const hay = String(f.statement ?? "").toLowerCase();
          if (q.some((t) => hay.includes(t))) hits.push({ statement: String(f.statement), sourceUrl: String(f.sourceUrl), verified: m.archaeology.verifyProvenance(f).bound });
        }
      } catch { /* */ }
      if (opts.json) { writeJson(hits.slice(0, 20)); return; }
      if (hits.length === 0) { writeText("· no ingested fact matches that query"); return; }
      writeText(`PROVENANCE — ${hits.length} fact(s):`);
      for (const h of hits.slice(0, 20)) writeText(`  ${h.verified ? "✓" : "✗"} "${h.statement.slice(0, 60)}"  ← ${h.sourceUrl}`);
    });
}
