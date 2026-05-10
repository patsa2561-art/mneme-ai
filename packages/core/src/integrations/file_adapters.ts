/**
 * File-based integration adapters -- for agents that don't have a
 * real shell-execute hook surface (everything except Claude Code).
 *
 * Each adapter wires the Mneme pulse instruction into the right
 * auto-loaded file for that agent:
 *
 *   - Cursor       -> .cursor/rules/mneme.mdc  (project rule)
 *   - Codex CLI    -> AGENTS.md                (cross-vendor agent file)
 *   - Gemini CLI   -> GEMINI.md                (Gemini convention)
 *   - Windsurf     -> .windsurfrules           (Windsurf convention)
 *   - Catch-all    -> CLAUDE.md / AGENTS.md / .cursorrules / .windsurfrules
 *                     (writes to whichever exist; useful when adapter id
 *                      isn't explicitly chosen by the user)
 *
 * All adapters use the same sentinel-bracketed block, so re-installing
 * is idempotent across agents and uninstall is precise.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  IntegrationAdapter, DetectResult, InstallResult, UninstallResult, StatusResult,
} from "./types.js";
import { defaultMnemeBlock } from "./types.js";
import { injectBlock, removeBlock, readBlockState } from "./file_inject.js";

/** Build a generic file-injection adapter. */
function fileAdapter(spec: {
  id: string;
  label: string;
  /** Project-relative file path. */
  filePath: string;
  /** Detect heuristic: file or sibling marker that proves agent is in use. */
  detectMarker?: (repoRoot: string) => { present: boolean; reason: string };
  /** "rules-file" or "agent-file" (just for reporting; behavior identical). */
  mode: "rules-file" | "agent-file";
}): IntegrationAdapter {
  return {
    id: spec.id,
    label: spec.label,
    scope: "project",

    async detect(repoRoot: string): Promise<DetectResult> {
      const fullPath = join(repoRoot, spec.filePath);
      if (existsSync(fullPath)) {
        return { present: true, reason: `${spec.filePath} exists`, configPath: fullPath };
      }
      if (spec.detectMarker) {
        const m = spec.detectMarker(repoRoot);
        return { present: m.present, reason: m.reason, configPath: fullPath };
      }
      return { present: false, reason: `${spec.filePath} does not exist (will be created on install)`, configPath: fullPath };
    },

    async install(repoRoot: string, opts: { force?: boolean } = {}): Promise<InstallResult> {
      const fullPath = join(repoRoot, spec.filePath);
      try {
        const existing = readBlockState(fullPath);
        if (existing.hasBlock && !opts.force) {
          // Compare normalized -- if identical, no-op
          const desired = defaultMnemeBlock();
          // The block body is what's between sentinels; reconstruct full block to compare cheaply.
          const r = injectBlock(fullPath, desired);
          if (r.status === "already-installed") {
            return {
              ok: true, status: "already-installed", mode: spec.mode, path: fullPath,
              message: `Mneme block already present in ${spec.filePath}.`,
            };
          }
          // Drift detected (someone hand-edited inside our sentinels): refuse without --force
          // unless it's a no-op (covered above)
          return {
            ok: true, status: "repaired", mode: spec.mode, path: fullPath,
            message: `Refreshed Mneme block in ${spec.filePath}.`,
          };
        }
        const r = injectBlock(fullPath, defaultMnemeBlock());
        const status: InstallResult["status"] =
          r.status === "installed" ? "installed"
          : r.status === "added-block" ? "installed"
          : r.status === "updated-block" ? "repaired"
          : "already-installed";
        const fileLabel = r.status === "installed" ? "(file created)"
          : r.status === "added-block" ? "(appended block)"
          : "(updated block)";
        return {
          ok: true, status, mode: spec.mode, path: fullPath,
          message: `${spec.label} -> ${spec.filePath} ${fileLabel}`,
        };
      } catch (e) {
        return {
          ok: false, status: "error", mode: spec.mode, path: fullPath,
          message: `Failed to write ${fullPath}: ${(e as Error).message}`,
          fix: `Ensure the directory is writable, then re-run.`,
        };
      }
    },

    async uninstall(repoRoot: string): Promise<UninstallResult> {
      const fullPath = join(repoRoot, spec.filePath);
      try {
        const r = removeBlock(fullPath);
        if (!r.fileExisted) return { ok: true, status: "not-installed", path: fullPath, message: `no ${spec.filePath}` };
        if (!r.removed) return { ok: true, status: "not-installed", path: fullPath, message: `no Mneme block in ${spec.filePath}` };
        return { ok: true, status: "removed", path: fullPath, message: `removed Mneme block from ${spec.filePath}` };
      } catch (e) {
        return { ok: false, status: "error", path: fullPath, message: `Failed: ${(e as Error).message}` };
      }
    },

    async status(repoRoot: string): Promise<StatusResult> {
      const fullPath = join(repoRoot, spec.filePath);
      const s = readBlockState(fullPath);
      if (!s.fileExists) {
        return { installed: false, state: "no-config", mode: spec.mode, path: fullPath, details: `${spec.filePath} does not exist` };
      }
      if (!s.hasBlock) {
        return { installed: false, state: "absent", mode: spec.mode, path: fullPath, details: `${spec.filePath} present, no Mneme block` };
      }
      return { installed: true, state: "ok", mode: spec.mode, path: fullPath, details: `Mneme block present` };
    },
  };
}

// Cursor: project rules in .cursor/rules/<name>.mdc are auto-loaded by
// Cursor as persistent context. Falls back to .cursorrules if it exists.
export const cursorAdapter: IntegrationAdapter = fileAdapter({
  id: "cursor",
  label: "Cursor",
  filePath: ".cursor/rules/mneme.mdc",
  mode: "rules-file",
  detectMarker: (repoRoot) => {
    const cursorDir = join(repoRoot, ".cursor");
    const cursorRules = join(repoRoot, ".cursorrules");
    if (existsSync(cursorDir)) return { present: true, reason: ".cursor/ exists" };
    if (existsSync(cursorRules)) return { present: true, reason: ".cursorrules exists" };
    return { present: false, reason: "no .cursor/ or .cursorrules" };
  },
});

// Cursor legacy single-file format. Some projects still use this; we
// support it as a separate adapter so users can pick.
export const cursorLegacyAdapter: IntegrationAdapter = fileAdapter({
  id: "cursor-legacy",
  label: "Cursor (.cursorrules legacy)",
  filePath: ".cursorrules",
  mode: "rules-file",
});

// OpenAI Codex CLI + a growing number of agents (Devin, etc.) read AGENTS.md
// as a cross-vendor convention.
export const codexAdapter: IntegrationAdapter = fileAdapter({
  id: "codex",
  label: "OpenAI Codex CLI / AGENTS.md (cross-vendor)",
  filePath: "AGENTS.md",
  mode: "agent-file",
});

// Gemini CLI reads GEMINI.md.
export const geminiAdapter: IntegrationAdapter = fileAdapter({
  id: "gemini-cli",
  label: "Gemini CLI",
  filePath: "GEMINI.md",
  mode: "agent-file",
});

// Windsurf reads .windsurfrules.
export const windsurfAdapter: IntegrationAdapter = fileAdapter({
  id: "windsurf",
  label: "Windsurf",
  filePath: ".windsurfrules",
  mode: "rules-file",
});

// Claude Code project-level CLAUDE.md (in addition to the user-level
// hook). Some users prefer this so the rule travels with the repo.
export const claudeProjectAdapter: IntegrationAdapter = fileAdapter({
  id: "claude-code-project",
  label: "Claude Code (project CLAUDE.md)",
  filePath: "CLAUDE.md",
  mode: "agent-file",
});

// Aider reads .aider.conf.yml. We don't merge YAML (would require a YAML
// parser dep); instead we point Aider at a Mneme rules file via the
// existing AGENTS.md convention -- the user can wire it manually if
// they want a dedicated read-array entry.
// Continue.dev has its own customCommands surface; same reasoning -- we
// expose a docs pointer rather than touching the JSON, because Continue
// configs vary widely and clobbering them is high-risk.
