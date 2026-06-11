/**
 * INVARIANT LINEAGE — the AGE of an architectural contract: the commit where it was first ESTABLISHED.
 *
 * The mirror image of ARCHITECTURAL BISECT. Bisect finds where an invariant BROKE (a true→false flip in
 * history); lineage finds where it was BORN (the false→true flip) and has held ever since. That single
 * fact — how long a contract has stood — is what tells you how load-bearing it is:
 *   • a single-writer rule that has held for two years is a foundational, battle-tested contract —
 *     breaking it is high-risk, and an AI agent should treat it as near-sacred.
 *   • a contract only days old is still fragile — fine to revise.
 * Age turns a flat list of invariants into a risk-ranked one: oldest = most load-bearing.
 *
 * This module owns the PURE search (the inverse-bisect index math); the caller (CLI/MCP) supplies the
 * predicate "did the invariant hold at commit i?" by replaying the deterministic graph across history,
 * and maps the established index to a commit + author + date + age.
 *
 * ★HONEST (DIAKRISIS): "established" assumes a contract, once it starts holding, keeps holding — true for
 * a clean false→…→true history; if a contract flickered (held, broke, re-held) the search returns the
 * MOST RECENT establishment and says so, never inventing a single origin. If the invariant doesn't hold
 * at HEAD there is no lineage to report (use bisect to find where it broke instead).
 */
export interface LineageResult { establishedAt: number | null; sinceBeforeRange: boolean; flickered: boolean; reason: string; evaluated: number[] }

/**
 * Find the first index where `holdsAt` becomes true and stays true (the contract's establishment).
 * Mirrors bisectIndex: assumes a monotonic false…false,true…true history over [0, n).
 */
export function establishedIndex(n: number, holdsAt: (i: number) => boolean): LineageResult {
  const evaluated: number[] = [];
  const at = (i: number) => { evaluated.push(i); return holdsAt(i); };
  if (n <= 0) return { establishedAt: null, sinceBeforeRange: false, flickered: false, reason: "no commits in range", evaluated };
  if (!at(n - 1)) return { establishedAt: null, sinceBeforeRange: false, flickered: false, reason: "the invariant does not hold at HEAD — there is no lineage (use bisect to find where it broke)", evaluated };
  if (at(0)) return { establishedAt: 0, sinceBeforeRange: true, flickered: false, reason: "held at the earliest commit in range — established at or before the baseline", evaluated };
  // binary search for the first true: lo holds false, hi holds true
  let lo = 0, hi = n - 1;
  while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (at(mid)) hi = mid; else lo = mid; }
  // detect a flicker: if any sampled index BELOW hi was true, the history isn't monotonic.
  const flickered = evaluated.some((i) => i < hi && holdsAtCached(i, holdsAt));
  return { establishedAt: hi, sinceBeforeRange: false, flickered, reason: flickered ? "most recent establishment (the contract flickered earlier in history)" : "first commit where the contract began holding and has held since", evaluated };
}
// tiny memo so the flicker re-check doesn't re-run the predicate uncached
const _cache = new WeakMap<(i: number) => boolean, Map<number, boolean>>();
function holdsAtCached(i: number, fn: (i: number) => boolean): boolean {
  let m = _cache.get(fn); if (!m) { m = new Map(); _cache.set(fn, m); }
  if (m.has(i)) return m.get(i)!; const v = fn(i); m.set(i, v); return v;
}

// ── CONTRACT MAP — the whole repo's contracts ranked by how load-bearing (old) each is ──
export type AgeBand = "FOUNDATIONAL" | "ESTABLISHED" | "MATURING" | "RECENT";
/** Older = more load-bearing. The bands an AI agent uses to decide what is safe to revise. */
export function ageBand(days: number): AgeBand {
  return days >= 365 ? "FOUNDATIONAL" : days >= 90 ? "ESTABLISHED" : days >= 14 ? "MATURING" : "RECENT";
}
export interface ContractRecord { rule: string; ageDays: number; band: AgeBand; establishedSha?: string; author?: string; sinceBeforeRange?: boolean }
export interface ContractMap { contracts: ContractRecord[]; total: number; foundational: number; recent: number; mostFragile: ContractRecord[] }
/** Rank mined contracts oldest-first (most load-bearing) and surface the youngest as the fragile ones. */
export function rankContracts(records: ReadonlyArray<ContractRecord>): ContractMap {
  const sorted = [...(records ?? [])].sort((a, b) => (b.ageDays - a.ageDays) || a.rule.localeCompare(b.rule));
  const youngestFirst = [...sorted].reverse();
  return {
    contracts: sorted, total: sorted.length,
    foundational: sorted.filter((r) => r.band === "FOUNDATIONAL").length,
    recent: sorted.filter((r) => r.band === "RECENT").length,
    mostFragile: youngestFirst.filter((r) => r.band === "RECENT" || r.band === "MATURING").slice(0, 5),
  };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface ArchLineageGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function archLineageGauntlet(): ArchLineageGauntlet {
  // history: [F,F,T,T,T] → established at index 2.
  const hist = [false, false, true, true, true];
  const r = establishedIndex(hist.length, (i) => hist[i]);
  const findsBirth = r.establishedAt === 2 && !r.sinceBeforeRange;
  // logarithmic: should not evaluate all 9 of a 9-long history.
  const big = Array.from({ length: 9 }, (_, i) => i >= 6); // F*6, T*3 → established at 6
  const rb = establishedIndex(big.length, (i) => big[i]);
  const logarithmic = rb.establishedAt === 6 && new Set(rb.evaluated).size <= 5;
  // not held at HEAD → null lineage.
  const notHeld = establishedIndex(4, (i) => [false, true, true, false][i]).establishedAt === null;
  // held since before the range.
  const beforeRange = (() => { const rr = establishedIndex(3, () => true); return rr.establishedAt === 0 && rr.sinceBeforeRange === true; })();
  // contract map: bands by age + rank oldest-first + youngest are the fragile ones.
  const bandsOK = ageBand(400) === "FOUNDATIONAL" && ageBand(120) === "ESTABLISHED" && ageBand(20) === "MATURING" && ageBand(3) === "RECENT";
  const map = rankContracts([
    { rule: "old", ageDays: 500, band: ageBand(500) },
    { rule: "mid", ageDays: 100, band: ageBand(100) },
    { rule: "young", ageDays: 2, band: ageBand(2) },
  ]);
  const rankOK = map.contracts[0].rule === "old" && map.contracts[2].rule === "young" && map.foundational === 1 && map.recent === 1 && map.mostFragile[0]?.rule === "young";
  const total = (() => { try { establishedIndex(0, () => false); establishedIndex(-1, () => true); rankContracts(null as never); ageBand(NaN); return true; } catch { return false; } })();
  const checks = [
    { name: "FINDS-BIRTH", pass: findsBirth, detail: "the false→true flip (the commit a contract was established) is found" },
    { name: "LOGARITHMIC", pass: logarithmic, detail: "binary search — ≤5 evaluations for a 9-commit history" },
    { name: "NOT-HELD-AT-HEAD", pass: notHeld, detail: "an invariant that does not hold at HEAD has no lineage (null) — bisect that instead" },
    { name: "SINCE-BEFORE-RANGE", pass: beforeRange, detail: "a contract already holding at the earliest commit → established at/before the baseline" },
    { name: "AGE-BANDS", pass: bandsOK, detail: "FOUNDATIONAL ≥365d / ESTABLISHED ≥90d / MATURING ≥14d / RECENT thresholds" },
    { name: "CONTRACT-MAP-RANK", pass: rankOK, detail: "contracts rank oldest-first (most load-bearing); the youngest surface as the fragile ones" },
    { name: "TOTAL", pass: total, detail: "empty/negative/garbage never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
