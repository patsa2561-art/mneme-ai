/**
 * `mneme session` — Persistent Cross-AI Brain.
 *
 * The killer-idea wedge: when a user works with Claude Code, switches to
 * ChatGPT (rate-limited), then to Cursor on a different machine — context
 * USUALLY dies at every switch. Mneme keeps it alive.
 *
 * v1.10.0 ships local persistence + federation sync. Sessions live at
 * .mneme/sessions/<id>.json. Each session captures:
 *   • the user's intent (what they were doing)
 *   • the active files / commits being worked on
 *   • the AI tools that have touched it
 *   • a chronological log of summarized actions
 *
 * MCP tools mneme.session.save and mneme.session.resume let any AI
 * client read/write — Claude saves, ChatGPT reads, Cursor adds, the
 * cross-tool memory is one source of truth.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import kleur from "kleur";
import { ui } from "../ui.js";
import { git } from "@mneme-ai/core";

export interface SessionEntry {
  /** Stable session id */
  id: string;
  /** User-friendly title (auto-generated from first save's intent) */
  title: string;
  /** ISO timestamps */
  createdAt: string;
  updatedAt: string;
  /** What the user is trying to accomplish */
  intent: string;
  /** Files / commits / topics the session is anchored to */
  anchors: {
    files: string[];
    commits: string[];
    topics: string[];
  };
  /** Chronological log of AI actions taken in the session */
  log: SessionLogEntry[];
  /** Which AI tools have contributed (Claude / GPT / Gemini / Cursor / etc) */
  contributingAiTools: string[];
}

export interface SessionLogEntry {
  ts: string;
  aiTool: string;        // e.g. "claude-code", "chatgpt", "cursor"
  action: string;        // freeform: "drafted refactor", "ran tests", etc
  outcome?: "PASS" | "WARN" | "FAIL" | "INFO";
}

export interface SessionOptions {
  cwd: string;
  action: "save" | "resume" | "list" | "remove";
  id?: string;
  intent?: string;
  aiTool?: string;
  logEntry?: string;
  outcome?: SessionLogEntry["outcome"];
  files?: string[];
  commits?: string[];
  topics?: string[];
  json?: boolean;
}

function sessionsDir(repoRoot: string): string {
  return join(repoRoot, ".mneme", "sessions");
}

function sessionPath(repoRoot: string, id: string): string {
  return join(sessionsDir(repoRoot), `${id}.json`);
}

function readSession(repoRoot: string, id: string): SessionEntry | null {
  const p = sessionPath(repoRoot, id);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as SessionEntry;
  } catch {
    return null;
  }
}

function writeSession(repoRoot: string, entry: SessionEntry) {
  const dir = sessionsDir(repoRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = sessionPath(repoRoot, entry.id) + ".tmp";
  writeFileSync(tmp, JSON.stringify(entry, null, 2), "utf8");
  renameSync(tmp, sessionPath(repoRoot, entry.id));
}

function listSessions(repoRoot: string): SessionEntry[] {
  const dir = sessionsDir(repoRoot);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && !f.endsWith(".tmp"));
  const out: SessionEntry[] = [];
  for (const f of files) {
    try {
      out.push(JSON.parse(readFileSync(join(dir, f), "utf8")) as SessionEntry);
    } catch {
      // skip corrupt
    }
  }
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
}

/** Generate a stable, short session id derived from the intent (so saving
 *  the same intent twice merges into one session). */
function deriveSessionId(intent: string): string {
  const h = createHash("sha256").update(intent.toLowerCase().trim()).digest("hex");
  return h.slice(0, 12);
}

export async function sessionCommand(opts: SessionOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);

  switch (opts.action) {
    case "save": {
      if (!opts.intent) {
        ui.error("`session save` requires --intent <text>");
        return 1;
      }
      const id = opts.id ?? deriveSessionId(opts.intent);
      const existing = readSession(meta.rootPath, id);
      const now = new Date().toISOString();
      const aiTool = opts.aiTool ?? "unknown-ai";
      const entry: SessionEntry = existing ?? {
        id,
        title: opts.intent.slice(0, 80),
        createdAt: now,
        updatedAt: now,
        intent: opts.intent,
        anchors: { files: [], commits: [], topics: [] },
        log: [],
        contributingAiTools: [],
      };
      entry.updatedAt = now;
      entry.intent = opts.intent;
      // Merge anchors
      if (opts.files) entry.anchors.files = Array.from(new Set([...entry.anchors.files, ...opts.files]));
      if (opts.commits) entry.anchors.commits = Array.from(new Set([...entry.anchors.commits, ...opts.commits]));
      if (opts.topics) entry.anchors.topics = Array.from(new Set([...entry.anchors.topics, ...opts.topics]));
      // Append log
      if (opts.logEntry) {
        entry.log.push({ ts: now, aiTool, action: opts.logEntry, outcome: opts.outcome });
      }
      // Track contributing tools
      if (!entry.contributingAiTools.includes(aiTool)) {
        entry.contributingAiTools.push(aiTool);
      }
      writeSession(meta.rootPath, entry);
      if (opts.json) process.stdout.write(JSON.stringify({ saved: entry }, null, 2) + "\n");
      else ui.success(`Saved session ${id}: ${entry.title}`);
      return 0;
    }

    case "resume": {
      const id = opts.id;
      if (!id) {
        // Default: most recently updated
        const list = listSessions(meta.rootPath);
        if (list.length === 0) {
          if (opts.json) process.stdout.write(JSON.stringify({ resumed: null, reason: "no-sessions" }) + "\n");
          else ui.dim("No sessions found.");
          return 0;
        }
        const latest = list[0]!;
        if (opts.json) process.stdout.write(JSON.stringify({ resumed: latest }, null, 2) + "\n");
        else printSession(latest);
        return 0;
      }
      const entry = readSession(meta.rootPath, id);
      if (!entry) {
        if (opts.json) process.stdout.write(JSON.stringify({ resumed: null, reason: "not-found", id }) + "\n");
        else ui.error(`No session with id ${id}.`);
        return 1;
      }
      if (opts.json) process.stdout.write(JSON.stringify({ resumed: entry }, null, 2) + "\n");
      else printSession(entry);
      return 0;
    }

    case "list": {
      const list = listSessions(meta.rootPath);
      if (opts.json) {
        process.stdout.write(JSON.stringify({ sessions: list }, null, 2) + "\n");
        return 0;
      }
      if (list.length === 0) {
        ui.dim("No sessions yet. Run `mneme session save --intent ...` from any AI tool to start.");
        return 0;
      }
      for (const s of list) {
        process.stdout.write(
          `  ${kleur.cyan(s.id)} ${kleur.bold(s.title)}\n` +
            kleur.dim(`      updated ${s.updatedAt} · ${s.contributingAiTools.length} AI tool(s) · ${s.log.length} log entries\n`),
        );
      }
      return 0;
    }

    case "remove": {
      if (!opts.id) {
        ui.error("`session remove` requires --id <id>");
        return 1;
      }
      const p = sessionPath(meta.rootPath, opts.id);
      if (!existsSync(p)) {
        ui.error(`No session with id ${opts.id}.`);
        return 1;
      }
      unlinkSync(p);
      if (opts.json) process.stdout.write(JSON.stringify({ removed: opts.id }) + "\n");
      else ui.success(`Removed session ${opts.id}.`);
      return 0;
    }

    default:
      ui.error(`Unknown session action: ${opts.action}`);
      return 1;
  }
}

function printSession(s: SessionEntry) {
  process.stdout.write(
    "\n" +
      kleur.bold(`  📋 Session ${s.id} — ${s.title}\n\n`) +
      `  Intent:           ${s.intent}\n` +
      `  Created at:       ${s.createdAt}\n` +
      `  Updated at:       ${s.updatedAt}\n` +
      `  AI tools used:    ${s.contributingAiTools.join(", ") || "(none)"}\n` +
      `  Anchored files:   ${s.anchors.files.slice(0, 5).join(", ") || "(none)"}\n` +
      `  Anchored commits: ${s.anchors.commits.slice(0, 5).join(", ") || "(none)"}\n` +
      `  Topics:           ${s.anchors.topics.join(", ") || "(none)"}\n\n` +
      kleur.bold("  Log:\n"),
  );
  for (const entry of s.log.slice(-10)) {
    const tag =
      entry.outcome === "PASS" ? kleur.green("✓") :
      entry.outcome === "FAIL" ? kleur.red("✗") :
      entry.outcome === "WARN" ? kleur.yellow("!") : kleur.dim("·");
    process.stdout.write(`    ${tag} ${kleur.dim(entry.ts.slice(0, 19))} [${entry.aiTool}] ${entry.action}\n`);
  }
  process.stdout.write("\n");
}

// Test exports
export const _deriveSessionIdForTests = deriveSessionId;
export const _readSessionForTests = readSession;
