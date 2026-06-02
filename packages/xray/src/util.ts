/** Repo filesystem/git helpers for the X-Ray battery. Deterministic, fail-safe. */
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join, extname, basename } from "node:path";

/** Run git read-only; returns stdout or "" on any failure (never throws). */
export function git(repoPath: string, args: string[]): string {
  try {
    const r = spawnSync("git", args, { cwd: repoPath, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) return "";
    return r.stdout ?? "";
  } catch {
    return "";
  }
}

export function headCommit(repoPath: string): string {
  return git(repoPath, ["rev-parse", "HEAD"]).trim() || "unknown";
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

/** Tracked text files (via git ls-files), capped at maxFiles, skipping vendor dirs. */
export function listTextFiles(repoPath: string, maxFiles: number): { files: RepoFile[]; truncated: boolean } {
  const raw = git(repoPath, ["ls-files"]);
  const all = raw.split("\n").map((s) => s.trim()).filter(Boolean);
  const out: RepoFile[] = [];
  let truncated = false;
  for (const rel of all) {
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
