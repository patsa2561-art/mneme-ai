/**
 * `mneme git-install` — install Mneme as a native git extension.
 *
 * After running this command, the user's git client treats Mneme as a
 * first-class subcommand:
 *
 *     git mneme why src/auth.ts:47
 *     git mneme audit
 *     git mneme briefing
 *
 * Plus optional git hooks (pre-commit / post-commit / pre-push / post-merge)
 * that wire Mneme into the user's natural git workflow:
 *
 *     git commit  →  pre-commit: anomaly + secret-redaction guard
 *                    post-commit: heal a poor message into a searchable WHY note
 *     git push    →  pre-push: audit certify gate (configurable threshold)
 *     git merge   →  post-merge: briefing of what changed while you were away
 *
 * Net effect: Mneme stops being "an MCP plugin for AI tools" and becomes
 * a git extension that anyone using git, on any platform, has a reason
 * to install. Stand beside git, not against the AI tools.
 */

import { existsSync, mkdirSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import kleur from "kleur";
import { ui } from "../ui.js";
import { git } from "@mneme-ai/core";

export interface GitInstallOptions {
  cwd: string;
  /** Skip writing hooks (only install the wrapper) */
  noHooks?: boolean;
  /** Choose which hooks to install. Default: all four */
  hooks?: Array<"pre-commit" | "post-commit" | "pre-push" | "post-merge">;
  /** Print what would change, don't write */
  dryRun?: boolean;
  json?: boolean;
}

interface InstallOutcome {
  step: string;
  status: "INSTALLED" | "ALREADY" | "SKIPPED" | "ERROR";
  detail: string;
}

const ALL_HOOKS = ["pre-commit", "post-commit", "pre-push", "post-merge"] as const;
type HookName = typeof ALL_HOOKS[number];

const HOOK_TEMPLATES: Record<HookName, string> = {
  "pre-commit": `#!/usr/bin/env bash
# Mneme pre-commit hook — anomaly + secret-redaction guard.
# Skip with: git commit --no-verify
# Disable: rm .git/hooks/pre-commit
set -e
if command -v mneme >/dev/null 2>&1; then
  mneme guard --pre-commit || {
    echo "mneme guard failed. Bypass with --no-verify if intentional." >&2
    exit 1
  }
fi
`,
  "post-commit": `#!/usr/bin/env bash
# Mneme post-commit hook — synthesize a WHY note for the just-made commit.
# This makes future searches richer; never blocks the commit itself.
if command -v mneme >/dev/null 2>&1; then
  mneme heal --last 1 --quiet >/dev/null 2>&1 || true
fi
`,
  "pre-push": `#!/usr/bin/env bash
# Mneme pre-push hook — AI session audit certify gate.
# Set MNEME_AUDIT_STRICT=1 to fail on WARN; otherwise WARN passes.
# Skip with: git push --no-verify
set -e
if command -v mneme >/dev/null 2>&1; then
  if [ "\${MNEME_AUDIT_DISABLE:-}" = "1" ]; then
    exit 0
  fi
  # v1.9.0: skip if no baseline exists yet — certify needs baseline to compare.
  # Show a friendly hint instead of failing the push.
  if [ ! -f .mneme/audit-baseline.json ]; then
    echo "[mneme pre-push] No audit baseline yet — skipping certify gate." >&2
    echo "[mneme pre-push] Run 'mneme audit --baseline' once to enable this gate." >&2
    exit 0
  fi
  STRICT_FLAG=""
  if [ "\${MNEME_AUDIT_STRICT:-}" = "1" ]; then
    STRICT_FLAG="--strict"
  fi
  mneme audit --certify \$STRICT_FLAG --quiet || {
    echo "mneme audit failed. Investigate before pushing." >&2
    echo "Set MNEME_AUDIT_DISABLE=1 to skip; or push with --no-verify." >&2
    exit 1
  }
fi
`,
  "post-merge": `#!/usr/bin/env bash
# Mneme post-merge hook — briefing of what changed while you were away.
# Runs only on the receiving end of a non-fast-forward merge or pull.
if command -v mneme >/dev/null 2>&1; then
  mneme briefing --since "@{1.day.ago}" --quiet 2>/dev/null || true
fi
`,
};

const HOOK_HEADER_MARKER = "# Mneme pre-commit hook";

function findGitDir(cwd: string): string | null {
  // Walk up from cwd looking for a .git directory or file (worktrees use a file)
  let dir = cwd;
  while (true) {
    const candidate = join(dir, ".git");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function resolveHooksDir(cwd: string): string | null {
  const gitDir = findGitDir(cwd);
  if (!gitDir) return null;
  // Worktree: .git is a file pointing to the real gitdir
  let realGitDir = gitDir;
  try {
    const stat = readFileSync(gitDir, "utf8");
    const m = stat.match(/^gitdir:\s*(.+)$/m);
    if (m) realGitDir = m[1]!.trim();
  } catch {
    // .git is a directory — read fails, that's fine
  }
  return join(realGitDir, "hooks");
}

/** Locate the bundled git-mneme.js next to mneme.js. Used to add it to PATH
 *  via a symlink (POSIX) or a .cmd shim (Windows). */
function locateGitMnemeScript(): string | null {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // commands/git-install.js → ../../bin/git-mneme.js
    const candidates = [
      join(here, "..", "..", "bin", "git-mneme.js"),
      join(here, "..", "bin", "git-mneme.js"),
    ];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
  } catch {}
  return null;
}

export async function gitInstallCommand(opts: GitInstallOptions): Promise<number> {
  const outcomes: InstallOutcome[] = [];

  // ── Step 1 — locate the user's repo + hooks dir ─────────────────────
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run this from inside a git working tree.");
    return 1;
  }
  const hooksDir = resolveHooksDir(opts.cwd);
  if (!hooksDir) {
    ui.error("Could not locate the git hooks directory.");
    return 1;
  }

  // ── Step 2 — verify git-mneme.js bundled ────────────────────────────
  const gitMnemeScript = locateGitMnemeScript();
  if (!gitMnemeScript) {
    outcomes.push({
      step: "git-mneme wrapper",
      status: "ERROR",
      detail: "Bundled git-mneme.js not found alongside this CLI build.",
    });
  } else {
    outcomes.push({
      step: "git-mneme wrapper",
      status: "ALREADY",
      detail:
        `Bundled at ${gitMnemeScript}. ` +
        `Ensure mneme is on PATH (npm install -g mneme-ai does this); ` +
        `git will then resolve \`git mneme <cmd>\` automatically.`,
    });
  }

  // ── Step 3 — install hooks ──────────────────────────────────────────
  const hooksToInstall = opts.noHooks
    ? []
    : (opts.hooks && opts.hooks.length > 0 ? opts.hooks : ALL_HOOKS);

  if (hooksToInstall.length === 0) {
    outcomes.push({
      step: "git hooks",
      status: "SKIPPED",
      detail: "Skipped via --no-hooks.",
    });
  } else {
    if (!existsSync(hooksDir)) {
      try {
        mkdirSync(hooksDir, { recursive: true });
      } catch (err) {
        outcomes.push({
          step: "git hooks dir",
          status: "ERROR",
          detail: `Could not create ${hooksDir}: ${(err as Error).message}`,
        });
      }
    }

    for (const hook of hooksToInstall) {
      const path = join(hooksDir, hook);
      const template = HOOK_TEMPLATES[hook];
      try {
        if (existsSync(path)) {
          // Don't clobber a user-customized hook
          const existing = readFileSync(path, "utf8");
          if (existing.includes("Mneme")) {
            if (opts.dryRun) {
              outcomes.push({ step: `hook ${hook}`, status: "ALREADY", detail: `would refresh at ${path}` });
            } else {
              writeFileSync(path, template, "utf8");
              if (process.platform !== "win32") chmodSync(path, 0o755);
              outcomes.push({ step: `hook ${hook}`, status: "INSTALLED", detail: `refreshed at ${path}` });
            }
          } else {
            outcomes.push({
              step: `hook ${hook}`,
              status: "SKIPPED",
              detail: `existing non-Mneme hook at ${path}; not overwriting`,
            });
          }
        } else {
          if (opts.dryRun) {
            outcomes.push({ step: `hook ${hook}`, status: "INSTALLED", detail: `would write to ${path}` });
          } else {
            writeFileSync(path, template, "utf8");
            if (process.platform !== "win32") chmodSync(path, 0o755);
            outcomes.push({ step: `hook ${hook}`, status: "INSTALLED", detail: `written to ${path}` });
          }
        }
      } catch (err) {
        outcomes.push({
          step: `hook ${hook}`,
          status: "ERROR",
          detail: `${(err as Error).message}`,
        });
      }
    }
  }

  // ── Output ──────────────────────────────────────────────────────────
  if (opts.json) {
    process.stdout.write(JSON.stringify({ outcomes }, null, 2) + "\n");
    return outcomes.some((o) => o.status === "ERROR") ? 1 : 0;
  }

  ui.banner();
  process.stdout.write(
    kleur.bold("\n  🤝 Mneme — git extension install\n\n") +
      "  Wires Mneme into your git workflow.\n" +
      "  After this, you can use `git mneme <cmd>` and (optionally) git hooks.\n\n",
  );

  for (const o of outcomes) {
    const tag =
      o.status === "INSTALLED"
        ? kleur.green().bold("✓ INSTALLED")
        : o.status === "ALREADY"
        ? kleur.green("✓ ready")
        : o.status === "SKIPPED"
        ? kleur.gray("○ skipped")
        : kleur.red().bold("✗ ERROR");
    process.stdout.write(`  ${tag}  ${kleur.bold(o.step)}\n`);
    process.stdout.write(`      ${kleur.dim(o.detail)}\n`);
  }

  process.stdout.write("\n  " + kleur.bold("Try it now:") + "\n");
  process.stdout.write("    git mneme why README.md\n");
  process.stdout.write("    git mneme audit --certify\n");
  process.stdout.write("    git mneme briefing\n\n");

  if (hooksToInstall.length > 0) {
    process.stdout.write(
      "  " + kleur.bold("Hook controls:") + "\n" +
        "    git commit --no-verify        # bypass pre-commit / post-commit hooks once\n" +
        "    git push --no-verify          # bypass pre-push gate once\n" +
        "    MNEME_AUDIT_DISABLE=1 git push  # disable pre-push audit for one push\n" +
        "    MNEME_AUDIT_STRICT=1 git push   # treat WARN as failure\n" +
        "    rm .git/hooks/<name>          # uninstall a single hook\n\n",
    );
  }

  return outcomes.some((o) => o.status === "ERROR") ? 1 : 0;
}
