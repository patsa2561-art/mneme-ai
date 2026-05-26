/**
 * v2.64.0 — DIFFERENTIAL ARENA: multi-vendor consensus by default.
 *
 * Continues Mneme MCP user-roadmap. v2.60-v2.63 quartet shipped
 * (bodyguard / diplomat / conscience / memory); v2.64 adds the
 * multi-vendor consensus primitive: when one agent (Claude) gets a
 * prompt, it can silently delegate to Mneme `diff_arena.ask` which
 * parallel-calls 2-3 OTHER vendors (GPT, Gemini, etc) → returns the
 * diff + Mneme-graded consensus back to Claude's context.
 *
 * User stops paying $50/mo to FIVE AI vendors. Pays $50/mo to Mneme;
 * Mneme blends them.
 *
 * (Distinct from v2.18 ARENA which is the public scoreboard primitive.
 * DIFF_ARENA = differential / consensus angle. Different namespace.)
 *
 * 5 wild innovations:
 *
 *  1. PLUGGABLE ADAPTERS (`adapters.ts`) — mock / http / cli kinds.
 *     Ships mock out of box; users plug real vendors via env keys.
 *     Vendor-agnostic — works with any OpenAI-compatible endpoint OR
 *     any CLI-based vendor (Gemini CLI, Grok CLI, ollama).
 *
 *  2. MULTI-AXIS CONSENSUS (`consensus.ts`) — 4-dimensional pairwise
 *     scoring: Jaccard bigram + numeric agreement + sentiment +
 *     length. Catches the case where two vendors use overlapping
 *     vocabulary but disagree on concrete numbers.
 *
 *  3. PER-VENDOR OUTLIER DIAGNOSIS — mean agreement of each vendor
 *     vs all others; identifies the disagreer (or sole-truth-bearer).
 *
 *  4. COMMON-FACTS / UNIQUE-CLAIMS EXTRACTION — pulls numbers/
 *     versions/dates ALL vendors agree on (trust these) and ones
 *     ONLY ONE vendor mentioned (verify these).
 *
 *  5. HMAC-CHAINED ARENA LEDGER (`.mneme/diff_arena/rounds.jsonl`)
 *     — every ask + per-vendor response recorded; same canonical-JSON
 *     convention as PASSPORT + MIRRAGE + TIME-CRYSTAL.
 *
 * Pure ESM. Defensive — every vendor call wrapped in promise-race
 * timeout + try/catch; ARENA itself never throws.
 */

import { createHmac } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { mockAdapter, httpAdapter, cliAdapter, type VendorAdapter, type VendorResponse } from "./adapters.js";
import { computeConsensus, pairwiseScore, type ConsensusResult } from "./consensus.js";

const KEY_ENV = "MNEME_DIFF_ARENA_KEY";
const DEFAULT_KEY = "mneme-diff-arena-v1";
function keyOf(): string { return process.env[KEY_ENV] ?? DEFAULT_KEY; }

/* ── Types ──────────────────────────────────────────────────────── */

export interface AskInput {
  prompt: string;
  /** Vendor adapters to query in parallel. */
  vendors: VendorAdapter[];
  /** Per-vendor timeout ms (default 30000). */
  timeoutMs?: number;
  /** Optional ACGV grader: given a response, returns refute verdict. */
  acgvGrader?: (text: string) => Promise<AcgvVerdict>;
  /** Working directory for ledger persist. */
  cwd?: string;
  /** Skip ledger append (tests). */
  noLedger?: boolean;
}

export interface AcgvVerdict {
  outcome: "CONFIRMED" | "REFUTED" | "INCONCLUSIVE" | "DISPUTED" | "IMPOSSIBLE";
  evidence?: string;
  confidence?: number;
}

export interface AskResult {
  prompt: string;
  at: string;
  vendorsAsked: string[];
  responses: Array<VendorResponse & { acgv?: AcgvVerdict }>;
  consensus: ConsensusResult;
  /** Composed suggested answer that surfaces common facts + flags disputed claims. */
  suggestedAnswer: string;
  /** Latency stats across the round. */
  latencyMs: number;
  /** HMAC of the canonical body. */
  hmac: string;
}

/* ── Canonical JSON HMAC ────────────────────────────────────────── */

function canonicalJson(o: unknown): string {
  if (o === undefined) return "null";
  if (o === null || typeof o !== "object") return JSON.stringify(o);
  if (Array.isArray(o)) return "[" + o.map((x) => canonicalJson(x === undefined ? null : x)).join(",") + "]";
  const entries = Object.entries(o as Record<string, unknown>).filter(([, v]) => v !== undefined);
  entries.sort(([a], [b]) => a.localeCompare(b));
  return "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + canonicalJson(v)).join(",") + "}";
}

function signHmac(body: unknown): string {
  return createHmac("sha256", keyOf()).update(canonicalJson(body)).digest("hex");
}

/* ── Ledger ─────────────────────────────────────────────────────── */

interface LedgerEntry {
  kind: "ask" | "vendor_response";
  at: string;
  roundId: string;
  who: string;
  detail: string;
  prevHmac: string;
  hmac: string;
}

function ledgerPath(cwd: string): string {
  return join(cwd, ".mneme", "diff_arena", "rounds.jsonl");
}

function lastLedgerHmac(cwd: string): string {
  try {
    const lines = readFileSync(ledgerPath(cwd), "utf8").trim().split(/\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return "";
    return (JSON.parse(lines[lines.length - 1]!) as LedgerEntry).hmac;
  } catch { return ""; }
}

function appendLedger(cwd: string, entry: Omit<LedgerEntry, "hmac" | "prevHmac">): LedgerEntry {
  const prevHmac = lastLedgerHmac(cwd);
  const body: Omit<LedgerEntry, "hmac"> = { ...entry, prevHmac };
  const hmac = createHmac("sha256", keyOf()).update(prevHmac).update(canonicalJson(body)).digest("hex");
  const row: LedgerEntry = { ...body, hmac };
  try {
    mkdirSync(dirname(ledgerPath(cwd)), { recursive: true });
    appendFileSync(ledgerPath(cwd), JSON.stringify(row) + "\n");
  } catch { /* noop */ }
  return row;
}

export function readLedger(cwd: string): LedgerEntry[] {
  try {
    return readFileSync(ledgerPath(cwd), "utf8").trim().split(/\n/).filter((l) => l.trim().length > 0).map((l) => JSON.parse(l) as LedgerEntry);
  } catch { return []; }
}

export function verifyLedgerChain(cwd: string): { ok: boolean; rows: number; brokenAt?: number } {
  const lines = readLedger(cwd);
  let prevHmac = "";
  for (let i = 0; i < lines.length; i++) {
    const row = lines[i]!;
    if (row.prevHmac !== prevHmac) return { ok: false, rows: i, brokenAt: i };
    const { hmac, ...body } = row;
    const expected = createHmac("sha256", keyOf()).update(prevHmac).update(canonicalJson(body)).digest("hex");
    if (expected !== hmac) return { ok: false, rows: i, brokenAt: i };
    prevHmac = hmac;
  }
  return { ok: true, rows: lines.length };
}

/* ── Ask ────────────────────────────────────────────────────────── */

export async function diffArenaAsk(input: AskInput): Promise<AskResult> {
  const cwd = input.cwd ?? process.cwd();
  const at = new Date().toISOString();
  const roundId = createHmac("sha256", keyOf()).update(`${at}|${input.prompt.slice(0, 64)}`).digest("hex").slice(0, 16);
  const t0 = performance.now();
  // Parallel vendor calls. Promise.all is fine because each adapter
  // catches its own errors + returns a structured response.
  const raw = await Promise.all(input.vendors.map((v) => v.ask(input.prompt)));

  // Optional ACGV grading per response.
  const graded: AskResult["responses"] = [];
  for (const r of raw) {
    if (!r.ok || !input.acgvGrader) { graded.push(r); continue; }
    try {
      const acgv = await input.acgvGrader(r.text);
      graded.push({ ...r, acgv });
    } catch {
      graded.push(r);
    }
  }

  // Consensus across SUCCESSFUL responses only.
  const successful = graded.filter((r) => r.ok);
  const consensus = computeConsensus({ responses: successful.map((r) => ({ vendor: r.vendor, text: r.text })) });
  const suggestedAnswer = composeSuggestedAnswer(successful, consensus);
  const latencyMs = +(performance.now() - t0).toFixed(2);

  const bodyForHmac = {
    prompt: input.prompt,
    at,
    vendorsAsked: input.vendors.map((v) => v.name),
    responses: graded,
    consensus,
    suggestedAnswer,
    latencyMs,
  };
  const hmac = signHmac(bodyForHmac);
  if (!input.noLedger) {
    appendLedger(cwd, { kind: "ask", at, roundId, who: input.prompt.slice(0, 80), detail: `vendors=${input.vendors.length}` });
    for (const r of graded) {
      appendLedger(cwd, { kind: "vendor_response", at, roundId, who: r.vendor, detail: r.ok ? "ok" : `fail:${r.reason ?? ""}` });
    }
  }
  return { ...bodyForHmac, hmac };
}

export function verifyAskResult(r: AskResult): boolean {
  if (!r || typeof r.hmac !== "string") return false;
  const { hmac, ...body } = r;
  return signHmac(body) === hmac;
}

function composeSuggestedAnswer(responses: Array<VendorResponse & { acgv?: AcgvVerdict }>, c: ConsensusResult): string {
  if (responses.length === 0) return "(no vendor responded successfully)";
  const lines: string[] = [];
  if (c.agreement === "high") {
    lines.push(`HIGH CONSENSUS (score ${(c.score * 100).toFixed(0)}%) across ${responses.length} vendors.`);
    if (c.commonFacts.length > 0) lines.push(`Agreed numbers/versions: ${c.commonFacts.join(", ")}.`);
  } else if (c.agreement === "medium") {
    lines.push(`MEDIUM consensus (score ${(c.score * 100).toFixed(0)}%) — some divergence.`);
    if (c.commonFacts.length > 0) lines.push(`Vendors agree on: ${c.commonFacts.join(", ")}.`);
    if (c.uniqueClaims.length > 0) lines.push(`Disputed (one-vendor-only): ${c.uniqueClaims.map((u) => `${u.vendor}=${u.claim}`).join("; ")}.`);
  } else {
    lines.push(`LOW consensus (score ${(c.score * 100).toFixed(0)}%) — vendors disagree.`);
    if (c.outliers.length > 0) lines.push(`Most-outlier vendor: ${c.outliers[0]!.vendor} (mean agreement ${(c.outliers[0]!.meanAgreement * 100).toFixed(0)}%).`);
    if (c.commonFacts.length > 0) lines.push(`Only common ground: ${c.commonFacts.join(", ")}.`);
  }
  const refuted = responses.filter((r) => r.acgv?.outcome === "REFUTED");
  if (refuted.length > 0) {
    lines.push(`ACGV REFUTED: ${refuted.map((r) => r.vendor).join(", ")} — disregard their claim${refuted.length > 1 ? "s" : ""}.`);
  }
  return lines.join("\n");
}

/* ── Render ─────────────────────────────────────────────────────── */

export function renderArenaBanner(r: AskResult): string {
  const lines = [
    `🎭 DIFF-ARENA · prompt: "${r.prompt.slice(0, 60)}${r.prompt.length > 60 ? "…" : ""}"`,
    `   ${r.responses.length} vendor(s) · consensus=${r.consensus.agreement} (${(r.consensus.score * 100).toFixed(0)}%) · ${r.latencyMs}ms`,
    "",
  ];
  for (const v of r.responses) {
    const sym = v.ok ? "✓" : "✗";
    const acgvLabel = v.acgv ? ` [ACGV ${v.acgv.outcome}]` : "";
    lines.push(`   ${sym} ${v.vendor.padEnd(16)} ${v.latencyMs}ms${acgvLabel}`);
    if (v.ok) lines.push(`       ${v.text.slice(0, 100)}${v.text.length > 100 ? "…" : ""}`);
    else lines.push(`       reason: ${v.reason ?? "(unknown)"}`);
  }
  if (r.consensus.outliers.length > 0) {
    lines.push("");
    lines.push(`   OUTLIER RANK:`);
    for (const o of r.consensus.outliers.slice(0, 3)) {
      lines.push(`     ${o.vendor.padEnd(16)} outlier=${(o.outlierScore * 100).toFixed(0)}%  mean-agree=${(o.meanAgreement * 100).toFixed(0)}%`);
    }
  }
  if (r.suggestedAnswer) {
    lines.push("");
    lines.push("   SUGGESTED:");
    for (const line of r.suggestedAnswer.split("\n")) lines.push(`     ${line}`);
  }
  return lines.join("\n");
}

/* ── Re-exports ─────────────────────────────────────────────────── */

export { mockAdapter, httpAdapter, cliAdapter } from "./adapters.js";
export type { VendorAdapter, VendorResponse } from "./adapters.js";
export { computeConsensus, pairwiseScore } from "./consensus.js";
export type { ConsensusInput, ConsensusResult, PairwiseScore, VendorOutlier } from "./consensus.js";
