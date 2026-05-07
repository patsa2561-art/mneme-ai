/**
 * Iris — Inverted-Pyramid Renderer.
 *
 * The journalist's rule: most-important first. A user must be able to scan
 * the first 5 lines of any Mneme command output and know what happened.
 *
 * Pure functions. No I/O. Width-aware (reads `process.stdout.columns`).
 *
 * Tier ordering is fixed:
 *   lede → key-facts → body → sources → details
 *
 * `details` tier is collapsed into a "▼ N more (run with --verbose)" marker
 * unless the caller passes `verbose: true`.
 */

import kleur from "kleur";

export type PyramidTier = "lede" | "key-facts" | "body" | "sources" | "details";

export interface PyramidSection {
  /** Section heading. e.g. "✦ Findings", "📘 How to read". */
  title?: string;
  /** Tier of importance — top tier shown first; "details" deferred to bottom. */
  tier: PyramidTier;
  /** Body lines (already kleur-styled). */
  lines: string[];
}

export interface PyramidInput {
  /** ~1-line top headline. Caller embeds icon prefix (📰, 🛡, etc.). */
  headline: string;
  /** Sections, in any order — Iris sorts by tier. */
  sections: PyramidSection[];
  /** Optional 1-line "WHY am I showing you this?" footer. */
  whyShown?: string;
  /** When true, `details` tier rendered fully instead of collapsed. */
  verbose?: boolean;
  /** Override terminal width detection (mostly for tests). */
  widthOverride?: number;
}

const TIER_ORDER: PyramidTier[] = ["lede", "key-facts", "body", "sources", "details"];

const DEFAULT_WIDTH = 72;
const MIN_WIDTH = 40;
const MAX_WIDTH = 120;

/**
 * Detect terminal width.
 *
 * Why this is gated:  When stdout isn't a TTY (CI, pipes, tests),
 * `process.stdout.columns` is undefined and we want a stable 72-col render.
 */
function detectWidth(override?: number): number {
  if (override != null) return clampWidth(override);
  const cols = process.stdout.columns;
  if (typeof cols !== "number" || cols <= 0) return DEFAULT_WIDTH;
  return clampWidth(cols);
}

function clampWidth(w: number): number {
  if (w < MIN_WIDTH) return MIN_WIDTH;
  if (w > MAX_WIDTH) return MAX_WIDTH;
  return w;
}

/** ANSI escape stripping — used for width math. */
const ANSI_RE = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x1b]*\x1b\\/g;
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

function visibleLength(s: string): number {
  return stripAnsi(s).length;
}

/**
 * Hard-wrap a single line so visible width never exceeds `width`.
 * Pure: never modifies kleur escape sequences (treats them as zero-width).
 *
 * Strategy: walk by codepoint, push to current line; on a space past width,
 * break. For words longer than `width`, break mid-word.
 */
function wrapLine(line: string, width: number, indent = ""): string[] {
  if (visibleLength(line) <= width) return [line];
  // Crude but effective: split on spaces, rebuild greedily.
  const out: string[] = [];
  const words = line.split(/(\s+)/); // keep separators so we can re-emit them
  let current = "";
  let currentVisible = 0;
  for (const w of words) {
    const wv = visibleLength(w);
    if (currentVisible + wv > width && current.trim().length > 0) {
      out.push(current.trimEnd());
      current = indent + (w.trim() ? w : "");
      currentVisible = visibleLength(current);
      continue;
    }
    current += w;
    currentVisible += wv;
  }
  if (current.trim().length > 0) out.push(current.trimEnd());
  return out;
}

function renderHeadline(headline: string, width: number): string[] {
  const styled = kleur.bold().cyan(headline);
  const wrapped = wrapLine(`  ${styled}`, width, "  ");
  return wrapped;
}

function renderSection(section: PyramidSection, width: number): string[] {
  const out: string[] = [];
  if (section.title) {
    out.push(`  ${kleur.bold().magenta(section.title)}`);
  }
  for (const raw of section.lines) {
    // Caller is responsible for line indent; we still wrap to width.
    for (const wrapped of wrapLine(raw, width, "    ")) {
      out.push(wrapped);
    }
  }
  return out;
}

/** Render the inverted-pyramid layout. */
export function renderPyramid(input: PyramidInput): string {
  const width = detectWidth(input.widthOverride);
  const out: string[] = [];

  // 1. Headline always first.
  out.push("");
  out.push(...renderHeadline(input.headline, width));
  out.push("");

  // 2. Sort sections by tier.
  const grouped = new Map<PyramidTier, PyramidSection[]>();
  for (const t of TIER_ORDER) grouped.set(t, []);
  for (const s of input.sections) {
    const list = grouped.get(s.tier);
    if (list) list.push(s);
  }

  // 3. Render each tier in order, except `details` (collapsed unless verbose).
  for (const tier of TIER_ORDER) {
    if (tier === "details") continue;
    const sections = grouped.get(tier) ?? [];
    for (const s of sections) {
      out.push(...renderSection(s, width));
      out.push("");
    }
  }

  // 4. Details handling — collapsed marker or full render.
  const detailSections = grouped.get("details") ?? [];
  if (detailSections.length > 0) {
    if (input.verbose) {
      for (const s of detailSections) {
        out.push(...renderSection(s, width));
        out.push("");
      }
    } else {
      const totalLines = detailSections.reduce(
        (acc, s) => acc + s.lines.length + (s.title ? 1 : 0),
        0,
      );
      out.push(
        `  ${kleur.gray("▼")} ${kleur.gray(
          `${totalLines} more line${totalLines === 1 ? "" : "s"} (run with --verbose)`,
        )}`,
      );
      out.push("");
    }
  }

  // 5. Optional "why am I seeing this?" footer.
  if (input.whyShown) {
    out.push(`  ${kleur.gray("ⓘ")} ${kleur.gray(input.whyShown)}`);
    out.push("");
  }

  // Trim trailing blank lines down to one.
  while (out.length > 1 && out[out.length - 1] === "" && out[out.length - 2] === "") {
    out.pop();
  }
  return out.join("\n");
}

/** Convenience: render a flat list of lines under one tier. */
export function singleSection(
  tier: PyramidTier,
  title: string | undefined,
  lines: string[],
): PyramidSection {
  return { tier, title, lines };
}
