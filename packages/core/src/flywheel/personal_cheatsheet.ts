/**
 * v2.32.0 — Personal cheatsheet engine.
 *
 * Reads .mneme/flywheel/cmd_history.jsonl, counts invocations per
 * command, returns top-3 along with a header explaining that the
 * cheatsheet *shrinks* over time as the user specializes.
 *
 * Fresh-install fallback: if < 5 history rows, return the global
 * recommended top-5 — the highest-leverage commands for new users.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const GLOBAL_TOP5: Array<{ command: string; why: string }> = [
  { command: "mneme verify \"<claim>\"", why: "Truth-check ANY factual claim before relaying — refuses to hallucinate." },
  { command: "mneme welcome", why: "Install handoff + what's changed since last session — start here." },
  { command: "mneme flywheel run", why: "Run the self-reflective audit — closes the 4 loops every release." },
  { command: "mneme honest_mirror calibrate", why: "Tune vendor trust on YOUR own past commits — eval-aware-defeating." },
  { command: "mneme rewind run", why: "Track vendor regression on YOUR repo as new model versions ship." },
];

interface CmdHistoryRow { command: string; at: string; }

function dirOf(repoRoot: string): string {
  const d = join(repoRoot, ".mneme", "flywheel");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function historyPath(repoRoot: string): string {
  return join(dirOf(repoRoot), "cmd_history.jsonl");
}

export function recordCommand(repoRoot: string, command: string): void {
  try {
    appendFileSync(historyPath(repoRoot), JSON.stringify({ command, at: new Date().toISOString() }) + "\n", "utf8");
  } catch { /* best-effort */ }
}

export function readHistory(repoRoot: string, limit = 1000): CmdHistoryRow[] {
  const p = historyPath(repoRoot);
  if (!existsSync(p)) return [];
  try {
    const body = readFileSync(p, "utf8");
    const lines = body.split("\n").filter(Boolean);
    const out: CmdHistoryRow[] = [];
    for (const ln of lines.slice(-limit)) {
      try { out.push(JSON.parse(ln) as CmdHistoryRow); } catch { /* skip */ }
    }
    return out;
  } catch { return []; }
}

export interface CheatsheetEntry {
  command: string;
  why: string;
  invocations?: number;
}

export interface CheatsheetSnapshot {
  entries: CheatsheetEntry[];
  /** "personalized" | "fresh_install" */
  mode: "personalized" | "fresh_install";
  /** ISO of latest row used. */
  basedOn: string | null;
  /** Plain-English explanation for the user. */
  header: string;
}

export function computeCheatsheet(repoRoot: string): CheatsheetSnapshot {
  const history = readHistory(repoRoot, 5000);
  if (history.length < 5) {
    return {
      entries: GLOBAL_TOP5.map((g) => ({ ...g })),
      mode: "fresh_install",
      basedOn: history.length === 0 ? null : history[history.length - 1]!.at,
      header: "Fresh install — here are the 5 highest-leverage commands. Use Mneme for a few days and the cheatsheet auto-shrinks to YOUR top-3.",
    };
  }
  // Count invocations per command, keep top-3.
  const counts = new Map<string, number>();
  for (const row of history) counts.set(row.command, (counts.get(row.command) ?? 0) + 1);
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return {
    entries: sorted.map(([command, n]) => ({
      command,
      why: GLOBAL_TOP5.find((g) => command.startsWith(g.command.split(" ")[0]!))?.why ?? "Frequently used by you.",
      invocations: n,
    })),
    mode: "personalized",
    basedOn: history[history.length - 1]!.at,
    header: `Personal cheatsheet: top-3 commands you actually use (from ${history.length} invocations).`,
  };
}

export function renderCheatsheetMarkdown(snap: CheatsheetSnapshot): string {
  const lines: string[] = [];
  lines.push(`# Mneme — Personal Cheatsheet`);
  lines.push(``);
  lines.push(`> ${snap.header}`);
  lines.push(``);
  for (const e of snap.entries) {
    lines.push(`- \`${e.command}\` — ${e.why}${typeof e.invocations === "number" ? ` (${e.invocations}×)` : ""}`);
  }
  lines.push(``);
  lines.push(`---`);
  lines.push(`Mode: ${snap.mode} · basedOn: ${snap.basedOn ?? "(no history yet)"}`);
  return lines.join("\n");
}
