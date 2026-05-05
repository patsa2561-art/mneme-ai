/**
 * `mneme paradox` — find architectural flip-flops in commit history.
 *
 * A "flip-flop" is a chain of decisions on the same topic where the
 * direction reverses: A → B → A. This usually means the team forgot
 * (or never wrote down) WHY they made the original decision.
 *
 * Implementation: walk decisions chronologically, group by topic
 * (heuristically clustered by key terms), and detect ABA-style
 * chains. Conservative — only emit when confidence is high that
 * the decisions are actually about the same thing.
 *
 * Pure data analysis. No LLM. The CLI renders.
 */

import type { ExtractedDecision } from "./decisions.js";

export interface FlipFlop {
  /** Topic label — extracted from the shared keyword(s). */
  topic: string;
  /** The chain of decisions, oldest first. */
  chain: ExtractedDecision[];
  /** How many direction reversals (0 = no flip, 1 = one flip, 2 = ABA). */
  flips: number;
  /** Months between first and last decision in the chain. */
  spanMonths: number;
  /** A 1-line interpretation. */
  question: string;
}

/**
 * Stop-words that should NOT count as "topic" — too generic.
 * Add to this set when noise topics appear in real-world repos.
 */
const TOPIC_STOPWORDS = new Set([
  "the", "a", "an", "to", "from", "for", "with", "of", "in", "on", "at",
  "and", "or", "but", "is", "are", "was", "were",
  "use", "used", "using", "make", "made",
  "new", "old", "all", "more", "less",
  "code", "thing", "stuff", "function", "method", "class", "module",
  "version", "feature", "patch",
]);

/**
 * Extract topic keywords from a decision summary. Keeps only the
 * meaningful nouns/identifiers (filtering verbs and stop-words).
 */
function extractTopicKeywords(summary: string): string[] {
  const lower = summary.toLowerCase();
  // Tokenize: split on non-alphanumeric, keep words ≥ 3 chars.
  const tokens = lower
    .replace(/[^\w\s./-]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !TOPIC_STOPWORDS.has(t));
  // Also exclude transition verbs that won't help cluster.
  const VERB_BLOCKLIST = new Set([
    "decided", "switch", "switched", "switching", "from",
    "replace", "replaced", "with", "over", "instead",
    "adopt", "adopted", "adopting",
    "deprecate", "deprecated", "deprecating",
    "migrate", "migrated", "migrating",
    "reject", "rejected",
    "choose", "chose", "chosen",
  ]);
  return tokens.filter((t) => !VERB_BLOCKLIST.has(t));
}

/**
 * Group decisions by overlapping topic keywords. Two decisions belong
 * to the same group if they share ≥ 1 meaningful keyword.
 */
function groupByTopic(decisions: ExtractedDecision[]): Map<string, ExtractedDecision[]> {
  const decisionKeywords = decisions.map((d) => ({
    decision: d,
    keywords: new Set(extractTopicKeywords(d.summary)),
  }));

  // Union-find by shared keyword.
  const groups: Array<{ keywords: Set<string>; decisions: ExtractedDecision[] }> = [];

  for (const item of decisionKeywords) {
    let placed = false;
    for (const g of groups) {
      // Share at least one keyword?
      let shared = false;
      for (const k of item.keywords) {
        if (g.keywords.has(k)) {
          shared = true;
          break;
        }
      }
      if (shared) {
        g.decisions.push(item.decision);
        for (const k of item.keywords) g.keywords.add(k);
        placed = true;
        break;
      }
    }
    if (!placed) {
      groups.push({ keywords: new Set(item.keywords), decisions: [item.decision] });
    }
  }

  // Pick a label per group — the keyword that appears in the most decisions
  // of the group (the "common thread"). Ties broken by length.
  const out = new Map<string, ExtractedDecision[]>();
  for (const g of groups) {
    if (g.decisions.length < 2) continue; // need at least 2 decisions to flip
    const label = pickLabel(g.decisions);
    if (out.has(label)) {
      // Merge into existing — multiple groups can hash to the same label.
      out.get(label)!.push(...g.decisions);
    } else {
      out.set(label, g.decisions);
    }
  }
  return out;
}

/** Label = the keyword that occurs in the most decisions of the chain. */
function pickLabel(decisions: ExtractedDecision[]): string {
  const freq = new Map<string, number>();
  for (const d of decisions) {
    const kws = new Set(extractTopicKeywords(d.summary));
    for (const k of kws) freq.set(k, (freq.get(k) ?? 0) + 1);
  }
  if (freq.size === 0) return "(unnamed)";
  return [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]![0];
}

/**
 * Extract the *destination* keywords of a decision — the noun being
 * switched/decided TO. This is the "side" that the decision is choosing.
 *
 * For "switched from X to Y" we want Y.
 * For "decided to use Z" we want Z.
 * For "adopted W" we want W.
 */
function destinationKeywords(d: ExtractedDecision): Set<string> {
  const summary = d.summary.toLowerCase();
  // Match the LAST " to X" clause (closest to end of string).
  // Pattern: "to" surrounded by spaces, then everything to end.
  const toMatch = summary.match(/\bto\s+(.+)$/);
  if (toMatch) {
    return new Set(extractTopicKeywords(toMatch[1]!));
  }
  // No "to" — fall back to keywords from the whole summary.
  return new Set(extractTopicKeywords(summary));
}

/**
 * Count flips in a chronologically-sorted decision chain.
 *
 * A "flip" is an ABA pattern — at index i, a destination keyword X appears,
 * disappears in i+1, and reappears in i+2. The team chose X, switched away,
 * then went back. That's exactly the "we keep flip-flopping" anti-pattern.
 */
function countFlips(chain: ExtractedDecision[]): number {
  if (chain.length < 3) return 0;
  const dests = chain.map(destinationKeywords);
  let flips = 0;
  for (let i = 0; i < dests.length - 2; i++) {
    const a = dests[i]!;
    const b = dests[i + 1]!;
    const c = dests[i + 2]!;
    let flipFound = false;
    for (const k of a) {
      if (!b.has(k) && c.has(k)) {
        flipFound = true;
        break;
      }
    }
    if (flipFound) flips += 1;
  }
  return flips;
}

/**
 * Detect flip-flops across a list of decisions.
 *
 * Returns groups with ≥ 1 flip — the actual paradoxes worth investigating.
 * Groups with 2+ decisions but no flips (just continuous progress) are
 * suppressed.
 */
export function detectParadoxes(decisions: ExtractedDecision[]): FlipFlop[] {
  if (decisions.length < 2) return [];

  const sorted = [...decisions].sort((a, b) => a.date.localeCompare(b.date));
  const groups = groupByTopic(sorted);

  const flipFlops: FlipFlop[] = [];
  for (const [topic, chain] of groups) {
    if (chain.length < 3) continue; // ABA needs 3 decisions minimum
    const flips = countFlips(chain);
    if (flips === 0) continue;

    const fromDate = new Date(chain[0]!.date);
    const toDate = new Date(chain[chain.length - 1]!.date);
    const spanMonths = (toDate.getTime() - fromDate.getTime()) / (30 * 86_400_000);

    flipFlops.push({
      topic,
      chain,
      flips,
      spanMonths: Math.round(spanMonths * 10) / 10,
      question: buildQuestion(topic, chain, flips),
    });
  }

  flipFlops.sort((a, b) => b.flips - a.flips || b.spanMonths - a.spanMonths);
  return flipFlops;
}

function buildQuestion(topic: string, chain: ExtractedDecision[], flips: number): string {
  const months = Math.round(
    (new Date(chain[chain.length - 1]!.date).getTime() - new Date(chain[0]!.date).getTime()) /
      (30 * 86_400_000),
  );
  if (flips >= 2) {
    return `${flips} reversals in ${months} months — write an ADR before the next change.`;
  }
  return `One reversal in ${months} months — was the prior decision a mistake, or did context change?`;
}
