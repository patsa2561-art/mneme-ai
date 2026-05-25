/**
 * v2.46.0 — NEMESIS ORGAN 3 surface: GIT PRE-COMMIT HOOK INSTALLER.
 *
 * Installs a `.git/hooks/prepare-commit-msg` script that calls
 * `mneme nemesis eu_stamp` for every commit and appends the Article 50
 * disclosure block to the staged commit message.
 *
 * DRY-RUN default. Defensive: never throws.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const HOOK_SCRIPT = `#!/bin/sh
# Mneme NEMESIS — EU AI Act Article 50 auto-stamper (v2.46.0+)
# Auto-installed by \`mneme nemesis install-hook\`.
#
# Reads the in-progress commit message, asks mneme nemesis for the
# detected vendor + confidence, and appends a machine-readable
# disclosure block. Skips if the message already contains one.
MSG_FILE="$1"
[ -z "$MSG_FILE" ] && exit 0
grep -q 'AI-GENERATED-CONTENT' "$MSG_FILE" 2>/dev/null && exit 0
# Best-effort detection via env scan (cheapest signal); fallback "unknown"
VENDOR="unknown"
[ -n "$CLAUDECODE" ] && VENDOR="claude-code"
[ -n "$CURSOR_AGENT" ] && VENDOR="cursor"
[ -n "$DEVIN_SESSION" ] && VENDOR="devin"
[ -n "$COPILOT_AGENT" ] && VENDOR="copilot"
[ -n "$CODEX_AGENT" ] && VENDOR="codex"
[ "$VENDOR" = "unknown" ] && exit 0
MSG=$(cat "$MSG_FILE")
mneme nemesis eu_stamp --message "$MSG" --vendor "$VENDOR" --json 2>/dev/null | \
  node -e 'let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{try{const j=JSON.parse(s);if(j&&j.ok)process.stdout.write(j.stampedMessage)}catch{}})' \
  > "$MSG_FILE.new" && mv "$MSG_FILE.new" "$MSG_FILE"
exit 0
`;

export interface InstallHookInput {
  repoRoot: string;
  dryRun?: boolean;
}

export interface InstallHookResult {
  ok: boolean;
  reason?: string;
  hookPath?: string;
  plannedScript: string;
  installed?: boolean;
  /** When a hook already exists, we don't overwrite — return the existing body so the caller can merge manually. */
  existing?: string;
}

export function installPreCommitHook(input: InstallHookInput): InstallHookResult {
  const plannedScript = HOOK_SCRIPT;
  if (!input || !input.repoRoot) {
    return { ok: false, reason: "repoRoot required", plannedScript };
  }
  const dryRun = input.dryRun !== false; // default TRUE
  const hookDir = join(input.repoRoot, ".git", "hooks");
  const hookPath = join(hookDir, "prepare-commit-msg");
  if (dryRun) {
    return { ok: true, hookPath, plannedScript, installed: false };
  }
  if (!existsSync(join(input.repoRoot, ".git"))) {
    return { ok: false, reason: "not a git repo (no .git directory)", hookPath, plannedScript };
  }
  try {
    if (!existsSync(hookDir)) mkdirSync(hookDir, { recursive: true });
    if (existsSync(hookPath)) {
      const existing = readFileSync(hookPath, "utf8");
      if (existing.includes("mneme nemesis eu_stamp")) {
        return { ok: true, hookPath, plannedScript, installed: true, existing };
      }
      return {
        ok: false,
        reason: "existing prepare-commit-msg hook found; refuse to overwrite. Add the NEMESIS body manually or move the existing hook aside.",
        hookPath, plannedScript, existing,
      };
    }
    writeFileSync(hookPath, plannedScript, { mode: 0o755 });
    return { ok: true, hookPath, plannedScript, installed: true };
  } catch (e) {
    return { ok: false, reason: `install failed: ${(e as Error).message}`, hookPath, plannedScript };
  }
}
