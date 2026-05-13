/**
 * v2.0.0 -- MUTINY MODE · the AI with a spine
 *
 *   User: "use Redis for sessions"
 *   Vanilla AI: "great idea! here's a config..."
 *   Mneme MUTINY: "WAIT — 6 months ago you rage-quit Redis because of
 *                  a memory leak (incident 2026-03-14, commit a3f9b21).
 *                  Acknowledge you've changed your mind, or I refuse."
 *
 * AI agents today are sycophantic by design — they say yes because
 * that's what RLHF trained. Mneme inverts: when a user request matches
 * a documented regret pattern, MUTINY blocks the request until the
 * user EXPLICITLY acknowledges the historical pain.
 *
 * Pure function. Pattern-matching only, no LLM in the hot path.
 * Backward compatible — composes with existing regret history /
 * chromosomes / insights.regret modules.
 */

export interface RegretRecord {
  id: string;
  ts: number;
  /** What the user committed to / rejected previously. */
  topic: string;
  /** Keywords / synonyms that should ALSO trigger this regret. */
  matchKeywords: string[];
  /** Human-readable narrative — what went wrong. */
  story: string;
  /** Severity 0..1; higher = stronger refusal. */
  severity: number;
  /** Optional commit / incident id for the audit log. */
  scope?: string;
}

export type MutinyVerdict = "approved" | "warn" | "block";

export interface MutinyResult {
  verdict: MutinyVerdict;
  matchedRegrets: RegretRecord[];
  /** What the AI should say to the user. */
  message: string;
  /** What the AI should ASK the user before proceeding (when warn/block). */
  acknowledgementRequired?: string;
  /** Severity score of the strongest matching regret. */
  severity: number;
}

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFC").replace(/[​‌‍﻿]/g, "");
}

/** Does the user's request mention any of the regret's keywords? */
function matchesRegret(request: string, regret: RegretRecord): boolean {
  const r = normalize(request);
  // Topic itself counts as a keyword
  const all = [...regret.matchKeywords, regret.topic];
  return all.some((k) => r.includes(normalize(k)));
}

export interface EvaluateInput {
  /** The user's current request — free text. */
  request: string;
  /** The user's documented regret history. */
  regretHistory: readonly RegretRecord[];
  /** Optional acknowledgement the user has typed to override a previous block. */
  acknowledgement?: string;
}

export function evaluateRequest(input: EvaluateInput): MutinyResult {
  const matched = input.regretHistory.filter((r) => matchesRegret(input.request, r));

  if (matched.length === 0) {
    return { verdict: "approved", matchedRegrets: [], message: "no historical regret matches this request — proceed.", severity: 0 };
  }

  // Strongest match (highest severity) determines verdict
  const strongest = matched.reduce((acc, r) => (r.severity > acc.severity ? r : acc));
  const verdict: MutinyVerdict = strongest.severity >= 0.7 ? "block" : "warn";

  // Did the user already acknowledge?
  if (input.acknowledgement && normalize(input.acknowledgement).includes(normalize(strongest.id))) {
    return {
      verdict: "approved",
      matchedRegrets: matched,
      message: `acknowledgement '${strongest.id}' received — proceeding despite historical regret.`,
      severity: strongest.severity,
    };
  }

  const lines: string[] = [];
  lines.push(verdict === "block" ? `🛑 MUTINY: ${matched.length} historical regret(s) match this request.` : `⚠ MUTINY: ${matched.length} historical regret(s) match this request — proceed carefully.`);
  for (const r of matched.slice(0, 3)) {
    const when = new Date(r.ts).toISOString().slice(0, 10);
    lines.push(`  • [${r.id}] ${when}: ${r.story}${r.scope ? ` (scope: ${r.scope})` : ""}`);
  }

  const ack = `Reply with "acknowledge ${strongest.id}" to override this ${verdict} and proceed.`;
  lines.push(``);
  lines.push(ack);

  return {
    verdict,
    matchedRegrets: matched,
    message: lines.join("\n"),
    acknowledgementRequired: `acknowledge ${strongest.id}`,
    severity: strongest.severity,
  };
}

/** One-line pulse summary. */
export function formatMutinyPulseLine(r: MutinyResult): string {
  return `MUTINY · verdict=${r.verdict} · matched=${r.matchedRegrets.length} · severity=${r.severity.toFixed(2)}`;
}
