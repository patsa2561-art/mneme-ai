/**
 * Plain-English text helpers shared by lenses, hovers, and the sidebar.
 *
 * Mneme's writing rule: every metric translated inline. A user should
 * never have to remember what "0.41 knowledge" means — we say
 * "knowledge faded — needs review".
 */

export type AtrophyBand = "fresh" | "warm" | "fading" | "ghosted";

/** Map a 0..1 knowledge score to one of four English bands. */
export function bandForScore(score: number): AtrophyBand {
  if (score >= 0.7) return "fresh";
  if (score >= 0.3) return "warm";
  if (score >= 0.1) return "fading";
  return "ghosted";
}

/** Single-character emoji for at-a-glance tier display. */
export function bandIcon(band: AtrophyBand): string {
  switch (band) {
    case "fresh":
      return "🟢";
    case "warm":
      return "🟢";
    case "fading":
      return "🟡";
    case "ghosted":
      return "🔴";
  }
}

/** "today / yesterday / 3 days ago / 4 weeks ago / 7 months ago / 1.4 years ago". */
export function humanDays(days: number): string {
  if (!Number.isFinite(days) || days < 0) return "unknown";
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 14) return `${Math.round(days)} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 730) return `${Math.round(days / 30)} months ago`;
  return `${(days / 365).toFixed(1)} years ago`;
}

/** Map a knowledge score to a one-line plain-English explanation. */
export function explainKnowledge(score: number): string {
  if (score >= 0.9) return "right at the front of someone's mind";
  if (score >= 0.7) return "freshly remembered — minutes to re-orient";
  if (score >= 0.5) return "still warm — a quick re-read suffices";
  if (score >= 0.3) return "fading — needs a focused review";
  if (score >= 0.1) return "mostly forgotten — re-onboarding work";
  return "ghost code — deep history lost";
}

/** Convert an audit verdict to a status-bar style snippet. */
export function verdictText(verdict: "pass" | "warn" | "fail" | "idle"): string {
  switch (verdict) {
    case "pass":
      return "$(check) Mneme · pass";
    case "warn":
      return "$(warning) Mneme · warn";
    case "fail":
      return "$(error) Mneme · fail";
    case "idle":
      return "$(info) Mneme · idle";
  }
}
