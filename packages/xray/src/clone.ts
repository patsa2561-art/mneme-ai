/**
 * Shallow-clone a PUBLIC git URL to a temp dir for analysis, then delete it.
 * The clone is read-only and removed in a finally block — nothing persists.
 * Only public URLs are accepted (no credentials in the URL).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// owner/repo, OR deeper (GitLab nested subgroups: group/subgroup/repo). >=2 segments.
const ALLOWED = /^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+\/?$/;

export function isAllowedPublicUrl(url: string): boolean {
  if (/@|:\/\/[^/]*:[^/]*@/.test(url.replace("https://", ""))) return false; // reject embedded creds
  return ALLOWED.test(url.trim());
}

export interface CloneHandle { path: string; dispose: () => void }

/**
 * Blobless clone: FULL commit history (so age / commit-count / bus-factor are
 * ACCURATE) but file blobs are fetched lazily — fast, like a shallow clone,
 * without truncating history. A `--depth N` clone would cap commits at N and
 * report a wrong "first commit" / age for any active repo; blob:none does not.
 */
// A git branch name is a ref component: no spaces, no shell metacharacters, no
// "..", and never starting with "-" (so it can't be read as a git flag).
const SAFE_BRANCH = /^[A-Za-z0-9._\/-]{1,200}$/;
export function isSafeBranch(b: string): boolean {
  return SAFE_BRANCH.test(b) && !b.startsWith("-") && !b.includes("..") && !b.endsWith("/") && !b.includes("//");
}

export function shallowClone(url: string, branch?: string): CloneHandle {
  if (!isAllowedPublicUrl(url)) {
    throw new Error("Only public github.com / gitlab.com / bitbucket.org URLs (no credentials) are accepted.");
  }
  if (branch !== undefined && !isSafeBranch(branch)) {
    throw new Error("Invalid branch name.");
  }
  const dir = mkdtempSync(join(tmpdir(), "mneme-xray-"));
  // `--branch <b>` pins the single-branch clone to the requested ref (default
  // branch when omitted). Combined with --single-branch it never pulls the
  // whole repo's branch set — cheap + branch-isolated.
  const branchArgs = branch ? ["--branch", branch] : [];
  const r = spawnSync("git", ["clone", "--filter=blob:none", "--no-tags", "--single-branch", ...branchArgs, url.trim(), dir], {
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const dispose = () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } };
  if (r.status !== 0) {
    dispose();
    throw new Error(`git clone failed: ${(r.stderr || "unknown error").slice(0, 200)}`);
  }
  return { path: dir, dispose };
}
