/**
 * Tiered tool descriptions — mitigates the "token cost balloon" weakness (W7).
 *
 * Problem: Mneme can ship 100+ MCP tools (98 static + dynamic + augmented).
 * Each tool's description carries tribal-knowledge facts (canonical paths,
 * deprecated paths, expert authors, incidents, constitution rules). When
 * the AI client runs `tools/list` cold-start, it loads everything.
 *
 *   100 tools × ~600 chars = ~60k chars / ~15k tokens — every session.
 *
 * Solution: tiered loading.
 *   • SHORT  — ~120 chars per tool. Just enough for tool-selection.
 *   • LONG   — full description with tribal-knowledge augmentation.
 *
 * `tools/list` returns SHORT by default. AI client calls
 * `mneme.tool_detail.<name>` when it actually wants the long form.
 *
 * Pure function. No I/O. Same input → same output.
 */

export interface TieredOutput {
  /** Short ≤ maxShortChars (default 120). Used in tools/list. */
  short: string;
  /** Long unchanged from input. Used by mneme.tool_detail.<name>. */
  long: string;
  /** Was the input truncated to make `short`? */
  truncated: boolean;
  /** Per-tier byte counts (utf-8) for telemetry. */
  bytes: { short: number; long: number };
}

const DEFAULT_MAX_SHORT = 120;

/**
 * Compress a long tool description into a short form suitable for the
 * `tools/list` response. The compression is deterministic and tries to
 * keep the most informative leading sentence.
 *
 * Strategy:
 *   1. Strip every line starting with the augmentation prefixes (📍, ❌,
 *      👤, 🚨, 📜) — those carry tribal-knowledge that the AI can fetch
 *      on-demand.
 *   2. Take the first sentence (up to first ".").
 *   3. Truncate to maxShortChars with an ellipsis if still too long.
 */
export function tierize(longDescription: string, maxShortChars: number = DEFAULT_MAX_SHORT): TieredOutput {
  const long = longDescription;
  if (typeof long !== "string") {
    return { short: "", long: "", truncated: false, bytes: { short: 0, long: 0 } };
  }

  // Strip augmentation lines (anything starting with our marker emoji)
  const AUG_PREFIXES = ["📍", "❌", "👤", "🚨", "📜"];
  const cleanLines = long.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    if (trimmed === "") return false;
    return !AUG_PREFIXES.some((p) => trimmed.startsWith(p));
  });
  const cleaned = cleanLines.join(" ").replace(/\s+/g, " ").trim();

  // Take the first sentence
  const firstDotIdx = cleaned.indexOf(". ");
  const firstSentence = firstDotIdx > 0 ? cleaned.slice(0, firstDotIdx + 1) : cleaned;

  let short = firstSentence;
  let truncated = false;
  if (short.length > maxShortChars) {
    short = short.slice(0, maxShortChars - 1).trimEnd() + "…";
    truncated = true;
  }

  const encoder = new TextEncoder();
  return {
    short,
    long,
    truncated,
    bytes: {
      short: encoder.encode(short).length,
      long: encoder.encode(long).length,
    },
  };
}

/** Compute the byte savings of using SHORT instead of LONG across tools. */
export interface SavingsReport {
  toolCount: number;
  longTotalBytes: number;
  shortTotalBytes: number;
  savedBytes: number;
  savedPct: number;
}

export function computeSavings(descriptions: string[]): SavingsReport {
  const encoder = new TextEncoder();
  let longTotal = 0;
  let shortTotal = 0;
  for (const d of descriptions) {
    const t = tierize(d);
    longTotal += encoder.encode(d).length;
    shortTotal += t.bytes.short;
  }
  const saved = longTotal - shortTotal;
  return {
    toolCount: descriptions.length,
    longTotalBytes: longTotal,
    shortTotalBytes: shortTotal,
    savedBytes: saved,
    savedPct: longTotal === 0 ? 0 : saved / longTotal,
  };
}
