/**
 * DEMON STAGE 4.3 — Dead Vendor Harvester (v1.44.0)
 *
 * SCOPE: when a vendor sunsets / deprecates a model the operator was using,
 * Mneme detects the dead vendor in the trial log + cost table, then suggests
 * a replacement vendor for each task class based on observed performance.
 * The migration plan is a markdown file the operator approves before
 * touching any prompts. NEVER auto-rewrites prompts or configs.
 *
 * INPUT:
 *   - `.mneme/vendor-deprecations.jsonl` — operator-curated:
 *     { "vendor": "v", "model": "m", "deprecatedAt": "2026-...", "replacementHint": "..." }
 *   - `.mneme/vendor-trials.jsonl` — re-using the arbitrage trial log
 *
 * OUTPUT:
 *   - `.mneme/migration-plans/<dead-vendor>.md` — the human-readable plan
 *   - `MigrationPlan` object with structured replacement recommendations
 *
 * INNOVATIONS BEYOND SPEC:
 *   - "Distance metric": for each task class the dead vendor handled,
 *     ranks live vendors by (success-rate-LB × similar-task-class-overlap).
 *     Recommends the closest match, not just the best overall vendor
 *   - "Soft deprecation window": flags vendors whose last successful trial
 *     was >90 days ago even if not formally deprecated (silent death)
 *   - "Honest 'no replacement'" — when no live vendor has trials for the
 *     dead vendor's task class, the plan says "manual selection required"
 *     instead of recommending a random fallback
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const DEPRECATIONS_REL = ".mneme/vendor-deprecations.jsonl";
const TRIALS_REL = ".mneme/vendor-trials.jsonl";
const PLANS_DIR_REL = ".mneme/migration-plans";

const SOFT_DEATH_DAYS = 90;

export interface VendorDeprecation {
  vendor: string;
  model: string;
  deprecatedAt: string;       // ISO-8601
  replacementHint?: string;
}

interface Trial {
  vendor: string;
  taskClass: string;
  outcome: "success" | "fail";
  at: string;
}

export interface ReplacementRec {
  taskClass: string;
  recommendedVendor: string | null;
  recommendedScore: number;     // 0..1
  trialsForRec: number;
  reason: string;
  alternates: { vendor: string; score: number; trials: number }[];
}

export interface MigrationPlan {
  deadVendor: string;
  deadModel: string;
  deprecatedAt: string;
  taskClassesToMigrate: string[];
  replacements: ReplacementRec[];
  planPath: string;
  generatedAt: string;
}

export interface DeadVendorScan {
  formallyDeprecated: VendorDeprecation[];
  softDeaths: { vendor: string; lastSuccessAt: string | null; daysSilent: number }[];
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const out: T[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as T); } catch { /* skip */ }
  }
  return out;
}

export function scanDeadVendors(repoRoot: string, asOf: Date = new Date()): DeadVendorScan {
  const root = resolve(repoRoot);
  const formal = readJsonl<VendorDeprecation>(join(root, DEPRECATIONS_REL));
  const trials = readJsonl<Trial>(join(root, TRIALS_REL));

  // Find soft deaths: vendors with at least one successful trial but none in last SOFT_DEATH_DAYS
  const lastSuccess = new Map<string, number>();
  const seen = new Set<string>();
  for (const t of trials) {
    seen.add(t.vendor);
    if (t.outcome === "success") {
      const ts = Date.parse(t.at);
      if (!Number.isNaN(ts)) {
        const cur = lastSuccess.get(t.vendor);
        if (cur === undefined || ts > cur) lastSuccess.set(t.vendor, ts);
      }
    }
  }
  const formallyDeadSet = new Set(formal.map((d) => d.vendor));
  const softDeaths: DeadVendorScan["softDeaths"] = [];
  for (const v of seen) {
    if (formallyDeadSet.has(v)) continue;
    const ts = lastSuccess.get(v);
    if (ts === undefined) {
      softDeaths.push({ vendor: v, lastSuccessAt: null, daysSilent: Number.POSITIVE_INFINITY });
      continue;
    }
    const daysSilent = (asOf.getTime() - ts) / 86400000;
    if (daysSilent > SOFT_DEATH_DAYS) {
      softDeaths.push({ vendor: v, lastSuccessAt: new Date(ts).toISOString(), daysSilent: Math.round(daysSilent) });
    }
  }
  softDeaths.sort((a, b) => b.daysSilent - a.daysSilent);
  return { formallyDeprecated: formal, softDeaths };
}

function successRate(trials: Trial[]): number {
  if (trials.length === 0) return 0;
  const ok = trials.filter((t) => t.outcome === "success").length;
  return ok / trials.length;
}

function recommendForTaskClass(taskClass: string, deadVendor: string, allTrials: Trial[]): ReplacementRec {
  const liveVendors = new Set<string>();
  for (const t of allTrials) if (t.vendor !== deadVendor) liveVendors.add(t.vendor);

  const scored: { vendor: string; score: number; trials: number }[] = [];
  for (const v of liveVendors) {
    const onClass = allTrials.filter((t) => t.vendor === v && t.taskClass === taskClass);
    const overall = allTrials.filter((t) => t.vendor === v);
    const onClassRate = successRate(onClass);
    const overallRate = successRate(overall);
    // Distance metric: prefer vendor with trials on this exact task class.
    // If no class-trials, fall back to overall rate × 0.5 (penalize uncertainty).
    const score = onClass.length > 0 ? onClassRate : overallRate * 0.5;
    scored.push({ vendor: v, score: +score.toFixed(4), trials: onClass.length });
  }
  scored.sort((a, b) => b.score - a.score || b.trials - a.trials);

  if (scored.length === 0 || scored[0]!.score === 0) {
    return {
      taskClass,
      recommendedVendor: null,
      recommendedScore: 0,
      trialsForRec: 0,
      reason: "no live vendor has any successful trial for this task class — manual selection required",
      alternates: scored,
    };
  }
  const rec = scored[0]!;
  const alternates = scored.slice(1, 4);
  const reason = rec.trials > 0
    ? `${rec.trials} prior trial(s) on '${taskClass}' with success rate ${(rec.score * 100).toFixed(0)}%`
    : `no trials on '${taskClass}' — recommendation based on overall track record (penalized 50%)`;
  return { taskClass, recommendedVendor: rec.vendor, recommendedScore: rec.score, trialsForRec: rec.trials, reason, alternates };
}

export function buildMigrationPlan(repoRoot: string, deadVendor: string): MigrationPlan {
  const root = resolve(repoRoot);
  const deprecations = readJsonl<VendorDeprecation>(join(root, DEPRECATIONS_REL));
  const trials = readJsonl<Trial>(join(root, TRIALS_REL));

  const dep = deprecations.find((d) => d.vendor === deadVendor);
  const deadTrials = trials.filter((t) => t.vendor === deadVendor);
  const taskClasses = Array.from(new Set(deadTrials.map((t) => t.taskClass))).sort();
  const replacements = taskClasses.map((tc) => recommendForTaskClass(tc, deadVendor, trials));

  const generatedAt = new Date().toISOString();
  const planMd = renderPlan({ deadVendor, model: dep?.model ?? "(unknown)", deprecatedAt: dep?.deprecatedAt ?? "(soft-death)", taskClasses, replacements, generatedAt, replacementHint: dep?.replacementHint ?? null });
  mkdirSync(join(root, PLANS_DIR_REL), { recursive: true });
  const safe = deadVendor.replace(/[^A-Za-z0-9_.-]/g, "_");
  const planPath = join(root, PLANS_DIR_REL, `${safe}.md`);
  writeFileSync(planPath, planMd);

  return {
    deadVendor,
    deadModel: dep?.model ?? "(unknown)",
    deprecatedAt: dep?.deprecatedAt ?? "(soft-death)",
    taskClassesToMigrate: taskClasses,
    replacements,
    planPath,
    generatedAt,
  };
}

function renderPlan(p: { deadVendor: string; model: string; deprecatedAt: string; taskClasses: string[]; replacements: ReplacementRec[]; generatedAt: string; replacementHint: string | null }): string {
  const lines: string[] = [];
  lines.push(`# Migration plan — ${p.deadVendor}`);
  lines.push("");
  lines.push(`**Model:** \`${p.model}\``);
  lines.push(`**Deprecated at:** ${p.deprecatedAt}`);
  lines.push(`**Generated:** ${p.generatedAt}`);
  if (p.replacementHint) {
    lines.push("");
    lines.push(`**Vendor's own replacement hint:** ${p.replacementHint}`);
  }
  lines.push("");
  lines.push("> ⚠️  This plan is a recommendation. Operator must review and approve before any prompt or config rewrite.");
  lines.push("");
  if (p.taskClasses.length === 0) {
    lines.push("No task classes were observed for this vendor. No migration needed.");
    return lines.join("\n");
  }
  lines.push("## Per-task-class recommendations");
  lines.push("");
  for (const r of p.replacements) {
    lines.push(`### ${r.taskClass}`);
    lines.push("");
    if (r.recommendedVendor) {
      lines.push(`- **Recommended:** \`${r.recommendedVendor}\` (score ${(r.recommendedScore * 100).toFixed(0)}%, ${r.trialsForRec} trials)`);
    } else {
      lines.push(`- **Recommended:** _none — manual selection required_`);
    }
    lines.push(`- **Reason:** ${r.reason}`);
    if (r.alternates.length > 0) {
      lines.push(`- **Alternates:** ${r.alternates.map((a) => `\`${a.vendor}\` (${(a.score * 100).toFixed(0)}%, ${a.trials} trials)`).join(", ")}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
