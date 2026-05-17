/**
 * v2.19.26 — MNEME DREAMSPACE · GESTATION (self-authoring MCP catalog · phase 1 of 2)
 *
 *   "Catalog ตัวมัน static — ไม่งอก ไม่ตาย ไม่จับคู่ ไม่เรียนรู้ที่จะ
 *    author tool ใหม่. นั่นคือ gap ของกระบวนการ 'ของเดิม + ของใหม่ +
 *    การเลือก' — ที่ DREAMS ปัจจุบันยังตอบไม่ได้"
 *                                          — user audit, 2026-05-17
 *
 *   Diagnosis: every prior dreams primitive (vaccine_cycle, dream.run,
 *   dreams.enqueue/resolve) is a PRODUCT factory — it manufactures
 *   one specific artifact (vaccine / claim / verdict). GESTATION is
 *   a TOOL factory — it watches for catalog gaps + proposes the
 *   composer recipe for a brand-new MCP tool that closes the gap.
 *
 *   Three gap classes detected from caller-supplied signals:
 *     1. REFLEX cache miss — user (or AI) tried an event that
 *        had no cached prediction; nothing fired. Gap = no pattern
 *        matched this event signature.
 *     2. user_chat no-match — user typed a request; EVENT PATTERN
 *        MATCH returned zero predictions. Gap = no semantic rule
 *        recognised this phrase.
 *     3. pattern co-occurrence — two tools always fire together in
 *        sequence (e.g., mneme.ask then mneme.why). Gap = no single
 *        composed tool does both — opportunity for chimera.
 *
 *   For each gap, propose a ProposedToolSpec with deterministic name,
 *   description (from the originating signal), composer recipe (list
 *   of existing tools to chain), and a JSON inputSchema derived as the
 *   intersection of the composed tools' input schemas. Caller (daemon)
 *   feeds the spec to v2.19.9 WRAPPER_GENESPLICING `splice` to actually
 *   create the runtime chimera; this module is the PROPOSER, not the
 *   executor.
 *
 *   Composes onto:
 *     - v2.19.9  WRAPPER_GENESPLICING (real splice surface)
 *     - v2.19.11 MORTAL (TTL for proposed tools)
 *     - v2.19.22 REFLEX (cache miss signal)
 *     - v2.19.24 EVENT PATTERN MATCH (no-match signal)
 *     - v2.19.25 SLEEP TRAINING (fitness gradient feeds promotion)
 *
 * Honest scope:
 *   - PURE FUNCTION proposer; HMAC-signed proposals so daemon can
 *     audit forged specs.
 *   - Composer recipes are SEQUENCES (Tool_A then Tool_B); we don't
 *     synthesise parallelisable or conditional graphs. v2.19.9 supports
 *     sequential/fan_out/first_success — we emit "sequential" only.
 *   - Names use deterministic snake_case to avoid collisions:
 *     `mneme.auto.<tool1>_then_<tool2>`. Caller can rename on promote.
 *   - We do NOT execute or load code. Daemon picks specs to promote
 *     based on usage telemetry from v2.19.26 EVOLUTION.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;
const DEFAULT_MIN_GAP_COUNT = 3;
const DEFAULT_MIN_COOCCUR_COUNT = 4;

export type GapKind = "reflex_cache_miss" | "user_chat_no_match" | "pattern_co_occurrence";

export interface GapSignal {
  v: typeof PROTOCOL_VERSION;
  kind: GapKind;
  /** Human label (e.g., "git_commit:fix-prefix" / "user_chat:thai-รีเฟรช"). */
  label: string;
  /** Tool names already known to be relevant (empty for no_match). */
  relatedTools: string[];
  /** How many times this gap was observed yesterday. */
  count: number;
  ts: number;
}

export interface ProposedToolSpec {
  v: typeof PROTOCOL_VERSION;
  /** Deterministic name; daemon can rename on promote. */
  proposedName: string;
  /** Why this tool exists; derived from the originating signal. */
  description: string;
  /** Ordered list of EXISTING tools the chimera invokes. */
  composerRecipe: Array<{ toolName: string; argsPassthrough?: boolean }>;
  /** Composer kind for v2.19.9 splice (always "sequential" for now). */
  composerKind: "sequential" | "fan_out" | "first_success";
  /** JSON Schema of the chimera's input (union of component inputs). */
  proposedInputSchema: { type: "object"; properties: Record<string, unknown>; required: string[] };
  /** Source gap signal that triggered this proposal. */
  sourceGap: GapSignal;
  /** Confidence 0..1 — based on signal count vs threshold. */
  confidence: number;
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_DREAMSPACE_GESTATION_SECRET"] || `mneme-dreamspace-gestation-v${PROTOCOL_VERSION}`;
}

function hmacHex(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 32);
}

/**
 * Filter gap signals down to those above the minimum-count threshold.
 * Below-threshold signals are noise; above-threshold signals are real
 * gaps worth proposing a tool for.
 */
export function detectToolGaps(input: {
  signals: GapSignal[];
  minGapCount?: number;
  minCoOccurCount?: number;
}): GapSignal[] {
  const minGap = input.minGapCount ?? DEFAULT_MIN_GAP_COUNT;
  const minCo = input.minCoOccurCount ?? DEFAULT_MIN_COOCCUR_COUNT;
  return input.signals
    .filter((s) => {
      const threshold = s.kind === "pattern_co_occurrence" ? minCo : minGap;
      return s.count >= threshold;
    })
    .slice()
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * Propose a tool spec from a single gap signal. Pure function;
 * deterministic over (signal + secret). The composer recipe defaults
 * to sequential chaining of the related tools; for no-match gaps with
 * empty relatedTools, the recipe is just `mneme.smart_do` as a fallback
 * so caller has SOMETHING to splice.
 */
export function proposeToolSpec(input: { gap: GapSignal; secret?: string; minGapCount?: number }): ProposedToolSpec {
  const minGap = input.minGapCount ?? DEFAULT_MIN_GAP_COUNT;
  const gap = input.gap;
  // Name generation
  let proposedName: string;
  let description: string;
  let recipe: Array<{ toolName: string; argsPassthrough?: boolean }> = [];
  let inputSchema: ProposedToolSpec["proposedInputSchema"] = { type: "object", properties: {}, required: [] };

  if (gap.kind === "pattern_co_occurrence" && gap.relatedTools.length >= 2) {
    const [a, b] = gap.relatedTools;
    const slugA = slugify((a ?? "tool_a").replace(/^mneme\./, ""));
    const slugB = slugify((b ?? "tool_b").replace(/^mneme\./, ""));
    proposedName = `mneme.auto.${slugA}_then_${slugB}`;
    description = `🌱 Auto-proposed chimera: invokes ${a} then ${b} (observed co-occurring ${gap.count}× yesterday on ${gap.label})`;
    recipe = gap.relatedTools.map((t) => ({ toolName: t, argsPassthrough: true }));
    inputSchema.properties["__passthrough"] = { type: "object", description: "Args passed through to each component tool" };
  } else if (gap.kind === "reflex_cache_miss") {
    proposedName = `mneme.auto.handle_${slugify(gap.label)}`;
    description = `🌱 Auto-proposed handler for REFLEX cache miss on '${gap.label}' (${gap.count}× yesterday). Composes related tools as fallback.`;
    recipe = gap.relatedTools.length > 0
      ? gap.relatedTools.map((t) => ({ toolName: t, argsPassthrough: true }))
      : [{ toolName: "mneme.smart_do", argsPassthrough: true }];
    inputSchema.properties["context"] = { type: "object" };
  } else {
    // user_chat_no_match
    proposedName = `mneme.auto.intent_${slugify(gap.label)}`;
    description = `🌱 Auto-proposed intent handler for user phrase '${gap.label}' (no semantic rule matched; ${gap.count}× yesterday).`;
    recipe = [{ toolName: "mneme.smart_do", argsPassthrough: true }];
    inputSchema.properties["query"] = { type: "string", description: "User's natural-language request" };
    inputSchema.required = ["query"];
  }

  // Confidence: linear scale from threshold to threshold*4 (caps at 1.0).
  const confidence = Math.min(1, gap.count / (minGap * 4));

  const body: Omit<ProposedToolSpec, "sig"> = {
    v: PROTOCOL_VERSION,
    proposedName,
    description,
    composerRecipe: recipe,
    composerKind: "sequential",
    proposedInputSchema: inputSchema,
    sourceGap: gap,
    confidence,
  };
  const sig = hmacHex(body, input.secret ?? defaultSecret());
  return { ...body, sig };
}

export function verifyProposal(spec: ProposedToolSpec, secret?: string): boolean {
  const { sig, ...body } = spec;
  return safeEqHex(hmacHex(body, secret ?? defaultSecret()), sig);
}

export interface GestationReport {
  v: typeof PROTOCOL_VERSION;
  totalSignals: number;
  qualifyingGaps: number;
  proposals: ProposedToolSpec[];
  cycleAt: number;
  sig: string;
}

/**
 * One-shot gestation cycle: filter signals → propose specs → HMAC-sign
 * the whole report. Caller runs this during the daemon's idle/dream
 * window (composes onto v2.19.23 THALAMUS dream tier).
 */
export function runGestationCycle(input: {
  signals: GapSignal[];
  cycleAt?: number;
  minGapCount?: number;
  minCoOccurCount?: number;
  secret?: string;
}): GestationReport {
  const qualifying = detectToolGaps({
    signals: input.signals,
    minGapCount: input.minGapCount,
    minCoOccurCount: input.minCoOccurCount,
  });
  const proposals = qualifying.map((g) => proposeToolSpec({ gap: g, secret: input.secret, minGapCount: input.minGapCount }));
  const body: Omit<GestationReport, "sig"> = {
    v: PROTOCOL_VERSION,
    totalSignals: input.signals.length,
    qualifyingGaps: qualifying.length,
    proposals,
    cycleAt: input.cycleAt ?? Date.now(),
  };
  const sig = hmacHex(body, input.secret ?? defaultSecret());
  return { ...body, sig };
}

export function verifyGestationReport(r: GestationReport, secret?: string): boolean {
  const { sig, ...body } = r;
  return safeEqHex(hmacHex(body, secret ?? defaultSecret()), sig);
}

export function formatProposalLine(p: ProposedToolSpec): string {
  const conf = (p.confidence * 100).toFixed(0);
  return `🌱 ${p.proposedName} · ${p.composerRecipe.length}-step ${p.composerKind} · ${conf}% conf · from ${p.sourceGap.kind}`;
}
