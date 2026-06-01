/**
 * v2.129.0 — SETTLEMENT LEDGER MCP surface. The agent records each context
 * transaction (what was blinded, what changed, local-verify verdict, tokens
 * metered) into a signed, hash-chained, offline-auditable ledger — the honest
 * "Stripe of AI Context" settlement layer. Self-attesting.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(s, "utf8").digest("hex"); }
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, subject: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canon(data)); const r = core.notary.issueReceipt(cwd, { kind: "protocol-hop", subject: `settlement:${subject}`, payload: { dataHash: h }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });
const LEDGER = (cwd: string) => join(cwd, ".mneme", "settlement", "ledger.jsonl");
function loadRecords(cwd: string): unknown[] { try { const p = LEDGER(cwd); if (!existsSync(p)) return []; return readFileSync(p, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } }

export const SETTLEMENT_TOOLS: MnemeTool[] = [
  {
    name: "mneme.settlement.record",
    category: "audit",
    description: "💳 SETTLEMENT LEDGER — append one context transaction to a signed, hash-chained, offline-auditable ledger: what crossed the wire (blinded form's hash + names hidden + secrets removed), what the AI changed (kind), whether it passed a LOCAL verification gate, and the tokens metered (sent vs saved). The honest 'Stripe of AI Context' settlement/audit layer — a CISO + a CFO can both verify it offline. Self-attesting.",
    whenToUse: "After each meaningful AI↔local context exchange (an outline read, a blind, a channel op/commit, a verify) — record it so there's a tamper-evident proof of what was blinded, what changed, that it was locally verified, and the savings. Build the audit + settlement trail as you go.",
    triggers: ["settlement", "context transaction", "audit trail", "record exchange", "stripe of ai context", "metering"],
    inputSchema: { type: "object", required: ["tx"], properties: { tx: { type: "object", description: "{kind:'outline'|'blind'|'channel-op'|'channel-commit'|'verify'|'scaffold'|'egress'|'raw', sentHash?, namesHidden?, secretsRemoved?, localVerified?:'pass'|'fail'|'na', tokensSent?, tokensSaved?, note?}" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core"); const cwd = rt.meta?.rootPath ?? process.cwd();
        const records = loadRecords(cwd) as Array<{ chainHash: string }>;
        const prev = records.length ? records[records.length - 1]!.chainHash : "0".repeat(64);
        const rec = core.settlement.recordTx(prev, args["tx"] as Parameters<typeof core.settlement.recordTx>[1], records.length + 1);
        try { const p = LEDGER(cwd); if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true }); appendFileSync(p, JSON.stringify(rec) + "\n"); } catch { /* */ }
        const data = await attest(cwd, String(rec.tx.seq), { record: rec });
        return { data, wisdom: `💳 tx#${rec.tx.seq} ${rec.tx.kind} recorded (chain ${rec.chainHash.slice(0, 12)}…); sent ~${rec.tx.tokensSent} tok, saved ~${rec.tx.tokensSaved} tok.`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
  {
    name: "mneme.settlement.statement",
    category: "audit",
    description: "💳 The settlement STATEMENT: tokens sent vs saved, % blinded, % locally-verified, and offline chain-integrity over the whole ledger. Pass pricePer1kUSD + feePct (YOUR numbers) for the USD saved + value-based fee. Self-attesting.",
    whenToUse: "When asked 'how much have our agents saved / what crossed the wire / prove our context was protected' — produce the signed statement. USD/fee only from a supplied rate.",
    triggers: ["settlement statement", "how much saved", "context audit", "prove blinded", "context transaction fee"],
    inputSchema: { type: "object", properties: { pricePer1kUSD: { type: "number" }, feePct: { type: "number", description: "fraction of savings, e.g. 0.10" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core"); const cwd = rt.meta?.rootPath ?? process.cwd();
        const st = core.settlement.settlementStatement(loadRecords(cwd) as Parameters<typeof core.settlement.settlementStatement>[0], { pricePer1kUSD: typeof args["pricePer1kUSD"] === "number" ? args["pricePer1kUSD"] as number : undefined, feePct: typeof args["feePct"] === "number" ? args["feePct"] as number : undefined });
        const data = await attest(cwd, "statement", { ...st });
        return { data, wisdom: `💳 ${st.txCount} tx · ~${st.totalTokensSaved} tok saved${typeof st.usdSaved === "number" ? ` ($${st.usdSaved})` : ""} · ${st.pctBlinded}% blinded · ${st.pctLocallyVerified}% locally-verified · chain ${st.integrity.ok ? "intact" : "BROKEN@" + st.integrity.firstBrokenSeq}.`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
