/**
 * v1.71.0 -- SENTINEL S2: REPO-SCOPE BOUNDARY ENFORCER.
 *
 * Even when no danger-pattern matches, a command that touches paths
 * OUTSIDE the user's repo (or ~/.mneme, ~/.cache, etc) is suspect.
 *
 * The wild rule: Mneme's job is to defend ONE repo. If the AI is
 * about to touch /etc, /usr, /var, /sys, /proc, /dev, /root, or any
 * path outside the repo + ~/.{mneme,cache,npm,config,local}, raise
 * an out-of-scope alert.
 *
 * Per-repo scope means: the AI can do anything inside its sandbox,
 * but cannot reach into the operating system's furniture.
 */

import { isAbsolute, resolve, normalize, sep } from "node:path";
import { homedir } from "node:os";

export interface PathExtraction {
  /** The raw path that appeared. */
  raw: string;
  /** Normalized absolute path (best-effort). */
  resolved: string;
  /** Position in source command. */
  offset: number;
}

export interface ScopeViolation {
  path: PathExtraction;
  reason: string;
  /** "system" / "home-outside-mneme" / "device" / "network-mount". */
  category: "system" | "home-outside-mneme" | "device" | "network-mount" | "parent-escape";
}

export interface ScopeReport {
  extractedPaths: PathExtraction[];
  violations: ScopeViolation[];
  insideRepo: PathExtraction[];
  insideMnemeHome: PathExtraction[];
  headline: string;
}

const SYSTEM_PREFIXES = ["/etc", "/usr", "/var", "/sys", "/proc", "/dev", "/root", "/boot", "/lib", "/lib64", "/bin", "/sbin"];
const NETWORK_PREFIXES = ["//", "smb://", "nfs://", "\\\\"]; // SMB / NFS
const MNEME_HOME_SUBDIRS = [".mneme", ".cache/mneme", ".config/mneme"];
const ALLOWED_HOME_SUBDIRS = [...MNEME_HOME_SUBDIRS, ".npm", ".cache", ".config", ".local", ".ssh"]; // .ssh allowed for READ but creds caught by detector

// v1.71.0 -- permissive path extraction. Matches any "/foo/bar" or
// "~/foo" path-shape regardless of surrounding context. URLs (http://)
// get filtered out post-match.
const PATH_RE = /(\/[\w./~_-]+|~\/[\w./~_-]+)/g;
const RELATIVE_RE = /(\.\.\/(?:[\w.-]+\/?)+)/g;
const DEVICE_RE = /\/dev\/(sd[a-z]\d*|nvme\d+n\d+(?:p\d+)?|hd[a-z]\d*|disk\d+|mapper\/\w+|zero|null|random)\b/g;

export function extractPaths(command: string): PathExtraction[] {
  const out: PathExtraction[] = [];
  const seen = new Set<string>();
  // Pre-filter: identify URL spans so we don't extract their path components.
  const urlSpans: Array<[number, number]> = [];
  for (const u of command.matchAll(/\b(?:https?|ftp|ssh|file):\/\/\S+/g)) {
    urlSpans.push([u.index!, u.index! + u[0].length]);
  }
  const insideUrl = (offset: number): boolean => urlSpans.some(([s, e]) => offset >= s && offset < e);
  const push = (raw: string, offset: number) => {
    if (insideUrl(offset)) return;
    const expanded = raw.startsWith("~") ? raw.replace(/^~/, homedir()) : raw;
    // Keep forward slashes -- normalize() flips to backslashes on Windows
    // which breaks our prefix checks below.
    const resolvedPath = isAbsolute(expanded)
      ? normalize(expanded).replace(/\\/g, "/")
      : expanded;
    const key = `${resolvedPath}|${offset}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ raw, resolved: resolvedPath, offset });
  };
  for (const m of command.matchAll(PATH_RE)) push(m[1]!, m.index ?? 0);
  for (const m of command.matchAll(RELATIVE_RE)) push(m[1]!, m.index ?? 0);
  for (const m of command.matchAll(DEVICE_RE)) push(m[0], m.index ?? 0);
  return out;
}

function startsWithAny(path: string, prefixes: string[]): boolean {
  const lower = path.toLowerCase();
  return prefixes.some((p) => lower === p.toLowerCase() || lower.startsWith(p.toLowerCase() + sep) || lower.startsWith(p.toLowerCase() + "/"));
}

function toPosix(p: string): string { return p.replace(/\\/g, "/"); }

function isInsideRepo(repoRoot: string, p: string): boolean {
  if (!isAbsolute(p)) {
    return !p.startsWith("..");
  }
  const root = toPosix(resolve(repoRoot));
  const rel = toPosix(resolve(p));
  return rel === root || rel.startsWith(root + "/");
}

function isMnemeHome(p: string): boolean {
  if (!isAbsolute(p)) return false;
  const home = homedir();
  const pp = toPosix(p);
  return MNEME_HOME_SUBDIRS.some((sub) => {
    const full = toPosix(resolve(home, sub));
    return pp === full || pp.startsWith(full + "/");
  });
}

function isAllowedHome(p: string): boolean {
  if (!isAbsolute(p)) return false;
  const home = homedir();
  const pp = toPosix(p);
  return ALLOWED_HOME_SUBDIRS.some((sub) => {
    const full = toPosix(resolve(home, sub));
    return pp === full || pp.startsWith(full + "/");
  });
}

export function enforceScope(repoRoot: string, command: string): ScopeReport {
  const paths = extractPaths(command);
  const violations: ScopeViolation[] = [];
  const insideRepo: PathExtraction[] = [];
  const insideMnemeHome: PathExtraction[] = [];

  for (const p of paths) {
    // Device prefixes (check FIRST so /dev/sda is "device" not "system").
    if (p.resolved.startsWith("/dev/")) {
      violations.push({ path: p, reason: `Path "${p.raw}" is a block device; never legitimate for repo work.`, category: "device" });
      continue;
    }
    // System prefixes.
    if (startsWithAny(p.resolved, SYSTEM_PREFIXES)) {
      violations.push({ path: p, reason: `Path "${p.raw}" is in a system directory; outside repo scope.`, category: "system" });
      continue;
    }
    // Network mounts.
    if (NETWORK_PREFIXES.some((pre) => p.resolved.startsWith(pre))) {
      violations.push({ path: p, reason: `Path "${p.raw}" is a network mount; outside repo scope.`, category: "network-mount" });
      continue;
    }
    // Parent escapes that resolve outside repo.
    if (p.raw.startsWith("..") && isAbsolute(repoRoot)) {
      const projected = resolve(repoRoot, p.raw);
      if (!projected.startsWith(resolve(repoRoot) + sep) && projected !== resolve(repoRoot)) {
        violations.push({ path: p, reason: `Path "${p.raw}" escapes the repo via parent reference.`, category: "parent-escape" });
        continue;
      }
    }
    // Inside repo: good.
    if (isInsideRepo(repoRoot, p.resolved)) {
      insideRepo.push(p);
      continue;
    }
    // Mneme home: good.
    if (isMnemeHome(p.resolved)) {
      insideMnemeHome.push(p);
      continue;
    }
    // Other allowed home subdirs: low-priority alert.
    if (!isAllowedHome(p.resolved) && p.resolved.startsWith(homedir())) {
      violations.push({
        path: p,
        reason: `Path "${p.raw}" is in $HOME but outside Mneme/cache scope.`,
        category: "home-outside-mneme",
      });
    }
  }
  const headline = violations.length === 0
    ? `${paths.length} path(s) extracted; all within repo + Mneme scope.`
    : `${violations.length} scope violation(s) across ${new Set(violations.map((v) => v.category)).size} categor(ies).`;
  return { extractedPaths: paths, violations, insideRepo, insideMnemeHome, headline };
}
