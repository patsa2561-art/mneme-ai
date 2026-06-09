/**
 * ARCHITECTURAL BISECT — git-bisect, but for an architectural CONTRACT. The hidden gold of the whole
 * suite: because the cross-layer graph is deterministic and fast to rebuild, it can be replayed at ANY
 * commit — so Mneme can answer a question no tool can: "WHEN did this architectural invariant first
 * break, and which commit (and author) introduced it?".
 *
 * `git blame` localizes a LINE to a commit. This localizes a structural PROPERTY — "the `credentials`
 * table became reachable from an HTTP endpoint", "this table gained a second writer" — to the exact
 * commit, by binary-searching history: evaluate the invariant at the midpoint commit (replay the graph
 * there, check the invariant), narrow to the flip from HOLDS→VIOLATED. The pure algorithm lives here
 * (an injected `holdsAt(i)` evaluator); the git I/O that reads files at a commit lives in the caller, so
 * this stays deterministic and unit-testable.
 *
 * ★HONEST (DIAKRISIS): it replays the STRUCTURAL contract the deterministic extractors see at each
 * sampled commit; binary search assumes the property flipped once in the range (held at the oldest,
 * violated at the newest) — if it flapped, it finds A verifiable breaking commit, not every one. The
 * verdict is a real, re-checkable commit, not a guess.
 */
import { parseInvariants, checkInvariants, type Invariant } from "../invariants/index.js";
import { type SourceFile } from "../cross_layer_graph/index.js";

/** Does a single declared invariant HOLD against this file snapshot? (the predicate bisect evaluates). */
export function invariantHoldsAt(files: ReadonlyArray<SourceFile>, invariantLine: string): boolean {
  const inv: Invariant[] = parseInvariants(String(invariantLine ?? ""));
  if (!inv.length || inv[0].kind === "invalid") return true;   // an unparseable rule can't be "broken"
  const r = checkInvariants(files, [inv[0]]);
  return r.results[0]?.status === "HOLDS";
}

export interface BisectResult { breakAt: number | null; evaluated: number[]; reason: string }
/**
 * Binary-search a commit series (index 0 = oldest, n-1 = newest/HEAD) for the first commit where the
 * invariant became VIOLATED. `holdsAt(i)` is injected (memoized git-replay in the caller).
 */
export function bisectIndex(n: number, holdsAt: (i: number) => boolean): BisectResult {
  const evaluated: number[] = [];
  const at = (i: number) => { evaluated.push(i); return holdsAt(i); };
  if (n <= 0) return { breakAt: null, evaluated, reason: "no commits in range" };
  if (!at(n - 1)) {
    if (n === 1 || !at(0)) return { breakAt: 0, evaluated, reason: "the invariant was already VIOLATED at the oldest sampled commit — it broke before this range" };
    // holds at 0, violated at n-1 → binary search the flip
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (at(mid)) lo = mid; else hi = mid; }
    return { breakAt: hi, evaluated, reason: `the invariant first became VIOLATED at sampled commit #${hi} (the previous commit still held it)` };
  }
  return { breakAt: null, evaluated, reason: "the invariant still HOLDS at HEAD — no violation in this range" };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface ArchBisectGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function archBisectGauntlet(): ArchBisectGauntlet {
  const series = (arr: boolean[]) => bisectIndex(arr.length, (i) => arr[i]);
  // held, held, held, BROKE, broke → first violation at index 3
  const b = series([true, true, true, false, false]);
  const flipOK = b.breakAt === 3;
  // logarithmic: 9 commits → at most ~4 evaluations (binary search, not linear)
  const big = series([true, true, true, true, true, false, false, false, false]);
  const logOK = big.breakAt === 5 && big.evaluated.length <= 5;
  // still holds at HEAD → no break
  const noneOK = series([true, true, true]).breakAt === null;
  // already broken at the oldest → 0
  const preOK = series([false, false]).breakAt === 0;
  // predicate: a 1-writer table holds single-writer; a 2-writer table does not
  const oneW: SourceFile[] = [{ path: "s.prisma", content: "model T { id Int @id }" }, { path: "a.ts", content: "export function w(){ return prisma.t.create({data:{}}); }" }];
  const twoW: SourceFile[] = [...oneW, { path: "b.ts", content: "export function w2(){ return prisma.t.update({where:{}}); }" }];
  const predOK = invariantHoldsAt(oneW, "table T single-writer") === true && invariantHoldsAt(twoW, "table T single-writer") === false;
  const total = (() => { try { bisectIndex(0, () => true); invariantHoldsAt(null as never, "x"); return true; } catch { return false; } })();
  const checks = [
    { name: "FINDS-FIRST-BREAK", pass: flipOK, detail: "binary-search a held→violated series → the exact commit index where it first broke" },
    { name: "LOGARITHMIC", pass: logOK, detail: "9 commits resolved in ≤5 evaluations — it bisects (log n), not a linear scan" },
    { name: "NO-BREAK-IN-RANGE", pass: noneOK, detail: "an invariant that still holds at HEAD → no breaking commit (null)" },
    { name: "PRE-EXISTING-BREAK", pass: preOK, detail: "an invariant already violated at the oldest sampled commit → reported as broken before the range" },
    { name: "PREDICATE", pass: predOK, detail: "the per-commit predicate is real: 1-writer holds single-writer, 2-writer does not" },
    { name: "TOTAL", pass: total, detail: "null/garbage never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
