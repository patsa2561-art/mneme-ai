/**
 * `mneme bot` — auto-comment on PRs / MRs across CI platforms.
 *
 * Detects the CI platform (GitHub / GitLab / Bitbucket), runs a chosen
 * set of analyzers, assembles a single Markdown comment, and posts it.
 *
 * --dry-run prints the rendered comment without posting (and without
 * needing a token).  This is the default smoke path on a developer
 * laptop — same code path, just no network call.
 *
 * Internal architecture:
 *   1. Run analyzer subcommands as child processes with --json.
 *   2. Hand their JSON to `bot.formatComment`.
 *   3. Resolve the platform adapter (or honor --platform / --pr).
 *   4. Post (or print, on --dry-run).
 */

import { execFileSync } from "node:child_process";
import kleur from "kleur";
import { bot, git, audit as auditNs } from "@mneme-ai/core";
import { ui } from "../ui.js";

export type IncludeKind = "audit" | "atrophy" | "ghost" | "promise";
const ALL_INCLUDES: IncludeKind[] = ["audit", "atrophy", "ghost", "promise"];
const DEFAULT_INCLUDES: IncludeKind[] = ["audit", "atrophy"];

export interface BotOptions {
  cwd: string;
  /** Override the PR/MR number. */
  pr?: number;
  /** Override the platform — by default we auto-detect. */
  platform?: bot.PlatformName;
  /** Comma-separated analyzer list — defaults to "audit,atrophy". */
  include?: string;
  /** Print without posting. */
  dryRun?: boolean;
  /** Machine-readable output. */
  json?: boolean;
  /**
   * Test seam — override the runner used to invoke `mneme <cmd> --json`.
   * Defaults to spawning this same process executable.
   */
  runner?: AnalyzerRunner;
  /**
   * Test seam — override platform adapters (e.g. inject mock fetcher).
   */
  adapters?: bot.PlatformAdapter[];
}

export interface AnalyzerRunner {
  /** Run a Mneme subcommand and return its parsed JSON. Returns null on failure. */
  run(args: string[], cwd: string): unknown | null;
}

/**
 * Default runner — re-spawns the CLI binary in a child process.  Lives
 * here (not in core) because it depends on the CLI's bin shim layout.
 */
const defaultRunner: AnalyzerRunner = {
  run(args, cwd) {
    try {
      const out = execFileSync(process.execPath, [resolveCliBin(), ...args, "--json"], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
      });
      // Some commands prepend a banner before JSON when stdout is a TTY.
      // We've forced NO_COLOR so the JSON is the entire stdout.  Be lenient
      // and slice to the first '{' just in case.
      const idx = out.indexOf("{");
      if (idx < 0) return null;
      return JSON.parse(out.slice(idx));
    } catch {
      return null;
    }
  },
};

function resolveCliBin(): string {
  // packages/cli/bin/mneme.js — the same shim users invoke.
  // We resolve relative to this file at runtime; in dist/ it is co-located.
  // node's import.meta.url isn't easily available in CJS-translated outputs,
  // so we fall back to argv[1] which is whichever shim launched us.
  return process.argv[1] ?? "mneme";
}

export async function botCommand(opts: BotOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const includes = parseIncludes(opts.include);
  const runner = opts.runner ?? defaultRunner;

  // 1. Run analyzers
  const auditRaw = includes.includes("audit") ? runner.run(["audit", "--certify"], opts.cwd) : null;
  const atrophyRaw = includes.includes("atrophy") ? runner.run(["atrophy"], opts.cwd) : null;
  const ghostRaw = includes.includes("ghost") ? runner.run(["ghost"], opts.cwd) : null;
  const promiseRaw = includes.includes("promise") ? runner.run(["promise"], opts.cwd) : null;

  // 2. Resolve platform context (only for non-dry-run posting)
  const adapter = bot.detectPlatform({ name: opts.platform, adapters: opts.adapters });
  const ctx = adapter ? adapter.resolveContext() : {};
  const prNumber = opts.pr ?? ctx.pr;

  // 3. Repo + sha for footer (best-effort — never fails the command)
  const sha = safeGitHead(opts.cwd);
  const repo = ctx.repo;

  // 4. Assemble comment
  const body = bot.formatComment({
    audit: shapeAudit(auditRaw),
    atrophy: shapeAtrophy(atrophyRaw),
    ghost: shapeGhost(ghostRaw),
    promise: shapePromise(promiseRaw),
    context: { repo, sha, branch: undefined },
  });

  // 5. Dry-run / JSON early exits
  if (opts.dryRun) {
    if (opts.json) {
      process.stdout.write(
        JSON.stringify(
          {
            mode: "dry-run",
            platform: adapter?.name ?? null,
            pr: prNumber ?? null,
            includes,
            body,
          },
          null,
          2,
        ) + "\n",
      );
    } else {
      process.stdout.write(`${kleur.cyan("◉")} ${kleur.bold("mneme bot")} ${kleur.gray(`(dry-run · platform=${adapter?.name ?? "none"} · pr=${prNumber ?? "?"})`)}\n\n`);
      process.stdout.write(body);
      process.stdout.write("\n");
    }
    return 0;
  }

  // 6. Post — adapter required from here
  if (!adapter) {
    ui.error("No CI platform detected. Pass --platform <github|gitlab|bitbucket> or use --dry-run.");
    return 1;
  }

  const result = await adapter.post({
    repo,
    pr: prNumber,
    token: ctx.token,
    body,
  });

  if (opts.json) {
    process.stdout.write(JSON.stringify({ mode: "post", platform: adapter.name, ...result }, null, 2) + "\n");
    return result.ok ? 0 : 1;
  }

  if (result.ok) {
    process.stdout.write(`${kleur.green("✓")} posted to ${kleur.bold(adapter.name)} ${kleur.gray(`(pr ${prNumber})`)}${result.url ? `\n  ${kleur.cyan(result.url)}` : ""}\n`);
    return 0;
  }
  ui.error(`${adapter.name}: ${result.error ?? "post failed"}`);
  return 1;
}

// ─── parsers ──────────────────────────────────────────────────────────

export function parseIncludes(raw: string | undefined): IncludeKind[] {
  if (!raw || raw.trim() === "") return DEFAULT_INCLUDES;
  const parts = raw
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  const picked: IncludeKind[] = [];
  for (const p of parts) {
    if ((ALL_INCLUDES as string[]).includes(p) && !picked.includes(p as IncludeKind)) {
      picked.push(p as IncludeKind);
    }
  }
  return picked.length > 0 ? picked : DEFAULT_INCLUDES;
}

// ─── shape adapters — coerce raw JSON shapes into bot.formatComment inputs ──

/**
 * Audit JSON arrives as an `AuditCertificate`-shaped object — we just
 * verify the minimum invariant and pass it through.  The bot module's
 * markdown renderer is defensive, so missing optional fields are fine.
 */
function shapeAudit(raw: unknown): auditNs.AuditCertificate | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  // We require at least the overallVerdict + axes shape.
  if (typeof r.overallVerdict !== "string" || typeof r.axes !== "object" || r.axes === null) return null;
  return raw as auditNs.AuditCertificate;
}

function shapeAtrophy(raw: unknown): bot.AtrophyReport | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { mode?: string; atRiskFiles?: unknown; stats?: unknown };
  // Only handle repo-mode output.
  if (r.mode && r.mode !== "repo") return null;
  if (!Array.isArray(r.atRiskFiles)) return null;
  const stats = (r.stats as { halfLifeDays?: number; fileCount?: number; filesWithLiveExpert?: number; ghostedFiles?: number; ghostedDeepFiles?: number }) ?? {};
  const atRiskFiles: bot.AtrophyAtRiskFile[] = r.atRiskFiles
    .map((f): bot.AtrophyAtRiskFile | null => {
      if (!f || typeof f !== "object") return null;
      const fr = f as {
        filePath?: string;
        totalTouches?: number;
        tier?: string;
        freshestKnowledge?: number;
        allKnowers?: Array<{ name?: string; email?: string; knowledge?: number; lastTouchDaysAgo?: number; touchCount?: number }>;
      };
      const tier = fr.tier === "safe" || fr.tier === "warn" || fr.tier === "at-risk" ? fr.tier : "warn";
      return {
        filePath: String(fr.filePath ?? ""),
        totalTouches: Number(fr.totalTouches ?? 0),
        tier,
        freshestKnowledge: Number(fr.freshestKnowledge ?? 0),
        allKnowers: (fr.allKnowers ?? []).map((k) => ({
          name: String(k.name ?? ""),
          email: String(k.email ?? ""),
          knowledge: Number(k.knowledge ?? 0),
          lastTouchDaysAgo: Number(k.lastTouchDaysAgo ?? 0),
          touchCount: Number(k.touchCount ?? 0),
        })),
      };
    })
    .filter((x): x is bot.AtrophyAtRiskFile => x !== null);
  return {
    atRiskFiles,
    stats: {
      halfLifeDays: stats.halfLifeDays ?? 180,
      fileCount: stats.fileCount ?? 0,
      filesWithLiveExpert: stats.filesWithLiveExpert ?? 0,
      ghostedFiles: stats.ghostedFiles ?? 0,
      ghostedDeepFiles: stats.ghostedDeepFiles,
    },
  };
}

function shapeGhost(raw: unknown): bot.GhostReport | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { ghostFiles?: Array<{ path?: string; ghostliness?: number; reason?: string; daysSinceLastTouch?: number }> };
  if (!Array.isArray(r.ghostFiles)) return null;
  const hauntedFiles = r.ghostFiles.map((g) => ({
    filePath: String(g.path ?? ""),
    score: Number(g.ghostliness ?? 0),
    reason: String(g.reason ?? ""),
    lastTouchDaysAgo: Number(g.daysSinceLastTouch ?? 0),
  }));
  return { hauntedFiles, totalCount: hauntedFiles.length };
}

function shapePromise(raw: unknown): bot.PromiseReport | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { open?: number; kept?: number; stale?: number; topOpen?: Array<{ author?: string; promise?: string; ageDays?: number }> };
  if (!r.topOpen || !Array.isArray(r.topOpen)) return null;
  return {
    open: Number(r.open ?? 0),
    kept: Number(r.kept ?? 0),
    stale: Number(r.stale ?? 0),
    topOpen: r.topOpen.map((p) => ({
      author: String(p.author ?? ""),
      promise: String(p.promise ?? ""),
      ageDays: Number(p.ageDays ?? 0),
    })),
  };
}

// ─── git helpers ──────────────────────────────────────────────────────

function safeGitHead(cwd: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}
