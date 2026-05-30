/**
 * v2.111.0 — MNEME DISTILL (Signed Token-Budget Receipt / "send the signal,
 * not the raw logs").
 *
 * THE PROBLEM (the "950 thinking tokens" screenshot): every loop, an agent
 * re-feeds the model a verbose blob — a 2 KB error log + a full diff + file
 * dumps — and the model burns context (and reasoning) re-finding the one
 * causal fact. Mneme already KNOWS how to find that fact deterministically
 * (Logpipe extraction + Cortex recall). DISTILL turns that into the minimal
 * high-signal BRIEF the model actually needs, and — the honest part no one
 * else does — emits a MEASURED, signable receipt of the reduction.
 *
 * HONESTY (DIAKRISIS — what this is NOT):
 *   - NOT a "990/1000 wisdom" / "Sorcerer Supreme" score. Those are
 *     unmeasurable marketing. We report only what we can MEASURE per call.
 *   - The token figure is an EXPLICIT estimate (≈ chars/4 — a documented
 *     heuristic, NOT a vendor BPE tokenizer). The CHARACTER reduction is
 *     exact; the reduction RATIO is robust regardless of tokenizer. We never
 *     promise "<500 tokens" — we report the real before/after for THIS input.
 *   - It cannot reduce the model's internal chain-of-thought (that's the
 *     model's, not ours). It reduces the INPUT context you feed the model —
 *     which is the part Mneme can measure and prove.
 *
 * The brief is lossy BY DESIGN (drops noise, keeps the causal signal) — the
 * opposite of HYDRA (lossless codebook). Pure + total (108-error rule):
 * deterministic, no LLM, no I/O, never throws. CLI/MCP own recall + signing.
 */

import { extractLogEntry } from "../logpipe/index.js";

/** Documented heuristic token estimate. NOT a vendor tokenizer — a stable
 *  ≈chars/4 proxy. The reduction RATIO is what matters and is tokenizer-robust. */
export function estimateTokens(text: string): number {
  const s = typeof text === "string" ? text : "";
  if (s.length === 0) return 0;
  // chars/4 is the widely-cited English-text proxy; clamp to >=1 for non-empty.
  return Math.max(1, Math.round(s.length / 4));
}

/** Extract the causal loci from a unified diff: changed files + first hunk
 *  line number each. Deterministic; tolerant of malformed diffs. */
export function extractDiffLoci(diff: string): Array<{ file: string; line: number | null }> {
  const out: Array<{ file: string; line: number | null }> = [];
  if (typeof diff !== "string" || !diff) return out;
  let cur: string | null = null;
  let pushedLineFor: string | null = null;
  for (const raw of diff.split(/\r?\n/)) {
    // "+++ b/path/to/file.ts"  (prefer the new path)
    const plus = /^\+\+\+ (?:b\/)?(.+)$/.exec(raw);
    if (plus && plus[1] && plus[1] !== "/dev/null") {
      cur = plus[1].trim();
      out.push({ file: cur, line: null });
      pushedLineFor = null;
      continue;
    }
    // "@@ -a,b +c,d @@"  → take c (new-side start line) for the current file
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk && cur && pushedLineFor !== cur) {
      const entry = out[out.length - 1];
      if (entry && entry.file === cur && entry.line === null) entry.line = parseInt(hunk[1]!, 10);
      pushedLineFor = cur;
    }
  }
  return out;
}

export interface DistillInput {
  command?: string;
  output?: string;     // the raw error/stdout log
  exitCode?: number;
  diff?: string;       // a unified diff of the change under test
  /** optional: a known recovery/axiom for the failure signature (CLI/MCP wires
   *  this to the Cortex; pure here). */
  recall?: (signature: string) => string | null;
}

export interface DistillMeasured {
  charsBefore: number;
  charsAfter: number;
  /** exact character reduction, 0..100, one decimal. */
  reductionPct: number;
  /** explicit ≈chars/4 estimates (labeled — not a vendor tokenizer). */
  tokEstBefore: number;
  tokEstAfter: number;
  tokEstSaved: number;
  note: string;
}

export interface DistillResult {
  brief: string;
  signature: string;
  hadError: boolean;
  lines: string[];
  measured: DistillMeasured;
}

/**
 * Distill a verbose {error log + diff} into the minimal causal brief an agent
 * needs, and measure the reduction. Deterministic + total. */
export function distill(input: DistillInput): DistillResult {
  try {
    const inp = input ?? {};
    const command = typeof inp.command === "string" ? inp.command : "";
    const output = typeof inp.output === "string" ? inp.output : "";
    const diff = typeof inp.diff === "string" ? inp.diff : "";
    const exitCode = Number.isFinite(inp.exitCode as number) ? (inp.exitCode as number) : NaN;

    const entry = extractLogEntry(command, output, exitCode);
    const lines: string[] = [];

    // 1) the causal one-liner (signal, not the whole log)
    if (entry.hadError) {
      lines.push(`FAIL ${entry.intent}${entry.errorClass ? ` [${entry.errorClass}]` : ""}`);
      if (entry.excerpt) lines.push(`  ↳ ${entry.excerpt}`);
    } else if (command) {
      lines.push(`OK ${entry.intent}`);
    }

    // 2) the change loci (files + first hunk line), not the whole diff
    const loci = extractDiffLoci(diff);
    if (loci.length > 0) {
      const locStr = loci.slice(0, 8).map((l) => (l.line ? `${l.file}:L${l.line}` : l.file)).join(", ");
      lines.push(`CHANGED ${locStr}${loci.length > 8 ? ` (+${loci.length - 8} more)` : ""}`);
    }

    // 3) what's already KNOWN (recalled — so the agent doesn't re-derive)
    if (entry.hadError && typeof inp.recall === "function" && entry.signature) {
      let known: string | null = null;
      try { known = inp.recall(entry.signature); } catch { known = null; }
      if (known) lines.push(`KNOWN FIX ${known}`);
    }

    const brief = lines.join("\n");
    const rawBlob = [command, output, diff].filter(Boolean).join("\n");
    const charsBefore = rawBlob.length;
    const charsAfter = brief.length;
    const reductionPct = charsBefore > 0
      ? Math.round((1 - charsAfter / charsBefore) * 1000) / 10
      : 0;
    const tokEstBefore = estimateTokens(rawBlob);
    const tokEstAfter = estimateTokens(brief);

    return {
      brief,
      signature: entry.signature,
      hadError: entry.hadError,
      lines,
      measured: {
        charsBefore, charsAfter, reductionPct,
        tokEstBefore, tokEstAfter, tokEstSaved: Math.max(0, tokEstBefore - tokEstAfter),
        note: "token figures are an explicit ≈chars/4 estimate (not a vendor BPE tokenizer); the character reduction is exact",
      },
    };
  } catch {
    return {
      brief: "", signature: "", hadError: false, lines: [],
      measured: { charsBefore: 0, charsAfter: 0, reductionPct: 0, tokEstBefore: 0, tokEstAfter: 0, tokEstSaved: 0, note: "engine error (safe)" },
    };
  }
}

export interface DistillGauntlet {
  /** the brief is strictly smaller than the raw blob on a verbose input. */
  reduces: boolean;
  /** the measured reduction is reported honestly (0..100, matches the chars). */
  measurementHonest: boolean;
  /** the causal signal (error class + changed file) survives into the brief. */
  preservesSignal: boolean;
  /** a recalled known-fix is folded into the brief. */
  foldsKnownFix: boolean;
  /** deterministic: same input → same brief + same numbers. */
  deterministic: boolean;
  /** total on garbage. */
  stable: boolean;
  score: number;
}

/** Prove the distiller on a fixed verbose sample. Total + deterministic. */
export function distillGauntlet(): DistillGauntlet {
  try {
    const output = [
      "Traceback (most recent call last):",
      '  File "train.py", line 88, in <module>',
      "    model.fit(loader)",
      "  ... 40 more frames of stack ...",
      "RuntimeError: CUDA out of memory. Tried to allocate 2.00 GiB",
    ].join("\n") + "\n" + "noise line ".repeat(80);
    const diff = [
      "diff --git a/train.py b/train.py",
      "--- a/train.py",
      "+++ b/train.py",
      "@@ -85,6 +85,7 @@ def main():",
      "     loader = make_loader(batch=512)",
      "+    model = model.cuda()",
      "diff --git a/cfg.py b/cfg.py",
      "--- a/cfg.py",
      "+++ b/cfg.py",
      "@@ -10,3 +12,3 @@",
      "-batch = 256",
      "+batch = 512",
    ].join("\n");
    // recall is keyed by the failure SIGNATURE (the same key absorb stores
    // under in the Cortex), exactly as the CLI/MCP wire it.
    const recall = (sig: string) => (sig && sig.length > 0 ? "lower batch size / torch.cuda.empty_cache()" : null);
    const r = distill({ command: "python train.py", output, exitCode: 1, diff, recall });

    const reduces = r.measured.charsAfter < r.measured.charsBefore && r.measured.charsAfter > 0;
    const measurementHonest = r.measured.reductionPct > 0
      && r.measured.reductionPct === Math.round((1 - r.measured.charsAfter / r.measured.charsBefore) * 1000) / 10
      && r.measured.charsAfter === r.brief.length;
    const preservesSignal = r.brief.includes("oom") && r.brief.includes("train.py:L85");
    const foldsKnownFix = r.brief.includes("KNOWN FIX") && r.brief.includes("empty_cache");
    const r2 = distill({ command: "python train.py", output, exitCode: 1, diff, recall });
    const deterministic = JSON.stringify(r) === JSON.stringify(r2);

    let stable = true;
    try {
      distill(null as never);
      distill({ output: null as never, diff: null as never });
      extractDiffLoci(null as never);
      estimateTokens(null as never);
    } catch { stable = false; }

    const perfect = reduces && measurementHonest && preservesSignal && foldsKnownFix && deterministic && stable;
    return { reduces, measurementHonest, preservesSignal, foldsKnownFix, deterministic, stable, score: perfect ? 100 : 0 };
  } catch {
    return { reduces: false, measurementHonest: false, preservesSignal: false, foldsKnownFix: false, deterministic: false, stable: false, score: 0 };
  }
}
