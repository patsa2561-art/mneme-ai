/**
 * v2.21.1 — STILLNESS PROTOCOL.
 *
 * "AI that decides when NOT to respond."
 *
 * Every AI vendor trains for "answer fast + be helpful." None train for
 * "the right response right now is silence." This module is the gate
 * the user installs in front of their AI agents to enforce structural
 * silence under their own configured policy.
 *
 * Four production-grade primitives:
 *
 *   1. SILENCE BUDGET — per-user daily cap on AI utterances. When the
 *      budget is exhausted, AI literally cannot respond. Refreshes
 *      atomically at local midnight; the counter survives process
 *      restarts (.mneme/stillness/budget.json).
 *
 *   2. SILENCE RULES — declarative user-defined rules:
 *        match: { keywordsAll | keywordsAny | regex }
 *        when:  { hours: "23:00-07:00", "afterNFailuresPerHour": N }
 *        action: silent | delay-hours-N | speak
 *      Rules evaluate in order; first match wins.
 *
 *   3. COOL-OFF RECEIPTS — HMAC-signed records of every declined
 *      response. The user reviews them later. Receipts capture:
 *        ts, prompt-hash (not the prompt itself), reason, reviewable-at.
 *
 *   4. CADENCE STATE INFERENCE — record inter-keystroke intervals from
 *      the IDE/editor hook; compute coefficient-of-variation (CV) of
 *      recent intervals; classify state:
 *        steady (0.2 <= CV <= 0.6)  → ok
 *        agitated (CV > 0.8)        → suggest SILENT
 *        robotic  (CV < 0.15)       → suggest SILENT (probable bot pasting)
 *        sparse (< 3 samples / minute) → ok (no signal)
 *
 * The gate composes all four: gate(prompt) returns SPEAK | SILENT |
 * DELAY-N + a signed receipt the user reviews later.
 *
 * No vendor lock-in. No cloud. No new daemon — runs in-process.
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHmac, createHash, randomBytes } from "node:crypto";

const DIR = ".mneme/stillness";
const BUDGET = "budget.json";
const RULES = "rules.jsonl";
const RECEIPTS = "receipts.jsonl";
const CADENCE = "cadence.jsonl";
const KEY = "stillness.key";

// ─── STORAGE ────────────────────────────────────────────────────────────

function ensureDir(repoRoot: string): string {
  const d = join(repoRoot, DIR);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function ensureKey(repoRoot: string): string {
  const d = ensureDir(repoRoot);
  const p = join(d, KEY);
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const k = randomBytes(32).toString("base64url");
  writeFileSync(p, k, "utf8");
  return k;
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url").slice(0, 22);
}

// ─── 1. SILENCE BUDGET ─────────────────────────────────────────────────

export interface BudgetState {
  v: 1;
  /** Total utterances allowed in the rolling refresh window. */
  maxUtterances: number;
  /** "day" (UTC midnight) | "hour" (each hour boundary). */
  refresh: "day" | "hour";
  /** Counter consumed in current window. */
  consumed: number;
  /** Window start (ISO). */
  windowStart: string;
}

const DEFAULT_MAX_UTTERANCES = 200;
const DEFAULT_REFRESH: BudgetState["refresh"] = "day";

function budgetPath(repoRoot: string): string { return join(ensureDir(repoRoot), BUDGET); }

function currentWindowStart(refresh: BudgetState["refresh"], now: Date = new Date()): string {
  if (refresh === "hour") {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()));
    return d.toISOString();
  }
  // day boundary at UTC midnight.
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return d.toISOString();
}

export function getBudget(repoRoot: string, now: Date = new Date()): BudgetState {
  const p = budgetPath(repoRoot);
  let state: BudgetState;
  if (!existsSync(p)) {
    state = { v: 1, maxUtterances: DEFAULT_MAX_UTTERANCES, refresh: DEFAULT_REFRESH, consumed: 0, windowStart: currentWindowStart(DEFAULT_REFRESH, now) };
    writeFileSync(p, JSON.stringify(state, null, 2), "utf8");
    return state;
  }
  try { state = JSON.parse(readFileSync(p, "utf8")) as BudgetState; }
  catch { state = { v: 1, maxUtterances: DEFAULT_MAX_UTTERANCES, refresh: DEFAULT_REFRESH, consumed: 0, windowStart: currentWindowStart(DEFAULT_REFRESH, now) }; }
  // Auto-refresh at window boundary.
  const expected = currentWindowStart(state.refresh, now);
  if (state.windowStart !== expected) {
    state.windowStart = expected;
    state.consumed = 0;
    writeFileSync(p, JSON.stringify(state, null, 2), "utf8");
  }
  return state;
}

export interface SetBudgetOptions {
  maxUtterances?: number;
  refresh?: BudgetState["refresh"];
  /** Reset counter to zero. */
  reset?: boolean;
}

export function setBudget(repoRoot: string, opts: SetBudgetOptions): BudgetState {
  const state = getBudget(repoRoot);
  if (typeof opts.maxUtterances === "number") state.maxUtterances = Math.max(0, opts.maxUtterances);
  if (opts.refresh) state.refresh = opts.refresh;
  if (opts.reset) {
    state.consumed = 0;
    state.windowStart = currentWindowStart(state.refresh);
  }
  writeFileSync(budgetPath(repoRoot), JSON.stringify(state, null, 2), "utf8");
  return state;
}

/** Atomic-ish increment + check. Returns true when consumption succeeded
 *  (budget had room) or false when budget was exhausted. */
export function consumeBudget(repoRoot: string, n: number = 1): { ok: boolean; remaining: number; state: BudgetState } {
  const state = getBudget(repoRoot);
  const room = state.maxUtterances - state.consumed;
  if (room < n) return { ok: false, remaining: Math.max(0, room), state };
  state.consumed += n;
  writeFileSync(budgetPath(repoRoot), JSON.stringify(state, null, 2), "utf8");
  return { ok: true, remaining: state.maxUtterances - state.consumed, state };
}

// ─── 2. SILENCE RULES ──────────────────────────────────────────────────

export interface SilenceRule {
  v: 1;
  id: string;
  /** Plain-English rationale (shown in receipts). */
  rationale: string;
  /** Matchers — ALL must hit for the rule to fire. */
  match: {
    keywordsAll?: string[];   // every keyword must be in the prompt
    keywordsAny?: string[];   // at least one keyword must be in the prompt
    regex?: string;           // PCRE-style; case-insensitive
  };
  /** Optional time-window gate. "23:00-07:00" means active during those
   *  hours (UTC); rule only fires in this window. */
  hoursWindow?: string;
  /** What to do when the rule fires. */
  action: "silent" | { delayHours: number };
}

function rulesPath(repoRoot: string): string { return join(ensureDir(repoRoot), RULES); }

export function addRule(repoRoot: string, rule: Omit<SilenceRule, "v" | "id">): SilenceRule {
  const full: SilenceRule = { v: 1, id: "rule_" + randomBytes(4).toString("hex"), ...rule };
  appendFileSync(rulesPath(repoRoot), JSON.stringify(full) + "\n", "utf8");
  return full;
}

export function listRules(repoRoot: string): SilenceRule[] {
  const p = rulesPath(repoRoot);
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l) as SilenceRule; } catch { return null; } }).filter((r): r is SilenceRule => !!r);
  } catch { return []; }
}

export function removeRule(repoRoot: string, ruleId: string): boolean {
  const rules = listRules(repoRoot).filter((r) => r.id !== ruleId);
  writeFileSync(rulesPath(repoRoot), rules.map((r) => JSON.stringify(r)).join("\n") + (rules.length > 0 ? "\n" : ""), "utf8");
  return true;
}

function isInHoursWindow(window: string, now: Date = new Date()): boolean {
  const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(window);
  if (!m) return true;
  const hh1 = parseInt(m[1]!, 10), mm1 = parseInt(m[2]!, 10);
  const hh2 = parseInt(m[3]!, 10), mm2 = parseInt(m[4]!, 10);
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const a = hh1 * 60 + mm1;
  const b = hh2 * 60 + mm2;
  if (a < b) return nowMin >= a && nowMin <= b;
  // Wraps midnight: e.g. 23:00-07:00.
  return nowMin >= a || nowMin <= b;
}

function ruleMatches(rule: SilenceRule, prompt: string, now: Date = new Date()): boolean {
  if (rule.hoursWindow && !isInHoursWindow(rule.hoursWindow, now)) return false;
  const lower = prompt.toLowerCase();
  if (rule.match.keywordsAll) {
    for (const k of rule.match.keywordsAll) if (!lower.includes(k.toLowerCase())) return false;
  }
  if (rule.match.keywordsAny) {
    let any = false;
    for (const k of rule.match.keywordsAny) if (lower.includes(k.toLowerCase())) { any = true; break; }
    if (!any) return false;
  }
  if (rule.match.regex) {
    try {
      const re = new RegExp(rule.match.regex, "i");
      if (!re.test(prompt)) return false;
    } catch { return false; }
  }
  // If none of the matchers were configured, the rule is vacuous → no match.
  if (!rule.match.keywordsAll && !rule.match.keywordsAny && !rule.match.regex) return false;
  return true;
}

// ─── 3. COOL-OFF RECEIPTS ──────────────────────────────────────────────

export interface Receipt {
  v: 1;
  ts: string;
  decision: "silent" | "delay" | "speak";
  reason: string;
  /** sha256 of the prompt (not the prompt itself — preserves privacy). */
  promptSha: string;
  /** When the user CAN re-ask (set when decision is "delay"). */
  reviewableAt?: string;
  /** Which rule fired (when applicable). */
  ruleId?: string;
  sig: string;
}

function receiptsPath(repoRoot: string): string { return join(ensureDir(repoRoot), RECEIPTS); }

function writeReceipt(repoRoot: string, rec: Omit<Receipt, "sig">): Receipt {
  const key = ensureKey(repoRoot);
  const canonical = `${rec.v}|${rec.ts}|${rec.decision}|${rec.reason}|${rec.promptSha}|${rec.reviewableAt ?? ""}|${rec.ruleId ?? ""}`;
  const sig = sign(canonical, key);
  const full: Receipt = { ...rec, sig };
  appendFileSync(receiptsPath(repoRoot), JSON.stringify(full) + "\n", "utf8");
  return full;
}

export function listReceipts(repoRoot: string, sinceMs?: number): Receipt[] {
  const p = receiptsPath(repoRoot);
  if (!existsSync(p)) return [];
  try {
    const all = readFileSync(p, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l) as Receipt; } catch { return null; } }).filter((r): r is Receipt => !!r);
    if (!sinceMs) return all;
    return all.filter((r) => new Date(r.ts).getTime() >= sinceMs);
  } catch { return []; }
}

export function verifyReceipt(repoRoot: string, r: Receipt): boolean {
  const key = ensureKey(repoRoot);
  const canonical = `${r.v}|${r.ts}|${r.decision}|${r.reason}|${r.promptSha}|${r.reviewableAt ?? ""}|${r.ruleId ?? ""}`;
  return sign(canonical, key) === r.sig;
}

// ─── 4. CADENCE STATE INFERENCE ────────────────────────────────────────

export interface CadenceSample {
  ts: string;
  /** Inter-keystroke interval in ms. */
  intervalMs: number;
}

export type CadenceState = "steady" | "agitated" | "robotic" | "sparse";

export interface CadenceVerdict {
  state: CadenceState;
  /** Coefficient of variation of recent intervals. */
  cv: number;
  /** Number of samples used. */
  samples: number;
  /** Should the gate suggest SILENT given this verdict? */
  shouldSilence: boolean;
}

function cadencePath(repoRoot: string): string { return join(ensureDir(repoRoot), CADENCE); }

export function recordCadence(repoRoot: string, intervalsMs: number[]): void {
  const dir = ensureDir(repoRoot);
  const ts = new Date().toISOString();
  for (const interval of intervalsMs) {
    if (!Number.isFinite(interval) || interval < 0) continue;
    appendFileSync(join(dir, CADENCE), JSON.stringify({ ts, intervalMs: interval }) + "\n", "utf8");
  }
}

/** Read the most recent N cadence samples + compute the verdict.
 *  Uses Coefficient-of-Variation (CV = stddev / mean) as the state
 *  signal — robust to per-user typing speed differences. */
export function inferCadenceState(repoRoot: string, lastN: number = 50): CadenceVerdict {
  const p = cadencePath(repoRoot);
  if (!existsSync(p)) return { state: "sparse", cv: 0, samples: 0, shouldSilence: false };
  let samples: CadenceSample[] = [];
  try {
    samples = readFileSync(p, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l) as CadenceSample; } catch { return null; } }).filter((s): s is CadenceSample => !!s);
  } catch { return { state: "sparse", cv: 0, samples: 0, shouldSilence: false }; }
  const recent = samples.slice(-lastN);
  if (recent.length < 3) return { state: "sparse", cv: 0, samples: recent.length, shouldSilence: false };
  const intervals = recent.map((r) => r.intervalMs);
  const mean = intervals.reduce((s, v) => s + v, 0) / intervals.length;
  if (mean <= 0) return { state: "sparse", cv: 0, samples: recent.length, shouldSilence: false };
  const variance = intervals.reduce((s, v) => s + (v - mean) ** 2, 0) / intervals.length;
  const stddev = Math.sqrt(variance);
  const cv = stddev / mean;
  let state: CadenceState = "steady";
  let shouldSilence = false;
  if (cv > 0.8) { state = "agitated"; shouldSilence = true; }
  else if (cv < 0.15) { state = "robotic"; shouldSilence = true; }
  return { state, cv: Number(cv.toFixed(3)), samples: recent.length, shouldSilence };
}

// ─── 5. THE GATE (decision verb) ────────────────────────────────────────

export interface GateOptions {
  prompt: string;
  /** Skip budget check (useful for diagnostic / preview calls). */
  skipBudget?: boolean;
  /** Skip cadence inference. */
  skipCadence?: boolean;
  /** Override "now" — test injection. */
  now?: Date;
}

export interface GateDecision {
  decision: "speak" | "silent" | "delay";
  reason: string;
  receipt: Receipt;
  /** When decision = delay, the ISO of when the AI may try again. */
  reviewableAt?: string;
  /** Budget remaining if decision = speak (so caller can show it). */
  remainingBudget?: number;
}

/** Headline verb. Composes the four primitives into a single SPEAK |
 *  SILENT | DELAY decision with a signed receipt. */
export function gate(repoRoot: string, opts: GateOptions): GateDecision {
  const now = opts.now ?? new Date();
  const ts = now.toISOString();
  const promptSha = createHash("sha256").update(opts.prompt).digest("hex").slice(0, 32);

  // Phase 1 — rules.
  for (const rule of listRules(repoRoot)) {
    if (!ruleMatches(rule, opts.prompt, now)) continue;
    if (rule.action === "silent") {
      const receipt = writeReceipt(repoRoot, { v: 1, ts, decision: "silent", reason: rule.rationale, promptSha, ruleId: rule.id });
      return { decision: "silent", reason: rule.rationale, receipt };
    }
    if (typeof rule.action === "object" && "delayHours" in rule.action) {
      const reviewableAt = new Date(now.getTime() + rule.action.delayHours * 3600 * 1000).toISOString();
      const receipt = writeReceipt(repoRoot, { v: 1, ts, decision: "delay", reason: rule.rationale, promptSha, reviewableAt, ruleId: rule.id });
      return { decision: "delay", reason: rule.rationale, receipt, reviewableAt };
    }
  }

  // Phase 2 — cadence state.
  if (!opts.skipCadence) {
    const cad = inferCadenceState(repoRoot);
    if (cad.shouldSilence) {
      const reason = `cadence state = ${cad.state} (CV ${cad.cv}). Suggesting silence.`;
      const receipt = writeReceipt(repoRoot, { v: 1, ts, decision: "silent", reason, promptSha });
      return { decision: "silent", reason, receipt };
    }
  }

  // Phase 3 — budget.
  if (!opts.skipBudget) {
    const r = consumeBudget(repoRoot, 1);
    if (!r.ok) {
      const reason = `budget exhausted (${r.state.consumed}/${r.state.maxUtterances} consumed; refreshes ${r.state.refresh === "day" ? "at UTC midnight" : "hourly"}).`;
      const receipt = writeReceipt(repoRoot, { v: 1, ts, decision: "silent", reason, promptSha });
      return { decision: "silent", reason, receipt };
    }
    // SPEAK + record + return.
    const receipt = writeReceipt(repoRoot, { v: 1, ts, decision: "speak", reason: "all gates passed", promptSha });
    return { decision: "speak", reason: "all gates passed", receipt, remainingBudget: r.remaining };
  }

  const receipt = writeReceipt(repoRoot, { v: 1, ts, decision: "speak", reason: "budget bypassed", promptSha });
  return { decision: "speak", reason: "budget bypassed", receipt };
}

// ─── FORMATTERS ────────────────────────────────────────────────────────

export function formatBudget(b: BudgetState): string {
  const remaining = b.maxUtterances - b.consumed;
  return [
    `🤐 STILLNESS BUDGET`,
    ``,
    `  Max:        ${b.maxUtterances} utterance(s) per ${b.refresh}`,
    `  Consumed:   ${b.consumed}`,
    `  Remaining:  ${remaining}`,
    `  Window:     ${b.windowStart} (refreshes at next ${b.refresh} boundary)`,
  ].join("\n");
}

export function formatDecision(d: GateDecision): string {
  const badge = d.decision === "speak" ? "🗣  SPEAK"
              : d.decision === "silent" ? "🤐 SILENT"
              : "⏳ DELAY";
  const lines = [`🤐 STILLNESS — ${badge}`, ``, `  Reason: ${d.reason}`];
  if (d.reviewableAt) lines.push(`  Reviewable at: ${d.reviewableAt}`);
  if (d.remainingBudget !== undefined) lines.push(`  Budget remaining: ${d.remainingBudget}`);
  lines.push(`  Receipt: ${d.receipt.sig.slice(0, 16)}…  (${d.receipt.ts})`);
  return lines.join("\n");
}

export function formatVerdict(v: CadenceVerdict): string {
  return [
    `🤐 STILLNESS CADENCE VERDICT`,
    ``,
    `  State:      ${v.state}`,
    `  CV:         ${v.cv}`,
    `  Samples:    ${v.samples}`,
    `  Should silence: ${v.shouldSilence ? "yes" : "no"}`,
  ].join("\n");
}
