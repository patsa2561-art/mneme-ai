/**
 * xrayGauntlet — a falsifiable, in-memory proof of the X-Ray invariants that
 * do not need a live repo: the privacy moat catches injected source, allows
 * legitimately-structural symbol names, is total on garbage, and a clean
 * report passes. Score is 0 or 100 (every invariant must hold).
 */
import { xrayLeaksRaw } from "./privacy.js";
import type { XRayReport } from "./types.js";

export interface XRayGauntlet {
  cleanReportPasses: boolean;
  catchesInjectedSource: boolean;
  allowsStructuralSymbolName: boolean;
  totalOnGarbage: boolean;
  score: number;
}

function cleanFixture(): XRayReport {
  return {
    v: 1,
    subject: { kind: "git-url", ref: "https://github.com/acme/widget", repoName: "acme/widget", commitHash: "abc123def456" },
    generatedAt: "2026-01-01T00:00:00.000Z",
    summary: { headline: "Mixed", grade: "C", signalsRun: 5, bullets: ["🔑 No credential patterns found in tracked files."] },
    deps: { total: 12, byBand: { thriving: 8, healthy: 2, watch: 1, moribund: 1, dead: 0 }, atRisk: [{ name: "request", band: "dead", probability18mo: 0.9, successor: "got" }], partial: false, note: "1 dying." },
    secrets: { filesScanned: 40, totalFindings: 0, excludedTestHits: 3, byKind: {}, hits: [], worstVerdict: "ALLOW", note: "clean" },
    busFactor: { authors: 5, singleOwnerFilePct: 22.5, fragileFiles: [{ file: "src/core.ts", topAuthorShare: 0.9, commits: 30 }], topContributorShare: 41.2, busFactor: 2, note: "5 authors" },
    age: { bornAt: "2020-01-01", lastCommitAt: "2026-01-01", lifespan: "6 years", lifespanDays: 2192, totalCommits: 1200, totalAuthors: 5, dormant: false, vitality: "active", note: "active" },
    complexity: { filesAnalysed: 40, totalSymbols: 320, hotspots: [{ file: "src/core.ts", symbol: "function handleRequest(req, res)", bodyLines: 180, startLine: 12 }], maxDepth: 4, note: "hotspot" },
    fingerprint: "deadbeef",
  };
}

export function xrayGauntlet(): XRayGauntlet {
  // 1. a normal metric-only report must pass (the structural signature in
  //    complexity.hotspots[].symbol must NOT trip the scanner).
  const clean = cleanFixture();
  const cleanReportPasses = xrayLeaksRaw(clean).leaks === false;
  const allowsStructuralSymbolName = cleanReportPasses; // same assertion, named for clarity

  // 2. inject a real source body into a non-structural field → must be caught.
  const poisoned = cleanFixture();
  (poisoned.age as unknown as { note: string }).note = "function leak(){ const secret = 42; return secret }";
  const catchesInjectedSource = xrayLeaksRaw(poisoned).leaks === true;

  // 3. total on garbage (never throws; fail-closed to "leaks").
  let totalOnGarbage = true;
  try {
    const a = xrayLeaksRaw(null);
    const b = xrayLeaksRaw({ circular: undefined } as unknown);
    const c = xrayLeaksRaw(undefined);
    totalOnGarbage = a.leaks === true && c.leaks === true && typeof b.leaks === "boolean";
  } catch {
    totalOnGarbage = false;
  }

  const all = cleanReportPasses && catchesInjectedSource && allowsStructuralSymbolName && totalOnGarbage;
  return { cleanReportPasses, catchesInjectedSource, allowsStructuralSymbolName, totalOnGarbage, score: all ? 100 : 0 };
}
