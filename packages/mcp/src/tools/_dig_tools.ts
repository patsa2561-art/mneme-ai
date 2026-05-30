/**
 * v2.107.0 — DATA ARCHAEOLOGY MCP surface. An AI agent fetches PUBLIC
 * content (its WebFetch) and hands it here; Mneme distills it into dense,
 * SIGNED, provenance-tracked facts and files them in the cortex (deduped +
 * contradiction-gated). `policy` lets the agent clear robots BEFORE fetching.
 * Mneme never crawls — it makes what the agent ingests cryptographically
 * accountable. Self-attesting; total.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(s, "utf8").digest("hex"); }
function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const k = Object.keys(v as Record<string, unknown>).sort();
  return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}";
}
async function attest(cwd: string, subject: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canon(data)); const r = core.notary.issueReceipt(cwd, { kind: "reasoning-trace", subject: `dig-mcp:${subject}:${h.slice(0, 16)}`, payload: { dataHash: h, tool: subject }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const DIG_TOOLS: MnemeTool[] = [
  {
    name: "mneme.dig.policy",
    category: "memory",
    description: "⛏ DATA ARCHAEOLOGY — clear a URL BEFORE you fetch it: pass the source's robots.txt and the URL; returns whether the path is allowed + any crawl-delay. Keeps your ingestion legitimate (no aggressive scraping, no disallowed paths). Total.",
    whenToUse: "Before fetching a public page to ingest — check robots first; respect the crawl-delay.",
    triggers: ["dig policy", "is this url allowed", "check robots before fetch"],
    inputSchema: { type: "object", required: ["url"], properties: { url: { type: "string" }, robots: { type: "string", description: "the fetched robots.txt content" }, agent: { type: "string", description: "your user-agent" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        let path = "/"; try { path = new URL(String(args["url"] ?? "")).pathname; } catch { /* */ }
        const rules = core.archaeology.parseRobots(String(args["robots"] ?? ""), String(args["agent"] ?? "mneme"));
        const allowed = core.archaeology.isPathAllowed(rules, path);
        return { data: { url: args["url"], path, allowed, crawlDelaySec: rules.crawlDelaySec }, wisdom: allowed ? `✓ allowed (${path})${rules.crawlDelaySec ? ` · crawl-delay ${rules.crawlDelaySec}s` : ""}` : `✗ DISALLOWED by robots — do not fetch ${path}`, followUp: allowed ? ["mneme.dig.ingest"] : [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
  {
    name: "mneme.dig.ingest",
    category: "memory",
    description: "⛏ DATA ARCHAEOLOGY — hand Mneme PUBLIC content you fetched (+ its source URL); it distills the content into dense fact-shaped statements, signs each with verifiable PROVENANCE (source + content-hash + time), and files them into the Cognitive Cortex (deduped + contradiction-gated). Every ingested fact can later be proven back to its source offline. Mneme never crawls — YOU fetch, Mneme makes it accountable. Self-attesting.",
    whenToUse: "After you fetch a public page/dataset worth remembering — ingest it so its facts become signed, source-attributed, shared memory (not an unaccountable blob in your context).",
    triggers: ["dig ingest", "absorb this page", "remember this source", "ingest with provenance"],
    inputSchema: { type: "object", required: ["url", "content"], properties: { url: { type: "string" }, content: { type: "string" }, max: { type: "number", description: "max facts to distill (default 50)" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const ing = core.archaeology.ingestSource(cwd, { url: String(args["url"] ?? ""), content: String(args["content"] ?? ""), fetchedAt: Date.now() }, Date.now(), typeof args["max"] === "number" ? args["max"] as number : 50);
        // signed provenance ledger
        try { const dir = join(cwd, ".mneme", "archaeology"); if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); for (const f of ing.facts) appendFileSync(join(dir, "provenance.jsonl"), JSON.stringify(f) + "\n"); } catch { /* */ }
        // cortex (deduped + gated)
        const cp = join(cwd, ".mneme", "cortex", "store.json");
        let store: unknown = { v: 1, entries: [] };
        try { if (existsSync(cp)) store = JSON.parse(readFileSync(cp, "utf8")); } catch { /* */ }
        const tally: Record<string, number> = {};
        for (const f of ing.facts) { const o = core.cortex.contribute(cwd, store as never, { agent: "archaeology", key: f.key, value: `${f.statement}  [src: ${f.sourceUrl}]`, kind: "fact" }, Date.now()); store = o.store; tally[o.result.verdict] = (tally[o.result.verdict] ?? 0) + 1; }
        try { const dir = join(cwd, ".mneme", "cortex"); if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); writeFileSync(cp, JSON.stringify(store, null, 2)); } catch { /* */ }
        const data = await attest(cwd, "ingest", { url: args["url"], distilled: ing.distilled, contentHash: ing.contentHash, cortex: tally, facts: ing.facts.slice(0, 10).map((f) => f.statement) });
        return { data, wisdom: `⛏ ingested ${ing.distilled} signed fact(s) from ${args["url"]} → cortex (${Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(", ") || "—"})`, followUp: ["mneme.cortex.recall"], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
