/**
 * buildXRay — the orchestrator. Runs the deterministic battery against a local
 * repo path or a shallow-cloned public git URL, composes a graded summary, and
 * returns a raw-free report. Each signal is fail-safe: if one analyzer cannot
 * run, the report still returns with that block degraded and `signalsRun` lowered.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import type { XRayReport, XRayInput, Grade, XRaySummary } from "./types.js";
import { analyzeDeps, type MetaFetcher } from "./battery/deps.js";
import { scanSecrets } from "./battery/secrets.js";
import { analyzeBusFactor } from "./battery/busfactor.js";
import { analyzeAge } from "./battery/age.js";
import { analyzeComplexity } from "./battery/complexity.js";
import { shallowClone } from "./clone.js";
import { headCommit, repoNameFromUrl, repoNameFromPath } from "./util.js";

export interface BuildOptions extends XRayInput {
  /** Injectable npm-metadata fetcher (tests). */
  depFetcher?: MetaFetcher;
}

export async function buildXRay(opts: BuildOptions): Promise<XRayReport> {
  const now = opts.now ?? Date.now();
  const maxFiles = opts.maxFiles ?? 4000;

  let repoPath: string;
  let dispose: (() => void) | null = null;
  let subject: XRayReport["subject"];

  if (opts.gitUrl) {
    const h = shallowClone(opts.gitUrl);
    repoPath = h.path;
    dispose = h.dispose;
    subject = { kind: "git-url", ref: opts.gitUrl.trim(), repoName: repoNameFromUrl(opts.gitUrl), commitHash: "" };
  } else if (opts.repoPath) {
    if (!existsSync(opts.repoPath)) throw new Error(`repoPath does not exist: ${opts.repoPath}`);
    repoPath = opts.repoPath;
    subject = { kind: "local-path", ref: "local", repoName: repoNameFromPath(opts.repoPath), commitHash: "" };
  } else {
    throw new Error("buildXRay requires either gitUrl or repoPath.");
  }

  try {
    subject.commitHash = headCommit(repoPath);

    const [deps] = await Promise.all([analyzeDeps(repoPath, now, opts.depFetcher)]);
    const secrets = scanSecrets(repoPath, maxFiles);
    const busFactor = analyzeBusFactor(repoPath);
    const age = analyzeAge(repoPath, now);
    const complexity = analyzeComplexity(repoPath, maxFiles);

    const summary = grade({ deps, secrets, busFactor, age, complexity });

    const blocks = { deps, secrets, busFactor, age, complexity };
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ subject: { repoName: subject.repoName, commitHash: subject.commitHash }, blocks }))
      .digest("hex");

    return {
      v: 1,
      subject,
      generatedAt: new Date(now).toISOString(),
      summary,
      ...blocks,
      fingerprint,
    };
  } finally {
    if (dispose) dispose();
  }
}

/** Deterministic 0-100 health score → letter grade, with one-line bullets. */
function grade(b: Pick<XRayReport, "deps" | "secrets" | "busFactor" | "age" | "complexity">): XRaySummary {
  let score = 100;
  const bullets: string[] = [];
  let signalsRun = 0;

  // secrets — a high-confidence BLOCK (strong leak signal) weighs heavily; mere
  // pattern matches are a "review" flag with a small, capped penalty, because
  // regex matching has a real false-positive rate (broad api-key patterns, a
  // security repo's own sample data). We never auto-fail a repo on pattern noise.
  if (b.secrets.filesScanned > 0) {
    signalsRun++;
    if (b.secrets.worstVerdict === "BLOCK") score -= 35;
    else if (b.secrets.totalFindings > 0) score -= Math.min(8, b.secrets.totalFindings);
    const exTail = b.secrets.excludedTestHits > 0 ? ` (+${b.secrets.excludedTestHits} in tests/docs, excluded)` : "";
    bullets.push(
      b.secrets.totalFindings === 0
        ? `🔑 No credential patterns in production code${exTail}.`
        : `🔑 ${b.secrets.totalFindings} credential-pattern match(es) in production code — review${exTail}.`,
    );
  }

  // deps
  if (b.deps.total > 0) {
    signalsRun++;
    const dying = b.deps.byBand.moribund + b.deps.byBand.dead;
    score -= Math.min(20, dying * 5);
    bullets.push(
      dying === 0
        ? `📦 ${b.deps.total} deps, none dying.`
        : `💀 ${dying} of ${b.deps.total} deps are dying${b.deps.atRisk[0]?.successor ? ` (e.g. ${b.deps.atRisk[0].name} → ${b.deps.atRisk[0].successor})` : ""}.`,
    );
  }

  // bus factor
  if (b.busFactor.authors > 0) {
    signalsRun++;
    if (b.busFactor.busFactor <= 1) score -= 15;
    if (b.busFactor.singleOwnerFilePct >= 50) score -= 10;
    bullets.push(
      b.busFactor.busFactor <= 1
        ? `🚌 Bus factor 1 — one person holds ${b.busFactor.topContributorShare}% of commits.`
        : `🚌 Bus factor ${b.busFactor.busFactor}; ${b.busFactor.singleOwnerFilePct}% of files single-owner.`,
    );
  }

  // age / vitality
  if (b.age.totalCommits > 0) {
    signalsRun++;
    if (b.age.vitality === "archived") score -= 20;
    else if (b.age.vitality === "dormant") score -= 15;
    else if (b.age.vitality === "slowing") score -= 5;
    bullets.push(`🕰️ ${b.age.vitality} · ${b.age.lifespan} old · ${b.age.totalCommits} commits.`);
  }

  // complexity (mild)
  if (b.complexity.filesAnalysed > 0) {
    signalsRun++;
    const huge = b.complexity.hotspots.filter((h) => h.bodyLines >= 150).length;
    score -= Math.min(10, huge * 2);
    bullets.push(
      b.complexity.hotspots[0]
        ? `🧩 Largest symbol ${b.complexity.hotspots[0].bodyLines} lines (${b.complexity.hotspots[0].file}).`
        : `🧩 ${b.complexity.totalSymbols} symbols analysed.`,
    );
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const g: Grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 55 ? "D" : "F";
  const headline =
    g === "A" ? "Healthy — strong signals across the board."
    : g === "F" ? "Critical — multiple high-risk signals."
    : "Mixed — some signals need attention.";

  return { headline, grade: g, signalsRun, bullets };
}
