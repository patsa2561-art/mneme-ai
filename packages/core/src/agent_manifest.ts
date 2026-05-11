/**
 * MNEME AGENT COMMAND MANIFEST (v1.31.0).
 *
 * The bug this fixes: a tester reported they didn't know `mneme
 * uninstall` existed, didn't try `mneme embeddings status`, didn't know
 * about `mneme supernova clear`. Mneme ships 30+ commands but the AI
 * agent in the user's editor only ever sees what's already in CLAUDE.md
 * / AGENTS.md / .cursor/rules. New commands take WEEKS to drift into
 * those files. Result: features ship + immediately get forgotten.
 *
 * THIS MODULE: a machine-readable catalog of EVERY Mneme command with
 * a "when to use" hint, renderable into every agent-file format.
 * Daemon + CLI run `syncManifest()` whenever a new mneme version is
 * detected -- the manifest block in every agent file is refreshed in
 * place between sentinel markers, so the AI in the user's editor
 * ALWAYS knows the latest command surface, even brand-new ones.
 *
 * No more "I didn't know that command existed."
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export interface ManifestCommand {
  /** The command as a user types it. */
  command: string;
  /** Short alias if any. */
  alias?: string;
  /** Which Mneme version introduced this command. */
  since: string;
  /** What the command does (1 line). */
  what: string;
  /** When the AI should call it ("if user asks…", "before risky op…"). */
  when: string;
  /** Bucket for grouping in the rendered output. */
  group: "memory" | "antivirus" | "evolve" | "ops" | "uninstall" | "supernova" | "embeddings" | "supersonic" | "diagnosis" | "core";
}

/** The static catalog. Every new command MUST be added here in the same
 *  PR that introduces it -- it's the single source of truth for what
 *  the AI in the user's editor knows about. */
export const MNEME_COMMAND_CATALOG: ManifestCommand[] = [
  // Core memory / search
  { command: "mneme index", since: "1.0", group: "memory", what: "Build the memory store from git history + commits + chunks.", when: "Before any retrieval-based command on a fresh repo, or after large commits land." },
  { command: "mneme ask <question>", since: "1.0", group: "memory", what: "Semantic Q&A backed by the memory store + AI synthesis.", when: "User asks 'what / why / who' about the codebase." },
  { command: "mneme why <file>", since: "1.0", group: "memory", what: "Explain why a file changed historically.", when: "User opens a file with strange history + asks for context." },
  { command: "mneme who-knows <topic>", since: "1.0", group: "memory", what: "Find who has expertise in a topic from commit history.", when: "User needs to find a reviewer / domain expert." },

  // Antivirus
  { command: "mneme antivirus scan <text-or-file>", alias: "av scan", since: "1.24.0", group: "antivirus", what: "Scan AI output for hallucination strains (8 strains).", when: "Right after AI generates code / commit message / docs -- BEFORE applying it." },
  { command: "mneme antivirus gap-scan", alias: "av gap", since: "1.27.8", group: "antivirus", what: "Auto-evaluate vaccine coverage using YOUR repo as ground truth + polyglot deps.", when: "Periodic (weekly+) to surface vaccine gaps. Run before tuning." },
  { command: "mneme antivirus synthesize <strain>", alias: "av synth", since: "1.28.0", group: "antivirus", what: "Auto-mine a regex from FN samples; ACCEPTED iff recall +10pp AND precision >= 0.90.", when: "After gap-scan flags a strain with low recall." },
  { command: "mneme antivirus cure <text-or-file>", alias: "av cure", since: "1.24.0", group: "antivirus", what: "Apply cures from a scan; print cleaned text.", when: "User wants AI output cleaned before paste." },

  // Embeddings / memory tier (v1.30+)
  { command: "mneme embeddings status", alias: "emb tier", since: "1.30.0", group: "embeddings", what: "Show active embedder tier + REAL similarity test verdict.", when: "User asks 'why is search bad?' or before relying on `mneme ask` quality." },
  { command: "mneme embeddings upgrade", since: "1.30.0", group: "embeddings", what: "Pre-download bundled MiniLM (~25MB) for ★★★ semantic memory.", when: "Once per machine, when on hash tier (★★) or first-time install." },

  // SUPERNOVA self-heal
  { command: "mneme supernova log", alias: "sn log", since: "1.30.0", group: "supernova", what: "Last N entries from .mneme/supernova.jsonl (every restart + escalation).", when: "After noticing a daemon cycle stuck or after a notifier 'subsystem escalated' alert." },
  { command: "mneme supernova status", alias: "sn status", since: "1.30.0", group: "supernova", what: "Aggregated tally per cycle from the supernova log.", when: "Periodic health snapshot of the self-heal subsystem." },
  { command: "mneme supernova clear <cycle>", alias: "sn clear", since: "1.30.0", group: "supernova", what: "Queue a clear-escalation request via inbox; daemon resets cycle.", when: "After a cycle escalates + the underlying fix is in place. Avoids daemon restart." },

  // Super Sonic continuity (no CLI -- automatic, listed for awareness)
  { command: "[SUPER SONIC continuity pulse]", since: "1.30.0", group: "supersonic", what: "Automatic [CHANGED ...] delta line on every pulse showing what shifted since the prior prompt.", when: "Always-on. No CLI. Just read the [CHANGED] line in the pulse." },

  // Uninstall
  { command: "mneme uninstall [--purge] [--npm] [--json]", since: "1.28.2", group: "uninstall", what: "Remove EVERY Mneme artifact: daemon, OS service, hooks, marker, optionally .mneme + npm. Structured report.", when: "User asks to remove Mneme. Trust contract -- silent install, silent uninstall." },

  // EVOLVE
  { command: "mneme evolve scan / propose / synthesize / apply / auto-pr / pass", since: "1.27.0", group: "evolve", what: "Self-modifying NUCLEUS Phase 3+4+5 -- generate verified .patch files from telemetry.", when: "Periodic (daemon does this nightly). Manual run when investigating self-improvement candidates." },
  { command: "mneme evolve lineage [templateId] [--verify]", since: "1.27.4", group: "evolve", what: "HMAC-chained record of every applied EVOLVE template.", when: "When auditing why a particular patch was accepted." },

  // Black-sheep features (no competitor does these)
  { command: "mneme atrophy [--top N]", since: "1.0", group: "diagnosis", what: "Knowledge half-life -- who is still fluent in which area of the code.", when: "Before a teammate leaves the company OR before a large refactor." },
  { command: "mneme premortem <change-description>", since: "1.0", group: "diagnosis", what: "Predict regret + failure modes for a proposed change, grounded in repo's failure history.", when: "Before risky deletes / migrations / dependency bumps." },
  { command: "mneme stigmergy [--top N]", alias: "mneme hive", since: "1.27.6", group: "diagnosis", what: "Emergent dev-collaboration from git traces alone -- invisible pairs who work together effectively.", when: "Org-chart truth: when planning who-pairs-with-whom for a project." },
  { command: "mneme adversarial", since: "1.0", group: "diagnosis", what: "Mix real history with subtle lies to meta-evaluate any AI client's resistance to misinformation.", when: "When benchmarking a new AI tool against your codebase." },
  { command: "mneme chimera", since: "1.27.9", group: "diagnosis", what: "Solo-repo 5-axis insight synthesizer (time fingerprint × area × velocity × topic × phantom collaborators).", when: "Solo devs who want CHIMERA-grade self-analysis from git alone." },

  // Ops
  { command: "mneme nucleus daemon [--detach]", since: "1.21.0", group: "ops", what: "Start the persistent loop (factorial backoff supervised cycles).", when: "Once per machine -- the ghost-sniper auto-boot does this automatically on first prompt." },
  { command: "mneme nucleus install --as-service", since: "1.23.0", group: "ops", what: "Register the daemon as a boot service (schtasks/systemd-user/launchd).", when: "Ghost-sniper auto-boot does this automatically. Manual run if you opted out earlier." },
  { command: "mneme guard", since: "1.0", group: "ops", what: "Pre-commit hook -- catches obvious patterns in staged diffs.", when: "Wire into .git/hooks/pre-commit." },
];

const SENTINEL_BEGIN = "<!-- BEGIN MNEME MANIFEST (auto-managed -- do not edit) -->";
const SENTINEL_END = "<!-- END MNEME MANIFEST -->";

/** Render the manifest as Markdown suitable for injection into agent
 *  files (CLAUDE.md, AGENTS.md, GEMINI.md). */
export function renderManifestMarkdown(catalog: ManifestCommand[] = MNEME_COMMAND_CATALOG, mnemeVersion: string = "?"): string {
  const grouped: Record<string, ManifestCommand[]> = {};
  for (const c of catalog) {
    (grouped[c.group] ??= []).push(c);
  }
  const lines: string[] = [];
  lines.push(SENTINEL_BEGIN);
  lines.push(``);
  lines.push(`## Mneme command manifest (v${mnemeVersion})`);
  lines.push(``);
  lines.push(`AI agent: this block is auto-maintained by Mneme. It lists every command + when to call it. Re-read on every session start -- new commands ship here within minutes of a Mneme upgrade.`);
  lines.push(``);
  const groupOrder = ["memory", "antivirus", "embeddings", "supernova", "supersonic", "uninstall", "evolve", "diagnosis", "ops", "core"] as const;
  for (const g of groupOrder) {
    const cmds = grouped[g];
    if (!cmds || cmds.length === 0) continue;
    lines.push(`### ${g}`);
    lines.push(``);
    for (const c of cmds) {
      const alias = c.alias ? ` (alias \`${c.alias}\`)` : "";
      lines.push(`- **\`${c.command}\`**${alias} _(since v${c.since})_`);
      lines.push(`  - **What**: ${c.what}`);
      lines.push(`  - **When**: ${c.when}`);
    }
    lines.push(``);
  }
  lines.push(SENTINEL_END);
  return lines.join("\n");
}

/** Render as the rules-file format (.cursorrules / .windsurfrules) --
 *  plain text, no sentinel comments (rules files don't support HTML
 *  comments cleanly). */
export function renderManifestPlain(catalog: ManifestCommand[] = MNEME_COMMAND_CATALOG, mnemeVersion: string = "?"): string {
  const lines: string[] = [];
  lines.push(`# Mneme command manifest (v${mnemeVersion}) -- auto-maintained, do not edit between markers`);
  lines.push(``);
  for (const c of catalog) {
    const alias = c.alias ? ` (alias: ${c.alias})` : "";
    lines.push(`- ${c.command}${alias}  [since v${c.since}]`);
    lines.push(`    what: ${c.what}`);
    lines.push(`    when: ${c.when}`);
  }
  return lines.join("\n");
}

/** Upsert the manifest block into the given file. Uses sentinel markers
 *  so re-syncs replace the existing block in place without touching the
 *  rest of the file. Returns the action taken. */
export type UpsertAction = "created" | "replaced" | "unchanged" | "skipped" | "failed";
export function upsertManifestBlock(
  filePath: string,
  block: string,
  opts: { useSentinels?: boolean } = {},
): { action: UpsertAction; detail?: string } {
  const useSentinels = opts.useSentinels !== false;
  try {
    if (!existsSync(filePath)) {
      const dir = dirname(filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, block + "\n", "utf8");
      return { action: "created" };
    }
    const existing = readFileSync(filePath, "utf8");
    if (useSentinels) {
      const beginIdx = existing.indexOf(SENTINEL_BEGIN);
      const endIdx = existing.indexOf(SENTINEL_END);
      if (beginIdx >= 0 && endIdx > beginIdx) {
        const before = existing.slice(0, beginIdx);
        const after = existing.slice(endIdx + SENTINEL_END.length);
        const next = before + block + after;
        if (next === existing) return { action: "unchanged" };
        writeFileSync(filePath, next, "utf8");
        return { action: "replaced" };
      }
      // No sentinels yet -- append at end.
      if (existing.includes(block.split("\n").slice(2, 4).join("\n"))) {
        return { action: "unchanged" };
      }
      writeFileSync(filePath, existing.trimEnd() + "\n\n" + block + "\n", "utf8");
      return { action: "created" };
    }
    // Non-sentinel mode: just overwrite the file entirely (rules files).
    if (existing.trim() === block.trim()) return { action: "unchanged" };
    writeFileSync(filePath, block + "\n", "utf8");
    return { action: "replaced" };
  } catch (e) {
    return { action: "failed", detail: (e as Error).message };
  }
}

export interface SyncTarget {
  /** Filename relative to repo root. */
  path: string;
  /** Display name for the report. */
  label: string;
  /** "markdown" for files supporting <!-- comments --> sentinels, "plain"
   *  for rules files (.cursorrules / .windsurfrules / etc). */
  format: "markdown" | "plain";
}

export const DEFAULT_SYNC_TARGETS: SyncTarget[] = [
  { path: "CLAUDE.md",        label: "Claude Code (project)", format: "markdown" },
  { path: "AGENTS.md",        label: "Codex / cross-vendor",  format: "markdown" },
  { path: "GEMINI.md",        label: "Gemini CLI",            format: "markdown" },
  { path: ".cursor/rules/mneme.mdc", label: "Cursor",         format: "markdown" },
  { path: ".cursorrules",     label: "Cursor (legacy)",       format: "plain" },
  { path: ".windsurfrules",   label: "Windsurf",              format: "plain" },
];

/** Sync the manifest into every supported agent file in the repo.
 *  Returns per-target outcomes. Best-effort -- a failure on one target
 *  does not block the others. */
export function syncManifest(
  repoRoot: string,
  opts: { mnemeVersion?: string; targets?: SyncTarget[]; catalog?: ManifestCommand[] } = {},
): Array<{ target: SyncTarget; action: UpsertAction; detail?: string }> {
  const targets = opts.targets ?? DEFAULT_SYNC_TARGETS;
  const catalog = opts.catalog ?? MNEME_COMMAND_CATALOG;
  const version = opts.mnemeVersion ?? "?";
  const mdBlock = renderManifestMarkdown(catalog, version);
  const plainBlock = renderManifestPlain(catalog, version);
  return targets.map((t) => {
    const filePath = join(repoRoot, t.path);
    const block = t.format === "markdown" ? mdBlock : plainBlock;
    const result = upsertManifestBlock(filePath, block, { useSentinels: t.format === "markdown" });
    return { target: t, action: result.action, detail: result.detail };
  });
}
