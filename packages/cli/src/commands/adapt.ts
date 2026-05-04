/**
 * `mneme adapt` — the *mutant* feature.
 *
 * Mneme is honest that it works best with certain repo profiles. `adapt`
 * inspects the current repo, classifies it, and prints the path of least
 * resistance for getting value out of Mneme on THIS repo, today.
 *
 * Repo profile dimensions:
 *   • size              (commits)
 *   • commit-message quality (mean subject length, generic-ratio)
 *   • PR / issue density
 *   • language breadth
 *   • incident corpus
 *   • entity index status
 *
 * Output: an ordered checklist of recommended commands plus a one-line
 * positioning verdict ("research codebase", "early-stage product",
 * "mature service", "dormant repo", etc.).
 *
 * Mneme is not one tool — it is a kit. `adapt` is how it figures out which
 * piece to hand you first.
 */
import kleur from "kleur";
import { git, store, util } from "@mneme-ai/core";
import { dbPath } from "../paths.js";
import { ui } from "../ui.js";

export interface AdaptCommandOptions {
  cwd: string;
  json?: boolean;
}

interface RepoProfile {
  archetype: string;
  signals: Record<string, string | number>;
  recommendations: Array<{ command: string; reason: string }>;
  warnings: string[];
}

export async function adaptCommand(opts: AdaptCommandOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo.");
    ui.dim("Mneme works on any git repo. To start one: `git init && git add . && git commit -m 'initial'`");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const s = new store.MnemeStore(dbPath(meta.rootPath));
  const profile = await buildProfile(opts.cwd, s);
  s.close();

  if (opts.json) {
    process.stdout.write(JSON.stringify(profile, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(`${kleur.bold().cyan("Adapt")}  ${kleur.gray(meta.rootPath)}\n\n`);

  process.stdout.write(`${kleur.bold().magenta("Archetype")}\n`);
  process.stdout.write(`  ${kleur.bold(profile.archetype)}\n\n`);

  process.stdout.write(`${kleur.bold().magenta("Signals")}\n`);
  for (const [k, v] of Object.entries(profile.signals)) {
    process.stdout.write(`  ${kleur.gray(k.padEnd(22))} ${v}\n`);
  }
  process.stdout.write("\n");

  if (profile.warnings.length) {
    process.stdout.write(`${kleur.bold().yellow("Honest caveats")}\n`);
    for (const w of profile.warnings) {
      process.stdout.write(`  ${kleur.yellow("!")} ${w}\n`);
    }
    process.stdout.write("\n");
  }

  process.stdout.write(`${kleur.bold().magenta("Recommended next commands")}\n`);
  if (profile.recommendations.length === 0) {
    process.stdout.write(`  ${kleur.green("●")} you're set. Mneme has nothing to add right now.\n`);
  } else {
    for (let i = 0; i < profile.recommendations.length; i++) {
      const r = profile.recommendations[i]!;
      process.stdout.write(
        `  ${kleur.green(`${i + 1}.`)} ${kleur.bold(r.command)}\n` +
          `      ${kleur.gray(r.reason)}\n`,
      );
    }
  }
  process.stdout.write(
    "\n" + kleur.gray("  Adapt is deterministic — same repo state → same output. Re-run anytime.") + "\n",
  );
  return 0;
}

async function buildProfile(cwd: string, s: store.MnemeStore): Promise<RepoProfile> {
  const recommendations: Array<{ command: string; reason: string }> = [];
  const warnings: string[] = [];
  const signals: Record<string, string | number> = {};

  // 1. Are there commits in the working repo (not in store)?
  const totalCommitsRaw = await git.execGit(["rev-list", "--all", "--count"], { cwd });
  const totalCommits =
    totalCommitsRaw.code === 0 ? Number(totalCommitsRaw.stdout.trim()) : 0;
  signals["commits in repo"] = totalCommits;

  // 2. Index status
  const indexedCommits = s.countCommits();
  const indexedChunks = s.countChunks();
  const indexedEntities = s.countEntities();
  const indexedIncidents = s.db.prepare("SELECT COUNT(*) AS n FROM incidents").get() as { n: number };
  const correlationCount = s.db.prepare("SELECT COUNT(*) AS n FROM correlations").get() as { n: number };
  const synthesizedCount = s.countSynthesizedNotes();
  signals["commits indexed"] = indexedCommits;
  signals["entities indexed"] = indexedEntities;
  signals["incidents indexed"] = indexedIncidents.n;
  signals["correlations stored"] = correlationCount.n;
  signals["synthesized notes"] = synthesizedCount;

  // 3. Commit-message quality (sample first 200 indexed)
  let avgSubjectLen = 0;
  let genericRatio = 0;
  let prRatio = 0;
  if (indexedCommits > 0) {
    const sample = util.loadAllCommits(s).slice(-200);
    const subs = sample.map((c) => c.subject.trim());
    avgSubjectLen = Math.round(subs.reduce((a, b) => a + b.length, 0) / subs.length);
    const genericRe = /^(?:wip|update[sd]?|fix|fixed|fixes|tweak|misc|stuff|adjust|chore|cleanup|refactor)\.?$/i;
    genericRatio = subs.filter((x) => genericRe.test(x)).length / subs.length;
    prRatio = sample.filter((c) => c.prNumber).length / sample.length;
  }
  if (indexedCommits > 0) {
    signals["avg subject length"] = avgSubjectLen;
    signals["generic-msg ratio"] = (genericRatio * 100).toFixed(0) + "%";
    signals["PR-tagged ratio"] = (prRatio * 100).toFixed(0) + "%";
  }

  // 4. Decide archetype + recommendations.

  // Path 0: not initialized at all.
  if (indexedCommits === 0) {
    if (totalCommits === 0) {
      return {
        archetype: "Empty repo (no commits yet)",
        signals,
        recommendations: [
          { command: "make a few commits with real messages", reason: "Mneme needs history to be useful." },
          { command: "mneme init && mneme index", reason: "Run after you have ≥10 commits." },
        ],
        warnings: [
          "Brand-new repos have no signal. Wait for ≥50 commits before judging Mneme's quality.",
        ],
      };
    }
    return {
      archetype: "Indexed-not-yet repo",
      signals,
      recommendations: [
        { command: "mneme init", reason: "Set up the local store." },
        { command: "mneme index", reason: `Index the ${totalCommits} existing commits — this is the foundation.` },
      ],
      warnings: [],
    };
  }

  // Path 1: tiny repo
  if (indexedCommits < 30) {
    warnings.push(
      `Only ${indexedCommits} commits indexed — Mneme's value compounds with history. Treat results as preview-quality.`,
    );
  }

  // Path 2: poor commit messages.
  if (genericRatio > 0.4 || avgSubjectLen < 25) {
    recommendations.push({
      command: "mneme heal",
      reason: `${(genericRatio * 100).toFixed(0)}% of recent commit subjects are generic ("wip"/"fix"/"updated"). Heal synthesizes a WHY note from the diff so search can answer.`,
    });
  }

  // Path 3: no Phase-2 entities yet.
  if (indexedEntities === 0) {
    recommendations.push({
      command: "mneme entities",
      reason: "No entity-level memory yet. Required before `mneme clones`, `mneme teach`, and richer answers about WHAT the code does.",
    });
  } else {
    recommendations.push({
      command: "mneme clones --threshold 0.85",
      reason: `${indexedEntities} entities indexed — surface near-duplicate functions ripe for refactor.`,
    });
  }

  // Path 4: no incidents — recommend the manual path or pager.
  if (indexedIncidents.n === 0) {
    recommendations.push({
      command: "mneme correlate --source manual --file ./incidents.json",
      reason: "No incidents indexed. Even a small JSON list unlocks blast radius + conscience scoring.",
    });
  } else if (correlationCount.n === 0) {
    recommendations.push({
      command: "mneme correlate --source pager --org X --project Y",
      reason: `${indexedIncidents.n} incidents but 0 correlations — re-run correlate so the engine writes edges to the store.`,
    });
  }

  // Path 5: lots of correlations — push viz + conscience + palimpsest.
  if (correlationCount.n > 5) {
    recommendations.push({
      command: "mneme web",
      reason: `${correlationCount.n} correlations — the temporal graph view becomes useful at this density.`,
    });
    recommendations.push({
      command: "mneme conscience <changed-files>",
      reason: "Use the historical graph as a pre-merge advisor for your next PR.",
    });
  }

  // Path 6: solo project with no PR data — encourage GitHub PR fetcher.
  if (prRatio < 0.05 && indexedCommits >= 50) {
    recommendations.push({
      command: "set GITHUB_TOKEN, then re-run `mneme index`",
      reason: "No PR signal in commits. With a token, Mneme hydrates each commit with PR/issue body — the single biggest accuracy gain.",
    });
  }

  // Path 7: mature repo — onboarding angle.
  if (indexedCommits >= 200) {
    recommendations.push({
      command: "mneme mirror",
      reason: "Mature codebase. Use the onboarding dossier when a new contributor joins.",
    });
  }

  // Determine archetype.
  let archetype = "Engineering codebase";
  if (indexedCommits >= 1000) archetype = "Mature, large codebase";
  else if (indexedCommits >= 200) archetype = "Active service / library";
  else if (indexedCommits >= 50) archetype = "Early-stage product";
  else archetype = "Young / personal repo";

  if (genericRatio > 0.5) archetype += " — sparse commit hygiene";
  if (prRatio > 0.5) archetype += " — PR-driven workflow";
  if (correlationCount.n > 5) archetype += " — incident-correlated";

  return {
    archetype,
    signals,
    recommendations,
    warnings,
  };
}
