/**
 * Shallow-clone a PUBLIC git URL to a temp dir for analysis, then delete it.
 * The clone is read-only and removed in a finally block — nothing persists.
 * Only public URLs are accepted (no credentials in the URL).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ALLOWED = /^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(\.git)?\/?$/;

export function isAllowedPublicUrl(url: string): boolean {
  if (/@|:\/\/[^/]*:[^/]*@/.test(url.replace("https://", ""))) return false; // reject embedded creds
  return ALLOWED.test(url.trim());
}

export interface CloneHandle { path: string; dispose: () => void }

/** Shallow-clone (depth 200 so authorship/age signals are meaningful, but fast). */
export function shallowClone(url: string, depth = 200): CloneHandle {
  if (!isAllowedPublicUrl(url)) {
    throw new Error("Only public github.com / gitlab.com / bitbucket.org URLs (no credentials) are accepted.");
  }
  const dir = mkdtempSync(join(tmpdir(), "mneme-xray-"));
  const r = spawnSync("git", ["clone", "--depth", String(depth), "--no-tags", "--single-branch", url.trim(), dir], {
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const dispose = () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } };
  if (r.status !== 0) {
    dispose();
    throw new Error(`git clone failed: ${(r.stderr || "unknown error").slice(0, 200)}`);
  }
  return { path: dir, dispose };
}
