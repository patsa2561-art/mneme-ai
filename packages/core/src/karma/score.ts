/**
 * Karma scoring — turn a stream of {incurred, settled} events into a
 * weighted per-author leaderboard. Ages are in days; weight grows with age.
 */
import type { KarmaEvent } from "./scan.js";

export interface KarmaAuthor {
  email: string;
  name: string;
  /** Count of TODOs this author has added across history. */
  totalIncurred: number;
  /** Count of TODOs this author has removed across history. */
  totalSettled: number;
  /** Net debit count (incurred - settled). */
  netDebt: number;
  /** Compound-weighted debt (older unkept TODOs weigh more). Higher = worse. */
  weightedDebt: number;
  /** The author's oldest still-open TODO with file context, when known. */
  oldestUnpaid?: {
    commit: string;
    timestamp: number;
    ageDays: number;
    filePath: string;
    content: string;
    marker: string;
  };
  /** Top files by debt count for this author. */
  topFiles: Array<{ filePath: string; debt: number }>;
}

export interface KarmaReport {
  asOf: number;             // unix seconds — the reference time used to age events
  totalEvents: number;
  totalIncurred: number;
  totalSettled: number;
  /** Authors sorted by weightedDebt descending (most-indebted first). */
  authors: KarmaAuthor[];
  /** Repo-wide top files by current open debt. */
  topFiles: Array<{ filePath: string; debt: number }>;
}

/**
 * Match settlements to the most-recent matching incurrence. Two events match
 * if they share marker + content + filePath. Once matched, the incurrence
 * is settled (removed from the open set).
 *
 * Returns the *open* (unsettled) incurrences only. Each carries the ageDays
 * relative to `asOf`.
 */
export function matchOpenDebts(
  events: KarmaEvent[],
  asOf: number,
): Array<KarmaEvent & { ageDays: number }> {
  // Sort oldest → newest so we settle in the order the lines were added.
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const open: KarmaEvent[] = [];
  for (const ev of sorted) {
    if (ev.type === "incurred") {
      open.push(ev);
      continue;
    }
    // Settlement — find the most-recent matching open incurrence
    let matchIdx = -1;
    for (let i = open.length - 1; i >= 0; i--) {
      const cand = open[i]!;
      if (
        cand.marker === ev.marker &&
        cand.filePath === ev.filePath &&
        normalize(cand.content) === normalize(ev.content)
      ) {
        matchIdx = i;
        break;
      }
    }
    if (matchIdx >= 0) open.splice(matchIdx, 1);
    // If no match, it's a settlement of code we never tracked (e.g. baseline
    // commit). Drop silently.
  }
  return open.map((e) => ({ ...e, ageDays: Math.max(0, (asOf - e.timestamp) / 86400) }));
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Compute the compounded weight of a single open debt at a given age.
 *
 * Choice of curve: log10(1 + ageDays) — sub-linear so a 1-year-old TODO
 * (≈ 2.6 weight) is not 365× worse than a 1-day-old TODO (≈ 0.3 weight).
 * This matches engineering intuition: aging matters but doesn't dominate.
 */
export function debtWeight(ageDays: number): number {
  return Math.log10(1 + Math.max(0, ageDays));
}

export function buildReport(events: KarmaEvent[], asOf?: number): KarmaReport {
  const ref = asOf ?? Math.floor(Date.now() / 1000);
  const open = matchOpenDebts(events, ref);

  const byAuthor = new Map<string, KarmaAuthor>();
  // Initialise per-author counters from the full event stream
  for (const ev of events) {
    const a = byAuthor.get(ev.email) ?? {
      email: ev.email,
      name: ev.name,
      totalIncurred: 0,
      totalSettled: 0,
      netDebt: 0,
      weightedDebt: 0,
      topFiles: [],
    };
    if (!a.name && ev.name) a.name = ev.name;
    if (ev.type === "incurred") a.totalIncurred += 1;
    else a.totalSettled += 1;
    byAuthor.set(ev.email, a);
  }

  // Apply weighted debt + topFiles + oldestUnpaid from open debts
  const fileDebtRepoWide = new Map<string, number>();
  const fileDebtPerAuthor = new Map<string, Map<string, number>>();
  for (const o of open) {
    const a = byAuthor.get(o.email);
    if (!a) continue;
    a.netDebt += 1;
    a.weightedDebt += debtWeight(o.ageDays);
    fileDebtRepoWide.set(o.filePath, (fileDebtRepoWide.get(o.filePath) ?? 0) + 1);

    const perAuthor = fileDebtPerAuthor.get(o.email) ?? new Map<string, number>();
    perAuthor.set(o.filePath, (perAuthor.get(o.filePath) ?? 0) + 1);
    fileDebtPerAuthor.set(o.email, perAuthor);

    if (
      !a.oldestUnpaid ||
      o.timestamp < a.oldestUnpaid.timestamp
    ) {
      a.oldestUnpaid = {
        commit: o.commit,
        timestamp: o.timestamp,
        ageDays: o.ageDays,
        filePath: o.filePath,
        content: o.content,
        marker: o.marker,
      };
    }
  }

  // Materialize topFiles per author
  for (const [email, perAuthor] of fileDebtPerAuthor) {
    const author = byAuthor.get(email);
    if (!author) continue;
    author.topFiles = Array.from(perAuthor.entries())
      .map(([filePath, debt]) => ({ filePath, debt }))
      .sort((a, b) => b.debt - a.debt)
      .slice(0, 5);
  }

  const authorsSorted = Array.from(byAuthor.values()).sort(
    (a, b) => b.weightedDebt - a.weightedDebt || b.netDebt - a.netDebt,
  );

  const topFiles = Array.from(fileDebtRepoWide.entries())
    .map(([filePath, debt]) => ({ filePath, debt }))
    .sort((a, b) => b.debt - a.debt)
    .slice(0, 10);

  return {
    asOf: ref,
    totalEvents: events.length,
    totalIncurred: events.filter((e) => e.type === "incurred").length,
    totalSettled: events.filter((e) => e.type === "settled").length,
    authors: authorsSorted,
    topFiles,
  };
}
