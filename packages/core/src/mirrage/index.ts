/**
 * v2.62.0 — MIRRAGE: live conscience for AI agents via MCP reverse-channel.
 *
 * User-framing roadmap (set v2.60 → continuing): conscience + memory +
 * diplomat + bodyguard + time machine. v2.60=bodyguard (SKELETON KEY),
 * v2.61=diplomat (PASSPORT), v2.62=**conscience** (MIRRAGE).
 *
 * Pre-MIRRAGE pattern: AI agent generates draft → user sees draft →
 * IF user notices factual error → user corrects. Mneme only enters
 * after user complaint. That's reactive.
 *
 * MIRRAGE flips it: BEFORE the agent commits a draft, it calls
 * `mneme.mirrage.scan {draft}`; Mneme returns per-sentence nudges
 * graded by 5-level CONSCIENCE LADDER (hint/suggestion/warning/
 * block/reject) + suggested edit. The agent reads the nudges back
 * into its own context and self-corrects BEFORE shipping to user.
 *
 * The "reverse channel" angle: MCP is normally pull (agent asks
 * tool). MIRRAGE = push (Mneme injects warnings into agent's
 * reflection step). One of the few legitimate uses of the MCP
 * sampling primitive — agent's own model reads Mneme's verdict
 * inline.
 *
 * 5 wild innovations:
 *
 *  1. CONSCIENCE LADDER (`conscience_ladder.ts`) — 5 escalation
 *     tiers (hint/suggestion/warning/block/reject) by risk score.
 *     Blocking tiers refuse to ship until agent retracts.
 *
 *  2. NUDGE-FATIGUE GATING — if the same agent received N similar
 *     nudges in the last 60min, downgrade priority. Avoid spam.
 *
 *  3. CROSS-AGENT WISDOM SHARING — when an agent ACK's a nudge,
 *     the lesson becomes a candidate broadcast for other agents
 *     in the project. Wisdom propagates.
 *
 *  4. STREAMING PARTIAL SCAN — accept cursor position; only scan
 *     sentences that ENDED before cursor (in-progress sentence
 *     skipped). Lets agents call scan continuously while writing.
 *
 *  5. HMAC-CHAINED NUDGE LEDGER — every scan + ack chains HMACs.
 *     Tamper-evident; court-admissible record of what the agent
 *     was warned about + when.
 */

import { createHash, createHmac } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { splitSentences, type Sentence } from "./sentence_splitter.js";
import { extractFeatures, riskFromFeatures, type SentenceFeatures } from "./heuristics.js";
import { LEVELS, anyBlocks, levelForRisk, type NudgeLevel } from "./conscience_ladder.js";

const KEY_ENV = "MNEME_MIRRAGE_KEY";
const DEFAULT_KEY = "mneme-mirrage-v1";
function keyOf(): string { return process.env[KEY_ENV] ?? DEFAULT_KEY; }

/* ── Types ──────────────────────────────────────────────────────── */

export interface Nudge {
  id: string;
  /** The sentence the nudge applies to. */
  sentence: string;
  /** Character offset in the original draft. */
  offset: number;
  /** Conscience-ladder level. */
  level: NudgeLevel;
  /** Symbol prefix (emoji). */
  symbol: string;
  /** Combined 0..1 risk score. */
  risk: number;
  /** Plain-English drivers (what made this risky). */
  drivers: string[];
  /** Suggested retracted sentence (heuristic — agent decides). */
  suggested?: string;
  /** When true, ship is blocked until agent ACK's or retracts. */
  blocksShip: boolean;
  /** Feature signals for transparency. */
  features: SentenceFeatures;
  /** HMAC signature of this nudge body for tamper-evidence. */
  hmac: string;
}

export interface ScanResult {
  scanId: string;
  at: string;
  agent: string;
  draftLength: number;
  sentenceCount: number;
  nudges: Nudge[];
  /** Sentences with nudges removed/retracted (suggested edit). */
  suggestedEdit: string;
  /** Overall: does ANY block ship? */
  blocksShip: boolean;
  /** Latency ms. */
  totalLatencyMs: number;
  /** HMAC of the canonical body. */
  hmac: string;
}

export interface ScanInput {
  /** Draft text to scan. */
  draft: string;
  /** Agent identifier (for fatigue + cross-agent wisdom tracking). */
  agent: string;
  /** Working directory for ledger persistence. */
  cwd?: string;
  /** Optional cursor position for streaming partial scan. Only sentences ending before cursor are scanned. */
  cursorPos?: number;
  /** Skip nudge-fatigue gating (used by deterministic tests). */
  noFatigueGate?: boolean;
  /** Skip ledger append (used by tests). */
  noLedger?: boolean;
  /** Risk threshold below which sentences emit no nudge (default 0.30). */
  minRisk?: number;
}

/* ── Canonical JSON HMAC (same convention as PASSPORT) ──────────── */

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
  kind: "scan" | "ack" | "broadcast";
  at: string;
  scanId: string;
  agent: string;
  nudgeId?: string;
  level?: NudgeLevel;
  prevHmac: string;
  hmac: string;
}

function ledgerPath(cwd: string): string {
  return join(cwd, ".mneme", "mirrage", "ledger.jsonl");
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

/* ── Nudge-fatigue gating ───────────────────────────────────────── */

function fatiguePath(cwd: string): string {
  return join(cwd, ".mneme", "mirrage", "fatigue.json");
}

interface FatigueRecord {
  /** key = agent|fingerprint → recent ack count + last-seen ISO timestamp. */
  records: Record<string, { count: number; lastSeen: string }>;
}

function readFatigue(cwd: string): FatigueRecord {
  try { return JSON.parse(readFileSync(fatiguePath(cwd), "utf8")) as FatigueRecord; } catch { return { records: {} }; }
}

function writeFatigue(cwd: string, f: FatigueRecord): void {
  try {
    mkdirSync(dirname(fatiguePath(cwd)), { recursive: true });
    writeFileSync(fatiguePath(cwd), JSON.stringify(f, null, 2));
  } catch { /* noop */ }
}

function sentenceFingerprint(sentence: string): string {
  // Normalise whitespace + lowercase + hash.
  const norm = sentence.replace(/\s+/g, " ").trim().toLowerCase();
  return createHash("sha256").update(norm).digest("hex").slice(0, 16);
}

/**
 * Downgrade priority if the agent recently ACK'd N similar nudges.
 * Returns a 0..1 multiplier on risk (1.0 = no fatigue; 0.6 = downgraded).
 */
function fatigueMultiplier(cwd: string, agent: string, fingerprint: string): number {
  const f = readFatigue(cwd);
  const key = `${agent}|${fingerprint}`;
  const rec = f.records[key];
  if (!rec) return 1.0;
  const hoursSince = (Date.now() - new Date(rec.lastSeen).getTime()) / (60 * 60 * 1000);
  if (hoursSince > 1) return 1.0; // fatigue resets after 1 hour
  // After 3 ACKs in 1 hour → downgrade 40%.
  return Math.max(0.6, 1.0 - rec.count * 0.13);
}

/* ── Cross-agent wisdom broadcast ───────────────────────────────── */

function wisdomPath(cwd: string): string {
  return join(cwd, ".mneme", "mirrage", "wisdom_broadcasts.jsonl");
}

export function broadcastWisdom(cwd: string, lesson: { sourceAgent: string; sentence: string; level: NudgeLevel; reason: string }): void {
  try {
    mkdirSync(dirname(wisdomPath(cwd)), { recursive: true });
    appendFileSync(wisdomPath(cwd), JSON.stringify({ ...lesson, at: new Date().toISOString() }) + "\n");
  } catch { /* noop */ }
}

export function readWisdom(cwd: string): Array<{ sourceAgent: string; sentence: string; level: NudgeLevel; reason: string; at: string }> {
  try {
    return readFileSync(wisdomPath(cwd), "utf8").trim().split(/\n/).filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
  } catch { return []; }
}

/* ── Scan ───────────────────────────────────────────────────────── */

function suggestedReplacement(sentence: string, features: SentenceFeatures): string | undefined {
  // Simple hedging: if absolutes were the driver, hedge them.
  let s = sentence;
  if (features.absolutes > 0) {
    s = s.replace(/\balways\b/gi, "often")
         .replace(/\bnever\b/gi, "rarely")
         .replace(/\ball\b/gi, "many")
         .replace(/\bevery\b/gi, "many")
         .replace(/\bdefinitely\b/gi, "likely")
         .replace(/\bcertainly\b/gi, "likely")
         .replace(/\babsolutely\b/gi, "likely")
         .replace(/\bguaranteed\b/gi, "likely")
         .replace(/\bcannot\b/gi, "may not")
         .replace(/\bmust\b/gi, "should");
    if (s !== sentence) return s;
  }
  // If entity-driven, the agent should verify — we don't auto-rewrite entities.
  return undefined;
}

export function scanDraft(input: ScanInput): ScanResult {
  const at = new Date().toISOString();
  const cwd = input.cwd ?? process.cwd();
  const minRisk = input.minRisk ?? 0.30;
  const t0 = performance.now();
  const draft = typeof input.draft === "string" ? input.draft : "";
  const all = splitSentences(draft);
  // Streaming filter: only sentences ending strictly before cursor.
  const sentences = typeof input.cursorPos === "number"
    ? all.filter((s: Sentence) => s.end <= input.cursorPos!)
    : all;
  const nudges: Nudge[] = [];
  for (const sent of sentences) {
    const features = extractFeatures(sent.text);
    const { risk: rawRisk, drivers } = riskFromFeatures(features);
    const fp = sentenceFingerprint(sent.text);
    const mul = input.noFatigueGate ? 1.0 : fatigueMultiplier(cwd, input.agent, fp);
    const risk = Math.max(0, Math.min(1, rawRisk * mul));
    const level = levelForRisk(risk);
    if (!level || risk < minRisk) continue;
    const suggested = suggestedReplacement(sent.text, features);
    const meta = LEVELS[level];
    const nudgeBody = {
      sentence: sent.text,
      offset: sent.start,
      level, symbol: meta.symbol, risk: +risk.toFixed(4),
      drivers, suggested, blocksShip: meta.blocksShip, features,
    };
    nudges.push({
      ...nudgeBody,
      id: createHash("sha256").update(`${at}|${sent.start}|${sent.text}`).digest("hex").slice(0, 16),
      hmac: signHmac(nudgeBody),
    });
  }
  // Compose suggested edit: replace nudge sentences with suggested form or drop.
  let suggestedEdit = draft;
  for (const n of nudges.slice().sort((a, b) => b.offset - a.offset)) {
    const end = n.offset + n.sentence.length;
    const replacement = n.suggested ?? `[retracted: ${n.symbol} ${n.level}]`;
    suggestedEdit = suggestedEdit.slice(0, n.offset) + replacement + suggestedEdit.slice(end);
  }
  const scanId = createHash("sha256").update(`${at}|${input.agent}|${draft.slice(0, 64)}`).digest("hex").slice(0, 16);
  const totalLatencyMs = +(performance.now() - t0).toFixed(2);
  const blocksShip = anyBlocks(nudges.map((n) => n.level));
  const bodyForHmac = { scanId, at, agent: input.agent, draftLength: draft.length, sentenceCount: sentences.length, nudges, suggestedEdit, blocksShip, totalLatencyMs };
  const hmac = signHmac(bodyForHmac);
  if (!input.noLedger) appendLedger(cwd, { kind: "scan", at, scanId, agent: input.agent });
  return { ...bodyForHmac, hmac };
}

export function verifyScanResult(r: ScanResult): boolean {
  if (!r || typeof r.hmac !== "string") return false;
  const { hmac, ...body } = r;
  return signHmac(body) === hmac;
}

/* ── Acknowledge + broadcast ────────────────────────────────────── */

export interface AcknowledgeInput {
  scanId: string;
  nudgeId: string;
  agent: string;
  /** When true, append to cross-agent wisdom feed. */
  broadcast?: boolean;
  /** The fingerprint hash so fatigue gating can find it. */
  fingerprint?: string;
  /** Sentence and level captured for wisdom row. */
  sentence?: string;
  level?: NudgeLevel;
  reason?: string;
  cwd?: string;
}

export interface AcknowledgeResult {
  ok: boolean;
  hint: string;
  broadcast: boolean;
}

export function acknowledgeNudge(input: AcknowledgeInput): AcknowledgeResult {
  const cwd = input.cwd ?? process.cwd();
  // Bump fatigue counter for this (agent, fingerprint) so future scans downgrade.
  if (input.fingerprint) {
    const f = readFatigue(cwd);
    const key = `${input.agent}|${input.fingerprint}`;
    const rec = f.records[key];
    f.records[key] = { count: (rec?.count ?? 0) + 1, lastSeen: new Date().toISOString() };
    writeFatigue(cwd, f);
  }
  // Append ledger row.
  appendLedger(cwd, { kind: "ack", at: new Date().toISOString(), scanId: input.scanId, agent: input.agent, nudgeId: input.nudgeId, level: input.level });
  // Broadcast wisdom if requested.
  let broadcast = false;
  if (input.broadcast && input.sentence && input.level && input.reason) {
    broadcastWisdom(cwd, { sourceAgent: input.agent, sentence: input.sentence, level: input.level, reason: input.reason });
    appendLedger(cwd, { kind: "broadcast", at: new Date().toISOString(), scanId: input.scanId, agent: input.agent, nudgeId: input.nudgeId, level: input.level });
    broadcast = true;
  }
  return { ok: true, hint: broadcast ? "acked + wisdom broadcast" : "acked", broadcast };
}

/* ── Render ─────────────────────────────────────────────────────── */

export function renderBanner(r: ScanResult): string {
  const lines = [
    `🪞 MIRRAGE · ${r.nudges.length} nudge(s) on ${r.sentenceCount} sentence(s) — ${r.totalLatencyMs}ms`,
    r.blocksShip ? "   🛑 SHIP BLOCKED until retract" : "   ✓ ship allowed",
    "",
  ];
  for (const n of r.nudges) {
    lines.push(`   ${n.symbol} ${n.level.padEnd(11)} risk=${(n.risk * 100).toFixed(0)}%  ${n.sentence.slice(0, 100)}${n.sentence.length > 100 ? "…" : ""}`);
    if (n.drivers.length > 0) lines.push(`        ↳ ${n.drivers.join(" · ")}`);
    if (n.suggested) lines.push(`        ↳ suggested: ${n.suggested.slice(0, 100)}`);
  }
  return lines.join("\n");
}

/* ── Re-exports ─────────────────────────────────────────────────── */

export { splitSentences } from "./sentence_splitter.js";
export type { Sentence } from "./sentence_splitter.js";
export { extractFeatures, riskFromFeatures } from "./heuristics.js";
export type { SentenceFeatures, RiskComputation } from "./heuristics.js";
export { LEVELS, levelForRisk, anyBlocks } from "./conscience_ladder.js";
export type { NudgeLevel, LevelMeta } from "./conscience_ladder.js";
