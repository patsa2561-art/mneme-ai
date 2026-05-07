/**
 * Shared `--explain` plumbing.
 *
 * Three flagship commands (`audit --certify`, `atrophy`, `nervous-system`)
 * accept an OPTIONAL `--explain` flag. When set, we send the structured data
 * to the user's already-configured free LLM (via ResilientEnricher) and ask
 * for a ~3-sentence plain-English narrative. The narrative is rendered ABOVE
 * the existing tables — readers see the headline read first, then verify it
 * against the underlying numbers.
 *
 * Honest framing: the narrative IS LLM-generated. We mark it explicitly with
 * the `💡 Plain-English read (LLM)` headline so a reader never confuses the
 * synthesized prose with the raw data.
 *
 * Failure mode: if no LLM is reachable, we silently skip the narrative and
 * surface a single HEADS UP line pointing at `mneme setup-free`. Never throws.
 */

import { resolveAllEnrichers, ResilientEnricher, type EnricherProvider } from "@mneme-ai/embeddings";
import type { PyramidSection } from "../iris/index.js";
import { pill } from "../ui.js";
import kleur from "kleur";

export interface ExplainResult {
  /** A pyramid section to prepend to the command's output, or null if --explain
   *  was not set or the command opted out. */
  section: PyramidSection | null;
  /** A heads-up line to prepend when --explain was set but no LLM is reachable. */
  headsUp: string | null;
}

export interface ExplainRequest {
  /** Whether the caller passed `--explain`. */
  enabled: boolean;
  /** System-style instruction (rules + persona). */
  system: string;
  /** User-style request (the actual question + structured data). */
  user: string;
  /** Soft cap on output tokens — narratives should be ~3 sentences. */
  maxTokens?: number;
  /** Override the resolver — tests inject a stub here. */
  enricherFactory?: () => Promise<EnricherProvider | null>;
}

const DEFAULT_MAX_TOKENS = 220;

/**
 * Generate a plain-English narrative for one of the flagship commands.
 *
 * Returns `{ section: null, headsUp: null }` when `enabled` is false.
 * Returns `{ section: null, headsUp: "..." }` when no LLM provider is reachable.
 * Returns `{ section: <PyramidSection>, headsUp: null }` on success.
 */
export async function explain(req: ExplainRequest): Promise<ExplainResult> {
  if (!req.enabled) return { section: null, headsUp: null };

  let enricher: EnricherProvider | null = null;
  try {
    if (req.enricherFactory) {
      enricher = await req.enricherFactory();
    } else {
      const chain = await resolveAllEnrichers();
      enricher = chain.length > 0 ? new ResilientEnricher(chain) : null;
    }
  } catch {
    enricher = null;
  }

  if (!enricher) {
    return {
      section: null,
      headsUp:
        pill("HEADS UP", "warn") +
        " " +
        kleur.gray(
          "--explain needs a free LLM provider; run 'mneme setup-free' once.",
        ),
    };
  }

  let text = "";
  try {
    const result = await enricher.enrich({
      system: req.system,
      user: req.user,
      maxTokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: 0.2,
    });
    text = (result.text ?? "").trim();
  } catch {
    return {
      section: null,
      headsUp:
        pill("HEADS UP", "warn") +
        " " +
        kleur.gray(
          "--explain failed — every configured LLM provider is unreachable or in cooldown.",
        ),
    };
  }

  if (!text) {
    return {
      section: null,
      headsUp:
        pill("HEADS UP", "warn") +
        " " +
        kleur.gray("--explain returned an empty answer; falling back to data-only output."),
    };
  }

  // Render the narrative as a top-tier section. We intentionally leave the
  // headline outside the section (it's set on the PyramidInput by the caller)
  // and tag the section title so readers KNOW this is LLM-synthesized.
  const lines = wrapToLines(text, 76).map((l) => `  ${kleur.gray(l)}`);
  return {
    section: {
      tier: "lede",
      title: "💡 Plain-English read (LLM)",
      lines,
    },
    headsUp: null,
  };
}

/**
 * Soft-wrap a paragraph into <= width-char lines on word boundaries.
 * No fancy hyphenation — readability over typography.
 */
function wrapToLines(text: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    const words = paragraph.trim().split(/\s+/);
    let line = "";
    for (const w of words) {
      if (line.length === 0) {
        line = w;
      } else if (line.length + 1 + w.length <= width) {
        line += " " + w;
      } else {
        out.push(line);
        line = w;
      }
    }
    if (line.length > 0) out.push(line);
  }
  return out;
}
