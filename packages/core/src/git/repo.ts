import { execGit, execGitOk } from "./exec.js";
import type { RepoMeta } from "../types.js";

export async function isGitRepo(cwd: string): Promise<boolean> {
  const r = await execGit(["rev-parse", "--is-inside-work-tree"], { cwd });
  return r.code === 0 && r.stdout.trim() === "true";
}

export async function getRepoRoot(cwd: string): Promise<string> {
  return (await execGitOk(["rev-parse", "--show-toplevel"], { cwd })).trim();
}

export async function getDefaultBranch(cwd: string): Promise<string> {
  const r = await execGit(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { cwd });
  if (r.code === 0) {
    const v = r.stdout.trim();
    return v.includes("/") ? v.split("/").slice(1).join("/") : v;
  }
  for (const guess of ["main", "master", "develop"]) {
    const exists = await execGit(["rev-parse", "--verify", guess], { cwd });
    if (exists.code === 0) return guess;
  }
  return "main";
}

export async function getRemoteUrl(cwd: string): Promise<string | undefined> {
  const r = await execGit(["config", "--get", "remote.origin.url"], { cwd });
  if (r.code !== 0) return undefined;
  return r.stdout.trim() || undefined;
}

const HOST_PATTERNS: Array<{ host: RepoMeta["host"]; re: RegExp }> = [
  { host: "github", re: /github\.com[:/]([^/]+)\/([^/.]+)/i },
  { host: "gitlab", re: /gitlab\.com[:/]([^/]+)\/([^/.]+)/i },
  { host: "bitbucket", re: /bitbucket\.org[:/]([^/]+)\/([^/.]+)/i },
];

export function parseRemote(url: string | undefined): {
  host?: RepoMeta["host"];
  owner?: string;
  repo?: string;
} {
  if (!url) return {};
  for (const { host, re } of HOST_PATTERNS) {
    const m = url.match(re);
    if (m) return { host, owner: m[1], repo: m[2] };
  }
  return { host: "other" };
}

export async function getRepoMeta(cwd: string): Promise<RepoMeta> {
  const rootPath = await getRepoRoot(cwd);
  const defaultBranch = await getDefaultBranch(rootPath);
  const remoteUrl = await getRemoteUrl(rootPath);
  const { host, owner, repo } = parseRemote(remoteUrl);
  return { rootPath, defaultBranch, remoteUrl, host, owner, repo };
}
