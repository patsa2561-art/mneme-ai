/** Repo filesystem/git helpers for the X-Ray battery. Deterministic, fail-safe. */
import { spawnSync } from "node:child_process";
import { readFileSync, statSync, readdirSync } from "node:fs";
import { join, extname, basename, relative, sep } from "node:path";

/** Run git read-only; returns stdout or "" on any failure (never throws).
 *  v3.148: a hard timeout (default 45s) so a huge/slow repo degrades GRACEFULLY to ""
 *  instead of hanging the request forever (the cause of empty badges on large repos).
 *  A timeout makes spawnSync set .error/.signal → status !== 0 → "" (honest partial). */
export function git(repoPath: string, args: string[], timeoutMs = 45_000): string {
  try {
    const r = spawnSync("git", args, { cwd: repoPath, encoding: "utf8", maxBuffer: 96 * 1024 * 1024, timeout: timeoutMs });
    if (r.status !== 0 || r.error) return "";
    return r.stdout ?? "";
  } catch {
    return "";
  }
}

export function headCommit(repoPath: string): string {
  return git(repoPath, ["rev-parse", "HEAD"]).trim() || "unknown";
}

/** True only if the path is inside a real git work tree (so we can be honest
 *  about non-git folders instead of reporting empty/garbage history). */
export function isGitRepo(repoPath: string): boolean {
  return git(repoPath, ["rev-parse", "--is-inside-work-tree"]).trim() === "true";
}

/** Source-text extensions the secret + complexity scanners look at. */
const TEXT_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java",
  ".c", ".h", ".cpp", ".cc", ".rb", ".php", ".cs", ".kt", ".swift", ".scala",
  ".sh", ".bash", ".env", ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg",
  ".xml", ".gradle", ".properties", ".tf", ".sql", ".vue", ".svelte",
]);

const SKIP_DIR = /(^|\/)(node_modules|\.git|dist|build|vendor|\.next|coverage|__pycache__|\.venv|target)(\/|$)/;

export interface RepoFile { rel: string; abs: string }

/** Recursive filesystem walk — the fallback for NON-git folders (so a plain
 *  local folder, never uploaded, still gets scanned). Skips vendor dirs. */
function walkFiles(root: string, maxFiles: number): { rels: string[]; truncated: boolean } {
  const rels: string[] = [];
  let truncated = false;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const abs = join(dir, e.name);
      const rel = relative(root, abs).split(sep).join("/");
      if (SKIP_DIR.test(rel) || e.name.startsWith(".")) continue;
      if (e.isDirectory()) { stack.push(abs); continue; }
      if (!e.isFile() || !TEXT_EXT.has(extname(e.name).toLowerCase())) continue;
      if (rels.length >= maxFiles) { truncated = true; return { rels, truncated }; }
      rels.push(rel);
    }
  }
  return { rels, truncated };
}

/** Text files to scan — tracked files via `git ls-files`, or a filesystem walk
 *  when the folder is not a git repo (or git lists nothing). Capped at maxFiles. */
export function listTextFiles(repoPath: string, maxFiles: number): { files: RepoFile[]; truncated: boolean } {
  let rels = git(repoPath, ["ls-files"]).split("\n").map((s) => s.trim()).filter(Boolean);
  let truncated = false;
  if (rels.length === 0) { const w = walkFiles(repoPath, maxFiles); rels = w.rels; truncated = w.truncated; }
  const out: RepoFile[] = [];
  for (const rel of rels) {
    if (SKIP_DIR.test(rel)) continue;
    if (!TEXT_EXT.has(extname(rel).toLowerCase())) continue;
    if (out.length >= maxFiles) { truncated = true; break; }
    out.push({ rel, abs: join(repoPath, rel) });
  }
  return { files: out, truncated };
}

/** Read a small text file; "" on failure or if too large (>2MB). */
export function readText(abs: string): string {
  try {
    const st = statSync(abs);
    if (!st.isFile() || st.size > 2 * 1024 * 1024) return "";
    return readFileSync(abs, "utf8");
  } catch {
    return "";
  }
}

export function repoNameFromUrl(url: string): string {
  const m = url.replace(/\.git$/, "").match(/[/:]([^/]+\/[^/]+)$/);
  return m ? m[1] : url.replace(/\.git$/, "");
}

export function repoNameFromPath(p: string): string {
  return basename(p.replace(/[/\\]+$/, "")) || "repo";
}
