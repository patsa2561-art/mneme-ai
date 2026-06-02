/**
 * v2.142.0 — CRUCIBLE: the File-level Settlement Gate. Before an AI's diff is
 * allowed to touch the user's real working tree, it is applied in a SHADOW
 * (a cheap `git worktree` that shares .git — not a kernel sandbox, not a full
 * copy), built + tested THERE, and only merged to the real disk if the shadow
 * verification PASSES — with a signed receipt either way. Proof-carrying shadow
 * execution: a reviewer/CI trusts the RESULT ("built + tested green in a shadow,
 * then merged"), and a failing diff NEVER reaches the real tree.
 *
 * This is the honest realization of the "File-level Settlement Gate" (the
 * rejected-kernel-sandbox → file-level-shadow-copy call was correct): the git
 * worktree + the verify spawn are the CLI's I/O; THIS core owns the part that
 * must be provably correct — the SAFETY INVARIANT (a non-passing verdict can
 * never have written the real tree) + the diff plan + the receipt.
 *
 * DIAKRISIS — the honest ceiling:
 *   - CRUCIBLE proves "your own build/test command passed in a shadow with this
 *     diff applied", NOT that the code is bug-free — it's exactly as strong as
 *     your verify command. It is a real shadow (git worktree), not a security
 *     sandbox: a malicious build script still runs (pair it with the HEPHAESTUS
 *     command gate). The guarantee it DOES make, mechanically: the real tree is
 *     written iff the shadow verdict is MERGE.
 * Pure + deterministic + total (the CLI adds the worktree + the spawn).
 */

// reuse PCE's diff parser for the touched-path plan (single source of truth)
import { parseDiff } from "../pce/index.js";

export interface SettlementPlan {
  touchedPaths: string[];
  newFiles: string[];
  deletedFiles: string[];
  addedLines: number;
  removedLines: number;
}

/** What files a diff will touch in the shadow (via PCE's parser). Total. */
export function planSettlement(diff: string): SettlementPlan {
  try {
    const p = parseDiff(diff);
    return {
      touchedPaths: p.files.map((f) => f.path),
      newFiles: p.files.filter((f) => f.isNew).map((f) => f.path),
      deletedFiles: p.files.filter((f) => f.isDelete).map((f) => f.path),
      addedLines: p.addedCount,
      removedLines: p.removedCount,
    };
  } catch { return { touchedPaths: [], newFiles: [], deletedFiles: [], addedLines: 0, removedLines: 0 }; }
}

export interface VerifyResult {
  /** exit code of the build/test command run IN the shadow. 0 = pass. */
  exitCode: number;
  durationMs?: number;
  output?: string;
}

export type SettlementVerdict = "MERGE" | "ROLLBACK" | "REVIEW";
export interface SettlementDecision {
  verdict: SettlementVerdict;
  /** THE INVARIANT: true iff verdict === "MERGE". A non-MERGE verdict guarantees
   *  the real working tree was NOT written. */
  realTreeWritten: boolean;
  reason: string;
  failureBrief: string | null;
}

/** Pull the first meaningful failure line out of verify output (for the receipt). Total. */
export function failureBrief(output: string | undefined): string | null {
  try {
    const t = typeof output === "string" ? output : "";
    if (!t) return null;
    const lines = t.split("\n");
    const hit = lines.find((l) => /\b(error|fail(ed|ure)?|✗|✘|×|assert|exception|cannot|not ok|TS\d{3,})\b/i.test(l) && l.trim().length > 3);
    return (hit ?? lines.filter((l) => l.trim()).slice(-1)[0] ?? "").trim().slice(0, 200) || null;
  } catch { return null; }
}

/**
 * Decide whether the shadow verification permits writing the real tree.
 * INVARIANT: realTreeWritten === (verdict === "MERGE"). A failing or
 * review-required verdict means the real tree stays untouched. Pure + total.
 *
 * @param requireHumanMerge  if true, a passing shadow still yields REVIEW (never
 *   auto-writes) — for high-stakes trees where a green build isn't enough.
 */
export function decideSettlement(verify: VerifyResult, opts?: { requireHumanMerge?: boolean }): SettlementDecision {
  try {
    const code = Number(verify?.exitCode);
    const passed = Number.isFinite(code) && code === 0;
    if (!passed) {
      return { verdict: "ROLLBACK", realTreeWritten: false, reason: `shadow verification FAILED (exit ${Number.isFinite(code) ? code : "?"}) — real tree untouched`, failureBrief: failureBrief(verify?.output) };
    }
    if (opts?.requireHumanMerge) {
      return { verdict: "REVIEW", realTreeWritten: false, reason: "shadow verification PASSED — held for human merge (requireHumanMerge)", failureBrief: null };
    }
    return { verdict: "MERGE", realTreeWritten: true, reason: "shadow verification PASSED — safe to merge to the real tree", failureBrief: null };
  } catch {
    // fail-closed: any error ⇒ never write the real tree
    return { verdict: "ROLLBACK", realTreeWritten: false, reason: "settlement error — fail-closed, real tree untouched", failureBrief: null };
  }
}

/** A receipt-ready summary of a crucible run (the CLI signs it with NOTARY). */
export interface CrucibleReceiptBody {
  plan: SettlementPlan;
  verdict: SettlementVerdict;
  realTreeWritten: boolean;
  exitCode: number;
  durationMs: number | null;
  failureBrief: string | null;
}
export function crucibleReceiptBody(diff: string, verify: VerifyResult, decision: SettlementDecision): CrucibleReceiptBody {
  return {
    plan: planSettlement(diff),
    verdict: decision.verdict,
    realTreeWritten: decision.realTreeWritten,
    exitCode: Number.isFinite(verify?.exitCode) ? verify.exitCode : -1,
    durationMs: Number.isFinite(verify?.durationMs) ? (verify!.durationMs as number) : null,
    failureBrief: decision.failureBrief,
  };
}

// ── falsifiable proof ────────────────────────────────────────────────────────
export interface CrucibleGauntlet {
  passMerges: boolean;
  failRollsBack: boolean;
  failNeverWritesRealTree: boolean;       // the safety invariant
  reviewModeNeverWrites: boolean;
  errorFailsClosed: boolean;
  planExtractsTouchedPaths: boolean;
  extractsFailureBrief: boolean;
  invariantHoldsAcrossExitCodes: boolean; // realTreeWritten ⟺ MERGE, for many codes
  deterministic: boolean;
  total: boolean;
  score: 0 | 100;
}

export function crucibleGauntlet(): CrucibleGauntlet {
  const diff = ["diff --git a/src/m.ts b/src/m.ts", "@@ -1 +1,2 @@", " const a=1;", "+const b=2;", "diff --git a/old.ts b/old.ts", "deleted file mode 100644", "-gone"].join("\n");

  const pass = decideSettlement({ exitCode: 0, durationMs: 1200 });
  const passMerges = pass.verdict === "MERGE" && pass.realTreeWritten === true;

  const fail = decideSettlement({ exitCode: 1, output: "FAIL src/m.test.ts > adds\n  AssertionError: expected 2 got 3" });
  const failRollsBack = fail.verdict === "ROLLBACK";
  const failNeverWritesRealTree = fail.realTreeWritten === false;

  const review = decideSettlement({ exitCode: 0 }, { requireHumanMerge: true });
  const reviewModeNeverWrites = review.verdict === "REVIEW" && review.realTreeWritten === false;

  const err = decideSettlement(undefined as unknown as VerifyResult);
  const errorFailsClosed = err.verdict === "ROLLBACK" && err.realTreeWritten === false;

  const plan = planSettlement(diff);
  const planExtractsTouchedPaths = plan.touchedPaths.includes("src/m.ts") && plan.deletedFiles.includes("old.ts") && plan.addedLines === 1;

  const extractsFailureBrief = /AssertionError|FAIL/i.test(failureBrief("ok\nok\nFAIL src/m.test.ts\n  AssertionError: x") ?? "");

  // INVARIANT across many exit codes: realTreeWritten ⟺ (code===0 && !review)
  let invariantHoldsAcrossExitCodes = true;
  for (const code of [0, 1, 2, 127, -1, 255, 137]) {
    const d = decideSettlement({ exitCode: code });
    const shouldWrite = code === 0;
    if (d.realTreeWritten !== shouldWrite) { invariantHoldsAcrossExitCodes = false; break; }
    if (d.realTreeWritten && d.verdict !== "MERGE") { invariantHoldsAcrossExitCodes = false; break; }
  }

  const deterministic = JSON.stringify(decideSettlement({ exitCode: 0 })) === JSON.stringify(decideSettlement({ exitCode: 0 }));

  let total = true;
  try {
    planSettlement(null as unknown as string);
    decideSettlement(null as unknown as VerifyResult);
    decideSettlement({ exitCode: NaN });
    failureBrief(undefined);
    crucibleReceiptBody("", { exitCode: 0 }, decideSettlement({ exitCode: 0 }));
  } catch { total = false; }

  const all = passMerges && failRollsBack && failNeverWritesRealTree && reviewModeNeverWrites && errorFailsClosed
    && planExtractsTouchedPaths && extractsFailureBrief && invariantHoldsAcrossExitCodes && deterministic && total;
  return { passMerges, failRollsBack, failNeverWritesRealTree, reviewModeNeverWrites, errorFailsClosed, planExtractsTouchedPaths, extractsFailureBrief, invariantHoldsAcrossExitCodes, deterministic, total, score: all ? 100 : 0 };
}
