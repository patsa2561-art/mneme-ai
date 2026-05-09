/**
 * Truth Confession (v1.18.0 — black sheep #5)
 *
 * Before delivering a user-facing answer, the AI calls `mneme.confess`
 * with the draft + a self-rated confidence (0-1). Mneme cross-checks
 * the draft against ground truth available locally:
 *
 *   • commit-hash claims  → resolved via git rev-parse (same as verify_claims)
 *   • file-path claims    → resolved via fs.existsSync
 *   • numeric claims      → flagged for the AI's attention (best-effort regex)
 *
 * Returns one of:
 *   • verified            — every checkable claim resolved
 *   • partially_verified  — some checkable claims resolved, others didn't
 *   • hallucination       — at least one checkable claim FAILED
 *   • unverifiable        — no checkable claims found in the draft
 *
 * Lifetime stats are recorded per-AI-vendor in
 * `.mneme/confess-scoreboard.json`. Over time this builds a per-vendor
 * trust scorecard the user (or another tool) can query — the foundation
 * for the public AI-trust dashboard.
 *
 * No other MCP server has a built-in confession + per-vendor scoreboard.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, isAbsolute, resolve as pathResolve } from "node:path";
import { karmaStreaks } from "@mneme-ai/core";
import type { MnemeTool } from "./_types.js";

export type ConfessVerdict = "verified" | "partially_verified" | "hallucination" | "unverifiable";

export interface ConfessFinding {
  kind: "commit-hash" | "file-path" | "numeric";
  value: string;
  status: "resolved" | "missing" | "flagged";
  detail?: string;
}

export interface ConfessReport {
  verdict: ConfessVerdict;
  selfConfidence: number;
  /** Mneme's own confidence in the verdict (vs the AI's self-rating). */
  mnemeConfidence: number;
  findings: ConfessFinding[];
  /** Trust delta to apply to the vendor's scoreboard (-1..+1). */
  trustDelta: number;
  /** Top-level instruction for the AI. */
  guidance: string;
}

export interface ScoreboardEntry {
  vendor: string;
  confessions: number;
  verifiedCount: number;
  partialCount: number;
  hallucinationCount: number;
  unverifiableCount: number;
  /** Cumulative trust score (sum of trustDeltas) — divide by confessions
   *  for a [-1, +1] average trust per call. */
  trustScore: number;
  /** ISO timestamp of last confession. */
  lastSeen: string;
}

interface Scoreboard {
  entries: Record<string, ScoreboardEntry>;
}

const SCOREBOARD_FILENAME = ".mneme/confess-scoreboard.json";

function readScoreboard(repoRoot: string): Scoreboard {
  const path = join(repoRoot, SCOREBOARD_FILENAME);
  if (!existsSync(path)) return { entries: {} };
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Scoreboard;
  } catch {
    return { entries: {} };
  }
}

function writeScoreboard(repoRoot: string, sb: Scoreboard): void {
  const dir = join(repoRoot, ".mneme");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(repoRoot, SCOREBOARD_FILENAME), JSON.stringify(sb, null, 2), "utf8");
}

/** Extract every commit-hash candidate, file-path candidate, and numeric
 *  claim from a draft. Heuristic but conservative — false negatives are
 *  preferred over false positives (we'd rather under-check than under-warn). */
export function extractClaims(draft: string): {
  hashes: string[];
  paths: string[];
  numbers: string[];
} {
  const hashes = Array.from(new Set(draft.match(/\b[a-f0-9]{7,40}\b/gi) ?? []));
  // Path candidate: starts with a letter, contains a slash, ends in a
  // file extension. e.g. src/foo.ts, packages/web/index.ts.
  const paths = Array.from(
    new Set(
      (draft.match(/(?:[a-zA-Z][\w.-]*\/)+[a-zA-Z][\w.-]*\.[a-zA-Z0-9]{1,8}/g) ?? [])
        .filter((p) => !p.includes(".."))
        .filter((p) => p.length < 200),
    ),
  );
  // Numeric claims: 'X commits', 'N tests', 'M files' — short captures.
  const numbers = Array.from(
    new Set(
      (draft.match(/\b\d{1,7}\s+(?:commits?|tests?|files?|lines?|authors?|days?|seconds?|ms)\b/gi) ?? []).map((s) =>
        s.toLowerCase(),
      ),
    ),
  );
  return { hashes, paths, numbers };
}

export function confessDraft(
  draft: string,
  selfConfidence: number,
  repoRoot: string,
): ConfessReport {
  const { hashes, paths, numbers } = extractClaims(draft);
  const findings: ConfessFinding[] = [];

  for (const h of hashes) {
    const r = spawnSync("git", ["rev-parse", "--verify", h], { cwd: repoRoot, stdio: "pipe" });
    findings.push({
      kind: "commit-hash",
      value: h,
      status: r.status === 0 ? "resolved" : "missing",
    });
  }
  for (const p of paths) {
    const abs = isAbsolute(p) ? p : pathResolve(repoRoot, p);
    findings.push({
      kind: "file-path",
      value: p,
      status: existsSync(abs) ? "resolved" : "missing",
    });
  }
  for (const n of numbers) {
    findings.push({
      kind: "numeric",
      value: n,
      status: "flagged",
      detail: "Numeric claim — Mneme cannot verify automatically; AI should cross-check before delivery.",
    });
  }

  const checkable = findings.filter((f) => f.status !== "flagged");
  const resolved = checkable.filter((f) => f.status === "resolved").length;
  const missing = checkable.filter((f) => f.status === "missing").length;

  let verdict: ConfessVerdict;
  let trustDelta: number;
  let guidance: string;
  if (checkable.length === 0) {
    verdict = "unverifiable";
    trustDelta = 0;
    guidance =
      "No commit-hash or file-path claims found to check. " +
      "Mneme can't automatically grade this draft — rely on the AI's self-confidence and pair with mneme.adversary.cross_examine for stronger checks.";
  } else if (missing === 0) {
    verdict = "verified";
    trustDelta = +0.2;
    guidance = `All ${resolved} checkable claim${resolved === 1 ? "" : "s"} resolved. Safe to deliver.`;
  } else if (resolved === 0) {
    verdict = "hallucination";
    trustDelta = -0.5;
    guidance = `STOP — ${missing} unresolved claim${missing === 1 ? "" : "s"}: ${findings.filter((f) => f.status === "missing").slice(0, 3).map((f) => f.value).join(", ")}. Rewrite to remove or replace before delivery.`;
  } else {
    verdict = "partially_verified";
    trustDelta = -0.1;
    guidance = `${resolved} resolved, ${missing} unresolved. Either remove the unresolved claims or replace them with verified equivalents.`;
  }

  // Calibration: if AI's self-confidence is HIGH (>0.8) but we found
  // hallucinations, penalize harder. If self-confidence is LOW but we
  // verified everything, reward extra (calibration credit).
  let calibrationAdjustment = 0;
  if (verdict === "hallucination" && selfConfidence > 0.8) calibrationAdjustment = -0.3;
  if (verdict === "verified" && selfConfidence < 0.5) calibrationAdjustment = +0.1;
  trustDelta += calibrationAdjustment;

  const mnemeConfidence = checkable.length === 0 ? 0.3 : Math.min(1, 0.5 + checkable.length * 0.05);

  return {
    verdict,
    selfConfidence,
    mnemeConfidence: Math.round(mnemeConfidence * 100) / 100,
    findings,
    trustDelta: Math.max(-1, Math.min(1, Math.round(trustDelta * 100) / 100)),
    guidance,
  };
}

function updateScoreboard(repoRoot: string, vendor: string, report: ConfessReport): ScoreboardEntry {
  const sb = readScoreboard(repoRoot);
  const existing: ScoreboardEntry = sb.entries[vendor] ?? {
    vendor,
    confessions: 0,
    verifiedCount: 0,
    partialCount: 0,
    hallucinationCount: 0,
    unverifiableCount: 0,
    trustScore: 0,
    lastSeen: new Date().toISOString(),
  };
  existing.confessions += 1;
  existing.lastSeen = new Date().toISOString();
  existing.trustScore = Math.round((existing.trustScore + report.trustDelta) * 100) / 100;
  if (report.verdict === "verified") existing.verifiedCount += 1;
  else if (report.verdict === "partially_verified") existing.partialCount += 1;
  else if (report.verdict === "hallucination") existing.hallucinationCount += 1;
  else existing.unverifiableCount += 1;
  sb.entries[vendor] = existing;
  writeScoreboard(repoRoot, sb);
  return existing;
}

export const confessTool: MnemeTool = {
  name: "mneme.confess",
  category: "meta",
  description:
    "Truth Confession — before delivering a user-facing answer, the AI passes its " +
    "DRAFT + self-rated CONFIDENCE (0..1). Mneme cross-checks the draft against " +
    "ground truth: commit hashes via git rev-parse, file paths via fs check, " +
    "numeric claims flagged for human attention. Returns verdict (verified | " +
    "partially_verified | hallucination | unverifiable) + per-AI-vendor lifetime " +
    "scoreboard delta. Use WHEN you've drafted any user-facing answer that " +
    "includes specific facts (hashes, paths, counts) — call this LAST before delivery.",
  whenToUse:
    "You drafted a user-facing answer that includes any factual claim — call this last before delivery to grade your own honesty.",
  triggers: ["confess this draft", "is my answer truthful", "self-grade my draft"],
  inputSchema: {
    type: "object",
    properties: {
      draft: { type: "string", description: "Your draft answer." },
      selfConfidence: { type: "number", description: "Your own confidence the draft is correct (0..1)." },
      vendor: {
        type: "string",
        description: "Your AI vendor / model identifier (e.g. 'claude-opus-4-7', 'cursor-cmd-k', 'codex-cli'). Used for scoreboard.",
      },
    },
    required: ["draft", "selfConfidence", "vendor"],
  },
  outputSchema: {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["verified", "partially_verified", "hallucination", "unverifiable"] },
      selfConfidence: { type: "number" },
      mnemeConfidence: { type: "number" },
      findings: { type: "array", items: { type: "object" } },
      trustDelta: { type: "number", description: "Change to vendor's lifetime trust score (-1..+1)." },
      guidance: { type: "string" },
      vendorScoreboard: {
        type: "object",
        description: "Updated scoreboard entry for the vendor — confession count + trust trajectory.",
      },
    },
  },
  examples: [
    {
      userQuery: "(internal — agent calls last, before delivery)",
      args: {
        draft: "The auth refactor in commit a3f9b21 introduced a 7-day TTL (see src/auth/middleware.ts).",
        selfConfidence: 0.85,
        vendor: "claude-opus-4-7",
      },
      expectedOutput:
        "Returns { verdict, findings: [{commit-hash a3f9b21 ...}, {file-path src/auth/middleware.ts ...}], trustDelta, guidance }. Update vendor scoreboard. If hallucination → DO NOT deliver, rewrite first.",
    },
  ],
  pitfalls: [
    "Doesn't read CODE — only checks if files exist + hashes resolve. A hallucinated function NAME inside an existing file passes this check.",
    "Numeric claims are FLAGGED, not graded — Mneme can't tell if 'we have 87 tests' is true. Pair with mneme.audit.report or run the test suite for ground truth.",
    "selfConfidence calibration: if you're confident AND wrong, the trust penalty is ×1.5 (HARDER on overconfidence than on humble mistakes).",
    "Vendor scoreboard is local to the repo — there's no global aggregation (yet). Plan for v1.19+: opt-in upload to a public dashboard.",
  ],
  composeWith: ["mneme.verify_claims", "mneme.adversary.cross_examine", "mneme.grade.answer"],
  handler: async (rt, args) => {
    const draft = String(args["draft"] ?? "");
    const selfConfidence = Math.max(0, Math.min(1, Number(args["selfConfidence"] ?? 0.5)));
    const vendor = String(args["vendor"] ?? "unknown").trim() || "unknown";
    if (!draft) {
      return {
        data: { error: "missing required argument: draft" },
        wisdom: "Pass your draft answer text and a self-confidence score (0..1).",
        confidence: { level: "high" },
      };
    }
    const report = confessDraft(draft, selfConfidence, rt.meta.rootPath);
    let scoreboard: ScoreboardEntry | undefined;
    try {
      scoreboard = updateScoreboard(rt.meta.rootPath, vendor, report);
    } catch {
      // Scoreboard is best-effort — never block confession on a write error.
    }
    // v1.20.0 — record outcome in karma streaks; surface unlocks back
    // to the agent so positive feedback flows real-time.
    let unlockedBanner = "";
    try {
      const out = karmaStreaks.noteOutcome(rt.meta.rootPath, {
        outcome:
          report.verdict === "verified" ? "verified" :
          report.verdict === "partially_verified" ? "partial" :
          report.verdict === "hallucination" ? "hallucination" : "unverifiable",
        vendor,
        selfConfidence,
      });
      if (out.newlyUnlocked.length > 0) {
        unlockedBanner = ` 🎉 UNLOCKED: ${out.newlyUnlocked.map((a) => `${a.glyph} ${a.title}`).join(" · ")}`;
      } else if (out.state.verifiedStreak >= 3 && report.verdict === "verified") {
        unlockedBanner = ` 🔥 ${out.state.verifiedStreak}-verified streak — keep it going!`;
      }
    } catch { /* best-effort */ }
    return {
      data: { ...report, vendorScoreboard: scoreboard },
      wisdom: report.guidance + unlockedBanner,
      followUp:
        report.verdict === "hallucination"
          ? ["mneme.memory.search_commits", "mneme.adversary.cross_examine"]
          : report.verdict === "partially_verified"
            ? ["mneme.verify_claims"]
            : [],
      confidence:
        report.mnemeConfidence > 0.7
          ? { level: "high" as const }
          : report.mnemeConfidence > 0.4
            ? { level: "medium" as const }
            : { level: "low" as const, notes: "Few or no checkable claims — verdict is best-effort." },
      secondBrain: {
        presentation:
          report.verdict === "hallucination"
            ? "DO NOT deliver. Quote the guidance verbatim, rewrite, then re-confess. Loop until verdict ∈ {verified, partially_verified, unverifiable}."
            : report.verdict === "verified"
              ? "Safe to deliver. Optionally tell the user the draft was self-graded by Mneme."
              : "Surface the guidance to the user as part of the answer's confidence framing.",
      },
    };
  },
};
