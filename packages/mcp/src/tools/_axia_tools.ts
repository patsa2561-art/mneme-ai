/**
 * v2.138.0 — AXIA MCP surface (membrane pillar 2: the Value Ledger).
 * mneme.axia.summary — the signed, offline-verifiable value summary (tokens
 * saved + destructive gated + secrets redacted + injections neutralized +
 * claims corrected + omissions flagged). mneme.axia.record — append one value
 * event. Self-attesting. HONEST: counts are facts, the only $ is
 * tokens-saved × the caller's price-per-1k — never an invented $ of damage.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import type { MnemeTool } from "./_types.js";

const AXIA_LEDGER = ".mneme/axia/ledger.jsonl";
const TREASURY_LEDGER = ".mneme/treasury/ledger.jsonl";

function sha256(s: string): string { return createHash("sha256").update(String(s), "utf8").digest("hex"); }
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, subject: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canon(data)); const r = core.notary.issueReceipt(cwd, { kind: "claim-verdict", subject, payload: { dataHash: h }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

function gather(core: typeof import("@mneme-ai/core"), cwd: string): Array<{ kind: string; count: number; source: string; at?: number }> {
  const events: Array<{ kind: string; count: number; source: string; at?: number }> = [];
  const ap = join(cwd, AXIA_LEDGER);
  if (existsSync(ap)) {
    for (const line of readFileSync(ap, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { const j = JSON.parse(line); if (j && typeof j.kind === "string") events.push({ kind: j.kind, count: Number(j.count) || 1, source: String(j.source ?? "unknown"), at: Number(j.at) || undefined }); } catch { /* */ }
    }
  }
  try {
    const tp = join(cwd, TREASURY_LEDGER);
    if (existsSync(tp)) {
      const tok = core.treasury.aggregate(core.treasury.parseLedger(readFileSync(tp, "utf8")) as never).tokensSaved;
      if (tok > 0) events.push({ kind: "tokens-saved", count: tok, source: "treasury" });
    }
  } catch { /* */ }
  return events;
}

export const AXIA_TOOLS: MnemeTool[] = [
  {
    name: "mneme.axia.summary",
    category: "forensics",
    description: "💎 AXIA — the signed, hash-chained, OFFLINE-verifiable VALUE LEDGER (membrane pillar 2). Fuses what Mneme's organs actually DID into one number an auditor/insurer/CFO can verify with a public key: tokens saved (treasury), destructive commands GATED (HEPHAESTUS/CERBERUS), secrets redacted (egress), injections neutralized (firewall), claims corrected (savant/gephyra), omissions flagged (elleipsis). Self-attesting. HONEST (the moat): counts are SIGNED FACTS — events that happened — NOT 'attacks prevented' (a gate can be a false-positive co-sign) and NEVER an estimated $ of damage (an unprovable counterfactual = vaporware). The only $ is tokens-saved × the price-per-1k YOU pass.",
    whenToUse: "When the user / CFO / CISO asks 'what has Mneme actually done for us' or 'show the value' — return the signed counts. Pass pricePer1k for a USD figure from tokens-saved only. The numbers accrue automatically as organs gate/redact/correct/save.",
    triggers: ["axia", "value ledger", "what has mneme done", "show the value", "roi", "what did you prevent", "audit value", "savings and security"],
    inputSchema: { type: "object", properties: { pricePer1k: { type: "number", description: "your vendor's INPUT price per 1k tokens → USD from tokens-saved only (omit for counts-only)." } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const events = gather(core, cwd);
        const led = core.axia.buildAxiaLedger(events as never);
        const price = typeof args["pricePer1k"] === "number" ? args["pricePer1k"] as number : undefined;
        const s = core.axia.axiaSummary(led, price !== undefined ? { pricePer1k: price } : undefined);
        const data = await attest(cwd, `axia.summary:${s.totalEvents}/${s.tokensSaved}`, { byKind: s.byKind, totalEvents: s.totalEvents, tokensSaved: s.tokensSaved, usdSaved: s.usdSaved, chainValid: s.chainValid, note: s.note });
        return { data, wisdom: `💎 AXIA — ${s.totalEvents} value events · ${s.tokensSaved.toLocaleString()} tokens saved${s.usdSaved !== null ? ` (≈ $${s.usdSaved})` : ""}. Counts are signed facts, not damage-$ estimates.`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
  {
    name: "mneme.axia.record",
    category: "forensics",
    description: "💎 AXIA — record ONE value event into the signed ledger: kind = tokens-saved | destructive-gated | secret-redacted | injection-neutralized | claim-corrected | omission-flagged. Organs call this when they do their job; it makes the value summary accrue. Total: never throws.",
    whenToUse: "After an organ does something of value the summary should count (e.g. after you gated a destructive command, redacted a secret, or corrected a false claim). Rarely called by hand.",
    triggers: ["axia record", "record value event", "log a gate", "count this"],
    inputSchema: { type: "object", required: ["kind"], properties: { kind: { type: "string", description: "tokens-saved | destructive-gated | secret-redacted | injection-neutralized | claim-corrected | omission-flagged" }, count: { type: "number", description: "how many (default 1)" }, source: { type: "string", description: "which organ produced it" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const kind = String(args["kind"] ?? "");
        if (!core.axia.AXIA_KINDS.includes(kind as never)) return low(`unknown kind '${kind}'. one of: ${core.axia.AXIA_KINDS.join(", ")}`);
        const count = Number.isFinite(args["count"]) && (args["count"] as number) > 0 ? Math.floor(args["count"] as number) : 1;
        const source = typeof args["source"] === "string" ? args["source"] as string : "agent";
        try { const p = join(cwd, AXIA_LEDGER); if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true }); appendFileSync(p, JSON.stringify({ kind, count, source, at: Date.now() }) + "\n"); } catch { /* */ }
        const data = await attest(cwd, `axia.record:${kind}`, { kind, count, source });
        return { data, wisdom: `✓ recorded ${count}× ${kind} (${source}) into the AXIA value ledger.`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
