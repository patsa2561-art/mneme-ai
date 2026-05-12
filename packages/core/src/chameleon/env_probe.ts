/**
 * v1.86.0 -- CHAMELEON: environment probe (no broadcasts, no API calls).
 *
 * Detects facts about the current machine + repo so transport
 * selection can adapt instead of blindly trying to push git:
 *
 *   - Is git installed?
 *   - Does this repo have an origin?
 *   - Is the origin owner the same as the local user? (fork-vs-own)
 *   - Does the repo have CI/CD that might trigger on a new branch?
 *   - Does the repo have CODEOWNERS / branch-protection hints?
 *   - Is the machine offline?
 *
 * All probes are LOCAL FILESYSTEM + LOCAL CONFIG only. We deliberately
 * do not hit any external API -- the goal is fast, deterministic,
 * privacy-respecting adaptation.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export interface EnvProbe {
  hasGit: boolean;
  hasOrigin: boolean;
  originUrl: string | null;
  /** GitHub-style owner extracted from origin URL (best-effort). */
  originOwner: string | null;
  /** Local git user.name from config. */
  localGitName: string | null;
  /** Heuristic: do owner + localGitName look like the same person? */
  isUserOwned: boolean | "unknown";
  hasCi: boolean;
  ciSurfaces: string[];
  hasCodeowners: boolean;
  hasGitlabCi: boolean;
  /** True if any push-blocking signal is detected. */
  pushRisky: boolean;
  /** Plain-English risk reasons (multiple may stack). */
  riskReasons: string[];
}

function getGitConfig(repoRoot: string, key: string): string | null {
  const r = spawnSync("git", ["config", "--get", key], { cwd: repoRoot, encoding: "utf8" });
  if (r.status !== 0) return null;
  const out = (r.stdout ?? "").trim();
  return out || null;
}

function getOriginUrl(repoRoot: string): string | null {
  const r = spawnSync("git", ["config", "--get", "remote.origin.url"], { cwd: repoRoot, encoding: "utf8" });
  if (r.status !== 0) return null;
  return (r.stdout ?? "").trim() || null;
}

/** Extract `owner` from URLs like:
 *   - https://github.com/<owner>/<repo>(.git)?
 *   - git@github.com:<owner>/<repo>.git
 *   - https://gitlab.com/<owner>/<repo>.git
 */
export function extractRepoOwner(url: string): string | null {
  const m1 = url.match(/[\/:]([A-Za-z0-9_.-]+)\/[A-Za-z0-9_.-]+?(?:\.git)?\/?$/);
  return m1 ? m1[1]! : null;
}

function looksLikeSameUser(owner: string | null, gitName: string | null): boolean | "unknown" {
  if (!owner || !gitName) return "unknown";
  const a = owner.toLowerCase().replace(/[^a-z0-9]/g, "");
  const b = gitName.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!a || !b) return "unknown";
  // exact match OR one contains the other
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  return false;
}

export function probeEnvironment(repoRoot: string): EnvProbe {
  const gitCheck = spawnSync("git", ["--version"], { encoding: "utf8" });
  const hasGit = gitCheck.status === 0;
  const originUrl = hasGit ? getOriginUrl(repoRoot) : null;
  const hasOrigin = originUrl !== null;
  const originOwner = originUrl ? extractRepoOwner(originUrl) : null;
  const localGitName = hasGit ? getGitConfig(repoRoot, "user.name") : null;
  const isUserOwned = looksLikeSameUser(originOwner, localGitName);

  const ciSurfaces: string[] = [];
  if (existsSync(join(repoRoot, ".github/workflows"))) ciSurfaces.push("github-actions");
  if (existsSync(join(repoRoot, ".gitlab-ci.yml"))) ciSurfaces.push("gitlab-ci");
  if (existsSync(join(repoRoot, ".circleci/config.yml"))) ciSurfaces.push("circleci");
  if (existsSync(join(repoRoot, "azure-pipelines.yml"))) ciSurfaces.push("azure-pipelines");
  if (existsSync(join(repoRoot, ".buildkite/pipeline.yml"))) ciSurfaces.push("buildkite");
  const hasCi = ciSurfaces.length > 0;
  const hasCodeowners = existsSync(join(repoRoot, ".github/CODEOWNERS")) || existsSync(join(repoRoot, "CODEOWNERS"));
  const hasGitlabCi = existsSync(join(repoRoot, ".gitlab-ci.yml"));

  const riskReasons: string[] = [];
  if (!hasGit) riskReasons.push("git is not installed -- cannot push at all");
  if (hasGit && !hasOrigin) riskReasons.push("no origin remote configured");
  if (hasOrigin && isUserOwned === false)
    riskReasons.push(`origin owner '${originOwner}' looks DIFFERENT from local git user '${localGitName}' -- push may hit fork/contributor flow`);
  if (hasCodeowners) riskReasons.push("CODEOWNERS present -- repo likely has review requirements");
  if (hasCi) riskReasons.push(`CI/CD detected (${ciSurfaces.join(", ")}) -- push will likely trigger pipelines`);

  const pushRisky = riskReasons.length > 0 || isUserOwned !== true;

  return {
    hasGit,
    hasOrigin,
    originUrl,
    originOwner,
    localGitName,
    isUserOwned,
    hasCi,
    ciSurfaces,
    hasCodeowners,
    hasGitlabCi,
    pushRisky,
    riskReasons,
  };
}

/** Read an opt-in marker the user explicitly wrote.
 *  v1.86: spore push is REFUSED unless this marker is present. */
export function readSporeOptIn(repoRoot: string): { optedIn: boolean; reason: string } {
  const path = join(repoRoot, ".mneme/spore/OPT_IN");
  if (!existsSync(path)) return { optedIn: false, reason: "no .mneme/spore/OPT_IN file found" };
  try {
    let raw = readFileSync(path, "utf8");
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    raw = raw.trim();
    if (!raw) return { optedIn: false, reason: "OPT_IN file is empty" };
    return { optedIn: true, reason: `opted in: ${raw.slice(0, 80)}` };
  } catch {
    return { optedIn: false, reason: "OPT_IN file unreadable" };
  }
}
