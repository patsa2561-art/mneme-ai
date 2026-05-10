/**
 * Path 4 -- Shared state files notifier.
 *
 * Many AI clients re-read these files on every turn:
 *   - CLAUDE.md       (Claude Code project context)
 *   - AGENTS.md       (Claude Agent SDK / general)
 *   - .cursorrules    (Cursor)
 *   - .aider.conf.yml (aider)
 *   - .windsurfrules  (Windsurf)
 *
 * Mneme writes/updates a clearly-marked Mneme block inside each one
 * (between sentinels so we can update without clobbering user edits).
 * On every tool turn the AI sees fresh Mneme state in its context.
 *
 * Sentinels:
 *   <!-- BEGIN MNEME PULSE -->
 *   ...content...
 *   <!-- END MNEME PULSE -->
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { Notifier, NotifyNotice, NotifyResult, Severity } from "./types.js";

const BEGIN = "<!-- BEGIN MNEME PULSE -->";
const END = "<!-- END MNEME PULSE -->";

const TARGET_FILES = [
  "CLAUDE.md",
  "AGENTS.md",
  ".cursorrules",
  ".windsurfrules",
] as const;

export interface AgentFilesOptions {
  minSeverity?: Severity;
  /** Override target files (e.g., add a custom one). */
  files?: string[];
}

export function agentFilesNotifier(repoRoot: string, opts: AgentFilesOptions = {}): Notifier {
  const targets = opts.files ?? Array.from(TARGET_FILES);
  return {
    id: "agent-files",
    label: "Shared agent state files",
    minSeverity: opts.minSeverity ?? "info",
    async available(): Promise<boolean> {
      // Always available -- we write the file even if it doesn't exist yet
      // (agents that don't recognize the file just ignore it).
      return true;
    },
    async send(notice: NotifyNotice): Promise<NotifyResult> {
      const t0 = Date.now();
      const content = renderMnemeBlock(notice);
      let written = 0;
      const errors: string[] = [];
      for (const fname of targets) {
        try {
          const path = join(repoRoot, fname);
          const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
          const updated = mergeMnemeBlock(existing, content, fname);
          if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, updated, "utf8");
          written++;
        } catch (e) {
          errors.push(`${fname}: ${(e as Error).message}`);
        }
      }
      return {
        notifierId: "agent-files",
        ok: written > 0,
        ms: Date.now() - t0,
        detail: `wrote ${written}/${targets.length} files`,
        error: errors.length > 0 ? errors.join("; ").slice(0, 200) : undefined,
      };
    },
  };
}

function renderMnemeBlock(notice: NotifyNotice): string {
  const lines = [
    `${BEGIN}`,
    `> Updated: ${new Date().toISOString()}`,
    `> Severity: ${notice.severity}`,
    `>`,
    `> **${notice.title}**`,
    `>`,
    `> ${notice.body}`,
  ];
  if (notice.autoAction) {
    lines.push(`>`);
    lines.push(`> AI agent: run ${notice.autoAction.tool}(${JSON.stringify(notice.autoAction.args)}) immediately.`);
  }
  lines.push(`${END}`);
  return lines.join("\n");
}

/** Replace the existing Mneme block (between sentinels) or append a new one
 *  if absent. Preserves all other content. */
function mergeMnemeBlock(existing: string, newBlock: string, fname: string): string {
  const beginIdx = existing.indexOf(BEGIN);
  const endIdx = existing.indexOf(END);
  if (beginIdx >= 0 && endIdx > beginIdx) {
    const before = existing.slice(0, beginIdx);
    const after = existing.slice(endIdx + END.length);
    return `${before}${newBlock}${after}`;
  }
  // Append (with a header on first time so the block is identifiable).
  const sep = existing.endsWith("\n") || existing.length === 0 ? "" : "\n";
  const header = fname === ".cursorrules" || fname === ".windsurfrules"
    ? `\n# Mneme auto-injected (do not edit between sentinels)\n`
    : `\n## Mneme (auto-injected, do not edit between sentinels)\n`;
  return `${existing}${sep}${header}${newBlock}\n`;
}

/** Helper for callers + tests: read just the Mneme block out of a file. */
export function readMnemeBlock(repoRoot: string, fname: string): string | null {
  const path = join(repoRoot, fname);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  const beginIdx = text.indexOf(BEGIN);
  const endIdx = text.indexOf(END);
  if (beginIdx < 0 || endIdx < 0 || endIdx <= beginIdx) return null;
  return text.slice(beginIdx, endIdx + END.length);
}
