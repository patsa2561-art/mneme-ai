/**
 * `story <topic>` — narrative generation. Take a topic, find every commit
 * that touched it, group into "acts" (initial / refactor / incidents /
 * stable), and emit a structured timeline. The LLM (when available) can
 * polish the act labels and write a short prose summary.
 *
 * Pure data extraction in this file. The CLI command renders + optionally
 * pipes through an LLM for prose.
 */

import type { Commit } from "../types.js";
import { topHotFiles } from "../util/noise.js";

export interface StoryAct {
  /** Stable id used for the section header. */
  id: "initial" | "refactor" | "incident" | "evolution" | "stable";
  /** Human-readable title — "Act I — The Beginning" etc. */
  title: string;
  /** Commits in chronological order (oldest first). */
  commits: Commit[];
  /** Date range of the act. */
  fromDate: string;
  toDate: string;
  /** Top files (top 5, noise-filtered) most-touched during the act. Lets the
   *  reader see the spatial trajectory of the story — "Act I worked on
   *  src/auth/, Act II shifted to src/payments/". */
  hotFiles?: Array<{ path: string; count: number }>;
}

export interface Story {
  topic: string;
  acts: StoryAct[];
  totalCommits: number;
  spanDays: number;
}

const REFACTOR_KEYWORDS = /\b(refactor|rewrite|migrate|switch(?:ed)?|replace[ds]?|deprecate)\b/i;
const INCIDENT_KEYWORDS = /\b(incident|outage|hotfix|revert|rollback|broken|critical|emergency|p[01])\b/i;

/**
 * Build a Story from a list of commits matching the topic. Commits should
 * already be filtered by relevance (e.g. via FTS) and sorted chronologically
 * by the caller.
 */
export function buildStory(topic: string, commits: Commit[]): Story {
  const sorted = [...commits].sort((a, b) => a.authorDate.localeCompare(b.authorDate));
  if (sorted.length === 0) {
    return { topic, acts: [], totalCommits: 0, spanDays: 0 };
  }

  const acts: StoryAct[] = [];

  // Act I — Initial: the very first commit on the topic.
  const initial = sorted[0]!;
  acts.push({
    id: "initial",
    title: "Act I — The Beginning",
    commits: [initial],
    fromDate: initial.authorDate.slice(0, 10),
    toDate: initial.authorDate.slice(0, 10),
    hotFiles: topHotFiles([initial]),
  });

  // Walk the rest, grouping consecutive commits with the same flavor.
  type Flavor = "refactor" | "incident" | "evolution";
  const remaining = sorted.slice(1);
  let currentFlavor: Flavor | null = null;
  let currentBucket: Commit[] = [];

  const flush = () => {
    if (currentBucket.length === 0 || !currentFlavor) return;
    acts.push({
      id: currentFlavor,
      title: titleFor(currentFlavor, acts.length),
      commits: [...currentBucket],
      fromDate: currentBucket[0]!.authorDate.slice(0, 10),
      toDate: currentBucket[currentBucket.length - 1]!.authorDate.slice(0, 10),
      hotFiles: topHotFiles(currentBucket),
    });
    currentBucket = [];
    currentFlavor = null;
  };

  for (const c of remaining) {
    const flavor = detectFlavor(c);
    if (flavor !== currentFlavor) flush();
    currentFlavor = flavor;
    currentBucket.push(c);
  }
  flush();

  // Final act — if the most recent commit is older than 90 days, consider
  // the topic "stable" (no recent change).
  const last = sorted[sorted.length - 1]!;
  const ageDays = (Date.now() - new Date(last.authorDate).getTime()) / 86_400_000;
  if (ageDays > 90 && acts[acts.length - 1]!.id !== "stable") {
    acts.push({
      id: "stable",
      title: `${acts.length === 0 ? "Act I" : romanFor(acts.length + 1)} — The Stable State`,
      commits: [last],
      fromDate: last.authorDate.slice(0, 10),
      toDate: new Date().toISOString().slice(0, 10),
      hotFiles: topHotFiles([last]),
    });
  }

  const span = Math.round(
    (new Date(last.authorDate).getTime() - new Date(initial.authorDate).getTime()) / 86_400_000,
  );

  return {
    topic,
    acts,
    totalCommits: sorted.length,
    spanDays: span,
  };
}

function detectFlavor(c: Commit): "refactor" | "incident" | "evolution" {
  const text = `${c.subject}\n${c.body || ""}`;
  if (INCIDENT_KEYWORDS.test(text)) return "incident";
  if (REFACTOR_KEYWORDS.test(text)) return "refactor";
  return "evolution";
}

function titleFor(flavor: "refactor" | "incident" | "evolution", actIndex: number): string {
  const roman = romanFor(actIndex + 1);
  switch (flavor) {
    case "refactor":
      return `${roman} — The Refactor`;
    case "incident":
      return `${roman} — Incidents Strike`;
    case "evolution":
      return `${roman} — Steady Evolution`;
  }
}

function romanFor(n: number): string {
  const roman = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  return n <= 10 ? `Act ${roman[n - 1]}` : `Act ${n}`;
}
