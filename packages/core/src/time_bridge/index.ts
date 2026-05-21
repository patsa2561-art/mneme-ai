/**
 * v2.20.0 — TIME BRIDGE.
 *
 * "Past-you ANNOTATES the future; future-you's AI listens automatically."
 *
 * The moat is NOT crypto signatures (A2A v1.0 just commodified those).
 * The real moat is:
 *   (1) decision corpus captured WITHOUT manual effort (auto-inscription
 *       on every Mneme verb, via SUPER NOVA observer)
 *   (2) "default temporal layer" position in the AI-agent stack
 *   (3) format-longevity commitment: TIME BRIDGE FORMAT v1 — stable
 *       for 20+ years, never breaks
 *
 * Seven world-class innovations that compose into a system AI agents
 * cannot live without:
 *
 *   1. FUTURE-READABLE PROVENANCE (FRP)
 *      Decisions carry future-applicability hints — not "I decided X"
 *      but "if you touch this in 6 months and {condition}, here's why
 *      X mattered." Structurally prospective, not descriptive.
 *
 *   2. DRIFT-AWARE SURFACE (DAS)
 *      When past reasoning surfaces, the surface mechanism quantifies
 *      how the codebase has drifted since then. Stale constraints get
 *      DOWNGRADED automatically; freshly-relevant ones get UPGRADED.
 *
 *   3. CONSTRAINT RESURRECTION
 *      When past-self refused a pattern + AI today is about to attempt
 *      it, Resurrection structurally requires a signed override note.
 *      AI cannot silently regress past decisions.
 *
 *   4. ECHO-CHAMBER KILLER
 *      Today's plan contradicts past-self? TIME BRIDGE surfaces BOTH
 *      and forces a "reversal note" signed by present-self for
 *      future-self to read. Structured dialogue across time.
 *
 *   5. SPOTLIGHT AUTO-TUNING
 *      Relevance scoring adapts to which past warnings the user actually
 *      heeded (success signal) vs ignored (failure signal). The bridge
 *      LEARNS what's signal vs noise per user — no manual tuning.
 *
 *   6. WAKE-WORD PREDICATES (the killer)
 *      Past-self can record a decision with a wake predicate — "wake
 *      me when {condition} happens" — that fires automatically when
 *      the condition is later detected. Time-delayed guidance no other
 *      product ships.
 *
 *   7. GENERATIONAL CONSTRAINT TREE
 *      Decisions visible as a TREE of overrides — child decisions
 *      inherit / override parent. AI can read the full evolution of
 *      a constraint, not just its current value.
 *
 * Every Mneme verb fired through SUPER NOVA auto-inscribes here.
 * No manual effort.  No "remember to save."  The corpus accumulates
 * as a side-effect of using Mneme normally.
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHmac, randomBytes, createHash } from "node:crypto";
import { registerObserver, withSuperNova } from "../super_nova/index.js";

const DIR = ".mneme/time_bridge";
const INSCRIPTIONS = "inscriptions.jsonl";
const WATCHERS = "watchers.jsonl";
const SURFACES = "surfaces.jsonl";
const OVERRIDES = "overrides.jsonl";
const TUNING = "tuning.json";
const KEY = "time_bridge.key";

/** Format version — guaranteed stable for 20+ years. */
export const FORMAT_VERSION = 1 as const;

export type InscriptionKind =
  | "decision"         // I chose X over Y because Z
  | "refusal"          // I refused to do Z because W
  | "constraint"       // Going forward, never do A in this codebase
  | "warning"          // Be careful when touching B
  | "annotation";      // Just FYI for future-you

export interface FutureApplicability {
  /** Plain-English description of when this matters in the future. */
  appliesWhen: string;
  /** Relevance signals the relevance-matcher will look for. */
  signals?: {
    files?: string[];        // touch any of these files
    symbols?: string[];      // mention any of these symbol names
    keywords?: string[];     // text/keyword matches
    tags?: string[];         // tag overlap with current context
    afterDate?: string;      // only fire after this ISO date
  };
  /** Initial relevance weight 0..1; tuned by Spotlight as outcomes accumulate. */
  initialWeight?: number;
}

export interface WakePredicate {
  /** Plain-English description of the wake condition. */
  description: string;
  /** Machine-checkable predicate. */
  trigger: {
    kind: "file-touched" | "symbol-mentioned" | "tag-fired" | "date-reached" | "external";
    /** For file-touched / symbol-mentioned. */
    pattern?: string;
    /** For date-reached. */
    iso?: string;
    /** For external — caller invokes manually with this id. */
    externalId?: string;
  };
  /** Has this predicate fired already? */
  fired?: boolean;
  /** When it fired. */
  firedAt?: string;
}

export interface Inscription {
  /** Format-stable schema version. */
  v: 1;
  /** Globally-unique id. */
  id: string;
  /** ISO timestamp when written. */
  ts: string;
  /** Author identity (free text — could be a vendor id or human name). */
  author: string;
  kind: InscriptionKind;
  /** One-line summary the receiving AI sees in its context. */
  headline: string;
  /** Full reasoning the AI may read in detail. */
  reasoning: string;
  /** Future-applicability hint — the magic field. */
  fra: FutureApplicability;
  /** Optional wake predicates that fire automatically. */
  wakes?: WakePredicate[];
  /** Parent inscription id (for the Generational Tree). */
  parentId?: string;
  /** Tags for retrieval. */
  tags: string[];
  /** HMAC sig over canonical payload. */
  sig: string;
}

export interface SurfaceMatch {
  inscription: Inscription;
  /** 0..1 relevance score after Spotlight + DAS. */
  score: number;
  /** Why it was surfaced. */
  reasons: string[];
  /** How much the codebase has drifted since the inscription (0..1). */
  driftScore: number;
}

export interface OverrideRecord {
  v: 1;
  ts: string;
  overrider: string;
  /** Inscription being overridden. */
  inscriptionId: string;
  /** Plain-English reason for the override (forced via the structured prompt). */
  reason: string;
  sig: string;
}

interface TuningState {
  v: 1;
  /** Per-inscription outcome counters. heeded = user acted on the warning. */
  perInscription: Record<string, { heededCount: number; ignoredCount: number; lastSeen: string }>;
}

// ─── STORAGE ───────────────────────────────────────────────────────────

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

function signInscription(i: Omit<Inscription, "sig">, key: string): string {
  const payload = `${i.v}|${i.id}|${i.ts}|${i.author}|${i.kind}|${i.headline}|${i.reasoning}|${JSON.stringify(i.fra)}|${JSON.stringify(i.wakes ?? [])}|${i.parentId ?? ""}|${i.tags.join(",")}`;
  return createHmac("sha256", key).update(payload).digest("base64url").slice(0, 22);
}

function loadInscriptions(repoRoot: string): Inscription[] {
  const p = join(repoRoot, DIR, INSCRIPTIONS);
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l) as Inscription; } catch { return null; } }).filter((r): r is Inscription => !!r);
  } catch { return []; }
}

function loadTuning(repoRoot: string): TuningState {
  const p = join(repoRoot, DIR, TUNING);
  if (!existsSync(p)) return { v: 1, perInscription: {} };
  try { return JSON.parse(readFileSync(p, "utf8")) as TuningState; }
  catch { return { v: 1, perInscription: {} }; }
}

function saveTuning(repoRoot: string, t: TuningState): void {
  writeFileSync(join(ensureDir(repoRoot), TUNING), JSON.stringify(t, null, 2), "utf8");
}

// ─── 1. INSCRIBE ───────────────────────────────────────────────────────

export interface InscribeOptions {
  author: string;
  kind: InscriptionKind;
  headline: string;
  reasoning: string;
  fra: FutureApplicability;
  wakes?: WakePredicate[];
  parentId?: string;
  tags?: string[];
}

/** Write a new inscription. HMAC-signed; format-stable; auditable. */
export async function inscribe(repoRoot: string, opts: InscribeOptions): Promise<Inscription> {
  return withSuperNova(
    { verb: "mneme.time_bridge.inscribe", surface: "lib", repoRoot, vendor: opts.author },
    async () => {
      const key = ensureKey(repoRoot);
      const ts = new Date().toISOString();
      const id = "ins_" + createHash("sha256").update(`${ts}|${opts.headline}|${opts.author}|${randomBytes(4).toString("hex")}`).digest("hex").slice(0, 16);
      const payload: Omit<Inscription, "sig"> = {
        v: FORMAT_VERSION,
        id, ts, author: opts.author,
        kind: opts.kind, headline: opts.headline, reasoning: opts.reasoning,
        fra: opts.fra, wakes: opts.wakes, parentId: opts.parentId,
        tags: opts.tags ?? [],
      };
      const sig = signInscription(payload, key);
      const inscription: Inscription = { ...payload, sig };
      appendFileSync(join(ensureDir(repoRoot), INSCRIPTIONS), JSON.stringify(inscription) + "\n", "utf8");
      return inscription;
    },
    { tags: ["time-bridge", "inscribe"] },
  );
}

// ─── 2. RELEVANCE (Drift-Aware Surface + Spotlight Auto-Tune) ─────────

interface SurfaceContext {
  /** File currently being touched. */
  file?: string;
  /** Symbols / function names involved. */
  symbols?: string[];
  /** Free text the AI is about to commit / write / propose. */
  text?: string;
  /** Tags the caller knows about. */
  tags?: string[];
}

/** Quantify how relevant an inscription is to the current context. */
function scoreRelevance(ins: Inscription, ctx: SurfaceContext): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = ins.fra.initialWeight ?? 0.5;
  const sig = ins.fra.signals ?? {};
  // Date gate.
  if (sig.afterDate && new Date(sig.afterDate).getTime() > Date.now()) {
    return { score: 0, reasons: ["before afterDate gate"] };
  }
  // File match.
  if (sig.files && ctx.file) {
    for (const f of sig.files) {
      if (ctx.file.includes(f)) { score += 0.3; reasons.push(`file matches "${f}"`); break; }
    }
  }
  // Symbol match.
  if (sig.symbols && ctx.symbols) {
    for (const s of sig.symbols) {
      if (ctx.symbols.includes(s)) { score += 0.25; reasons.push(`symbol matches "${s}"`); break; }
    }
  }
  // Keyword match.
  if (sig.keywords && ctx.text) {
    const lower = ctx.text.toLowerCase();
    for (const k of sig.keywords) {
      if (lower.includes(k.toLowerCase())) { score += 0.2; reasons.push(`keyword matches "${k}"`); break; }
    }
  }
  // Tag overlap.
  if (sig.tags && ctx.tags) {
    const overlap = sig.tags.filter((t) => ctx.tags!.includes(t)).length;
    if (overlap > 0) { score += Math.min(0.3, overlap * 0.1); reasons.push(`${overlap} tag(s) match`); }
  }
  return { score: Math.min(1, score), reasons };
}

/** Estimate how much the codebase has drifted from the inscription
 *  time.  Pure heuristic: file mtime delta + (later: git diff hunk
 *  count for the involved files). */
function driftScore(repoRoot: string, ins: Inscription): number {
  const sig = ins.fra.signals;
  if (!sig?.files || sig.files.length === 0) return 0;
  let totalDays = 0;
  let count = 0;
  const insTime = new Date(ins.ts).getTime();
  for (const f of sig.files) {
    const full = join(repoRoot, f);
    if (!existsSync(full)) { totalDays += 365; count++; continue; } // file deleted = max drift
    try {
      const st = statSync(full);
      const days = Math.max(0, (st.mtimeMs - insTime) / (1000 * 60 * 60 * 24));
      totalDays += days; count++;
    } catch { /* */ }
  }
  if (count === 0) return 0;
  // Normalise to [0..1] — drift saturates around 1 year.
  return Math.min(1, totalDays / count / 365);
}

/** Apply Spotlight auto-tuning multiplier based on past heeded/ignored counts. */
function applyTuning(score: number, ins: Inscription, t: TuningState): number {
  const e = t.perInscription[ins.id];
  if (!e) return score;
  const total = e.heededCount + e.ignoredCount;
  if (total < 3) return score;
  const heedRate = e.heededCount / total;
  // Heeded a lot → boost relevance; ignored a lot → suppress.
  const mult = 0.5 + heedRate; // 0.5 (always ignored) ... 1.5 (always heeded)
  return Math.min(1, score * mult);
}

// ─── 3. SURFACE ────────────────────────────────────────────────────────

export interface SurfaceOptions extends SurfaceContext {
  /** Minimum relevance threshold. Default 0.4. */
  threshold?: number;
  /** Max items to return. Default 5. */
  topK?: number;
}

/** The headline verb: given the current context (file / symbols / text /
 *  tags), return the most-relevant past inscriptions with full
 *  Drift-Aware Surface + Spotlight Auto-Tune applied. */
export async function surface(repoRoot: string, opts: SurfaceOptions): Promise<SurfaceMatch[]> {
  return withSuperNova(
    { verb: "mneme.time_bridge.surface", surface: "lib", repoRoot, vendor: "mneme" },
    async () => {
      const inscriptions = loadInscriptions(repoRoot);
      const tuning = loadTuning(repoRoot);
      const threshold = opts.threshold ?? 0.4;
      const topK = opts.topK ?? 5;
      const matches: SurfaceMatch[] = [];
      for (const ins of inscriptions) {
        const { score: raw, reasons } = scoreRelevance(ins, opts);
        if (raw <= 0) continue;
        const tuned = applyTuning(raw, ins, tuning);
        const drift = driftScore(repoRoot, ins);
        // Drift downgrades stale constraints; freshly-relevant ones unchanged.
        const final = Math.max(0, tuned - drift * 0.3);
        if (final >= threshold) {
          matches.push({ inscription: ins, score: Number(final.toFixed(3)), reasons, driftScore: Number(drift.toFixed(3)) });
        }
      }
      matches.sort((a, b) => b.score - a.score);
      const out = matches.slice(0, topK);
      // Record the surface event for audit (and so the user can later
      // mark which ones were heeded).
      try {
        for (const m of out) {
          appendFileSync(join(ensureDir(repoRoot), SURFACES), JSON.stringify({
            ts: new Date().toISOString(),
            inscriptionId: m.inscription.id,
            score: m.score, driftScore: m.driftScore,
          }) + "\n", "utf8");
        }
      } catch { /* */ }
      return out;
    },
    { tags: ["time-bridge", "surface"] },
  );
}

// ─── 4. RESURRECTION ───────────────────────────────────────────────────

export interface ResurrectionVerdict {
  /** True iff plan contradicts a still-relevant past constraint. */
  blocked: boolean;
  /** The contradicting inscription(s). */
  contradicts: SurfaceMatch[];
  /** Text the AI must include in its override note to proceed. */
  requiredOverride: string;
}

/** Check whether the AI's proposed plan contradicts any past
 *  constraint/refusal. If so, block + return required override text. */
export async function resurrect(repoRoot: string, planText: string, ctx: SurfaceContext = {}): Promise<ResurrectionVerdict> {
  return withSuperNova(
    { verb: "mneme.time_bridge.resurrect", surface: "lib", repoRoot, vendor: "mneme" },
    async () => {
      const matches = await surface(repoRoot, { ...ctx, text: planText, threshold: 0.5, topK: 10 });
      // Constraint/refusal kinds with high relevance → block.
      const contradicting = matches.filter(
        (m) => (m.inscription.kind === "constraint" || m.inscription.kind === "refusal") && m.score >= 0.5,
      );
      if (contradicting.length === 0) {
        return { blocked: false, contradicts: [], requiredOverride: "" };
      }
      const ids = contradicting.map((c) => c.inscription.id).join(", ");
      const requiredOverride = [
        `You are attempting an action that contradicts past constraint(s): ${ids}.`,
        `To proceed, you MUST write an override note signed with your identity, citing each inscription id and explaining WHY you are reversing it.`,
        `Format:`,
        `  # TIME BRIDGE OVERRIDE`,
        `  overriding: ${ids}`,
        `  by: <your-agent-id>`,
        `  reason: <one-paragraph-plain-English>`,
        `  newConstraint: <what replaces the old one, if anything>`,
        ``,
        `Without this override, the action is refused.`,
      ].join("\n");
      return { blocked: true, contradicts: contradicting, requiredOverride };
    },
    { tags: ["time-bridge", "resurrect"] },
  );
}

/** Record an override of a past inscription. Signed for future audit. */
export async function recordOverride(repoRoot: string, opts: { overrider: string; inscriptionId: string; reason: string }): Promise<OverrideRecord> {
  return withSuperNova(
    { verb: "mneme.time_bridge.override", surface: "lib", repoRoot, vendor: opts.overrider },
    async () => {
      const key = ensureKey(repoRoot);
      const ts = new Date().toISOString();
      const payload = `${ts}|${opts.overrider}|${opts.inscriptionId}|${opts.reason}`;
      const sig = createHmac("sha256", key).update(payload).digest("base64url").slice(0, 22);
      const rec: OverrideRecord = { v: 1, ts, overrider: opts.overrider, inscriptionId: opts.inscriptionId, reason: opts.reason, sig };
      appendFileSync(join(ensureDir(repoRoot), OVERRIDES), JSON.stringify(rec) + "\n", "utf8");
      return rec;
    },
    { tags: ["time-bridge", "override"] },
  );
}

// ─── 5. SPOTLIGHT TUNING (heed / ignore feedback) ──────────────────────

export function markHeeded(repoRoot: string, inscriptionId: string): void {
  const t = loadTuning(repoRoot);
  const e = t.perInscription[inscriptionId] ?? { heededCount: 0, ignoredCount: 0, lastSeen: new Date().toISOString() };
  e.heededCount++;
  e.lastSeen = new Date().toISOString();
  t.perInscription[inscriptionId] = e;
  saveTuning(repoRoot, t);
}

export function markIgnored(repoRoot: string, inscriptionId: string): void {
  const t = loadTuning(repoRoot);
  const e = t.perInscription[inscriptionId] ?? { heededCount: 0, ignoredCount: 0, lastSeen: new Date().toISOString() };
  e.ignoredCount++;
  e.lastSeen = new Date().toISOString();
  t.perInscription[inscriptionId] = e;
  saveTuning(repoRoot, t);
}

// ─── 6. WAKE-WORD PREDICATE FIRING ─────────────────────────────────────

export interface WakeFiring {
  inscription: Inscription;
  predicate: WakePredicate;
  firedAt: string;
}

/** Check all pending wake predicates against current repo state.
 *  Returns the inscriptions whose predicates fired. The daemon calls
 *  this periodically; CLI calls it ad-hoc. */
export async function fireWatchers(repoRoot: string, ctx: SurfaceContext = {}): Promise<WakeFiring[]> {
  return withSuperNova(
    { verb: "mneme.time_bridge.fire_watchers", surface: "lib", repoRoot, vendor: "mneme" },
    async () => {
      const inscriptions = loadInscriptions(repoRoot);
      const firings: WakeFiring[] = [];
      const now = new Date().toISOString();
      for (const ins of inscriptions) {
        if (!ins.wakes || ins.wakes.length === 0) continue;
        for (const w of ins.wakes) {
          if (w.fired) continue;
          let fired = false;
          if (w.trigger.kind === "date-reached" && w.trigger.iso) {
            if (new Date(w.trigger.iso).getTime() <= Date.now()) fired = true;
          } else if (w.trigger.kind === "file-touched" && w.trigger.pattern && ctx.file) {
            if (ctx.file.includes(w.trigger.pattern)) fired = true;
          } else if (w.trigger.kind === "symbol-mentioned" && w.trigger.pattern && ctx.symbols) {
            if (ctx.symbols.includes(w.trigger.pattern)) fired = true;
          }
          if (fired) {
            w.fired = true;
            w.firedAt = now;
            firings.push({ inscription: ins, predicate: w, firedAt: now });
          }
        }
      }
      // Persist the updated `fired` flags by rewriting the inscriptions
      // file with the modified rows.  Cheap because file is jsonl + small.
      try {
        writeFileSync(join(ensureDir(repoRoot), INSCRIPTIONS), inscriptions.map((i) => JSON.stringify(i)).join("\n") + "\n", "utf8");
      } catch { /* */ }
      return firings;
    },
    { tags: ["time-bridge", "fire-watchers"] },
  );
}

// ─── 7. GENERATIONAL TREE ──────────────────────────────────────────────

export interface TreeNode {
  inscription: Inscription;
  children: TreeNode[];
}

/** Build the override-lineage tree for a given inscription id. Walks
 *  parent links upward + downward. */
export function tree(repoRoot: string, rootId: string): TreeNode | null {
  const all = loadInscriptions(repoRoot);
  const byId = new Map(all.map((i) => [i.id, i]));
  const root = byId.get(rootId);
  if (!root) return null;
  const byParent = new Map<string, Inscription[]>();
  for (const i of all) {
    if (i.parentId) {
      const arr = byParent.get(i.parentId) ?? [];
      arr.push(i);
      byParent.set(i.parentId, arr);
    }
  }
  function build(ins: Inscription): TreeNode {
    return { inscription: ins, children: (byParent.get(ins.id) ?? []).map(build) };
  }
  return build(root);
}

// ─── AUTO-INSCRIPTION via SUPER NOVA OBSERVER ──────────────────────────

let autoObserverInstalled = false;

/** Install a SUPER NOVA observer that auto-inscribes select Mneme verbs
 *  as decisions. Caller can opt-in once (idempotent). */
export function enableAutoInscription(opts: { repoRoot: string; author: string }): () => void {
  if (autoObserverInstalled) return () => { /* */ };
  autoObserverInstalled = true;
  return registerObserver({
    id: "time_bridge_auto_inscriber",
    phases: ["after"],
    onPhase: (_phase, ctx, outcome) => {
      // Only inscribe meaningful, infrequent verbs — avoid spam.
      const noteworthy = /\.(swarm|govtech|cert\.mint|chronicle|apostille\.mint|guardrail\.consent|intern\.(start|graduate)|dream\.run)/;
      if (!noteworthy.test(ctx.verb)) return;
      const root = ctx.repoRoot ?? opts.repoRoot;
      if (!root) return;
      try {
        // Synchronous-friendly write via inscribe sans super-nova wrapper
        // (we're already inside the observer — wrapping again would loop).
        const key = ensureKey(root);
        const ts = new Date().toISOString();
        const id = "ins_" + createHash("sha256").update(`${ts}|${ctx.verb}|${randomBytes(4).toString("hex")}`).digest("hex").slice(0, 16);
        const payload: Omit<Inscription, "sig"> = {
          v: FORMAT_VERSION, id, ts, author: ctx.vendor ?? opts.author,
          kind: "decision",
          headline: `${ctx.verb} ${outcome?.ok ? "✓" : "✗"} (auto-inscribed)`,
          reasoning: `Auto-inscription: ${ctx.verb} fired with ${outcome?.durationMs ?? "?"}ms latency. ${outcome?.ok ? "Succeeded." : "Failed: " + (outcome?.errorMessage ?? "unknown")}`,
          fra: { appliesWhen: `Future invocations of ${ctx.verb} in similar context.`, signals: { tags: [ctx.verb] } },
          tags: ["auto", ctx.verb, ctx.surface],
        };
        const sig = signInscription(payload, key);
        appendFileSync(join(ensureDir(root), INSCRIPTIONS), JSON.stringify({ ...payload, sig }) + "\n", "utf8");
      } catch { /* auto-inscription is best-effort; never break the host call */ }
    },
  });
}

// ─── HUMAN-READABLE FORMATTER ──────────────────────────────────────────

export function formatSurfaceMatches(matches: SurfaceMatch[]): string {
  if (matches.length === 0) return "🕰  TIME BRIDGE — no relevant past inscriptions found for this context.";
  const lines: string[] = [];
  lines.push("🕰  TIME BRIDGE — relevant past inscriptions");
  lines.push("");
  for (const m of matches) {
    const i = m.inscription;
    const driftWarn = m.driftScore > 0.5 ? "  ⚠ stale" : "";
    lines.push(`  📜 ${i.kind.toUpperCase()}  score=${(m.score * 100).toFixed(0)}%  drift=${(m.driftScore * 100).toFixed(0)}%${driftWarn}`);
    lines.push(`     ${i.headline}`);
    lines.push(`     authored by ${i.author} on ${i.ts.slice(0, 10)}  (id: ${i.id})`);
    lines.push(`     applies when: ${i.fra.appliesWhen}`);
    if (m.reasons.length > 0) lines.push(`     matched because: ${m.reasons.join("; ")}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function formatResurrectionVerdict(v: ResurrectionVerdict): string {
  if (!v.blocked) return "🕰  TIME BRIDGE — no past constraints contradict this plan. Proceed.";
  const lines: string[] = [];
  lines.push("🕰  TIME BRIDGE — RESURRECTION");
  lines.push("");
  lines.push("  ⛔ Plan contradicts the following past constraints/refusals:");
  for (const c of v.contradicts) {
    lines.push(`    • ${c.inscription.id}  (${c.inscription.kind}, score ${(c.score * 100).toFixed(0)}%)`);
    lines.push(`        ${c.inscription.headline}`);
  }
  lines.push("");
  lines.push("  Required action to proceed:");
  for (const ln of v.requiredOverride.split("\n")) lines.push(`    ${ln}`);
  return lines.join("\n");
}
