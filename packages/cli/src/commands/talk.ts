/**
 * v2.19.76 — `mneme talk` REPL.
 *
 * Two modes, auto-detected:
 *
 *   1. PROTOCOL HANDOFF (when invoked inside an AI agent shell)
 *      Detected via env vars: CLAUDE_CODE, CURSOR_*, CODEIUM_*,
 *      CODEX_*, CLINE_*, CONTINUE_*, AIDER_*, GEMINI_CODE_ASSIST,
 *      ZED_AI_*, plus the generic AI_AGENT marker.  Prints a short
 *      structured directive telling the host AI agent to switch to
 *      "Mneme chat dispatcher mode": every subsequent user turn
 *      should be routed through the AI_AGENT_CONTRACT Step 2.5
 *      dispatch table to Mneme MCP tools.  The AI agent (Claude /
 *      ChatGPT / Cursor / etc.) becomes the chat — the user gets to
 *      keep all the LLM smartness of their host while gaining
 *      Mneme's verifier + memory layer.
 *
 *   2. STANDALONE REPL (when no AI agent detected — bare terminal)
 *      Pure Node readline.  Keyword-based intent routing against the
 *      same 13-row dispatch table.  Built-in commands:
 *        /exit, /quit          — leave the REPL
 *        /help                 — show this list + the intent table
 *        /clear                — clear screen
 *        /history              — show past inputs
 *        /show <N>             — re-print answer #N
 *        /save <name>          — export session as a bash playbook
 *        ?                     — genie mode (context-aware guess)
 *      After every answer, prints "(W)hy / (V)erify / (P)remortem /
 *      (Q)uit" — single keystroke continues to a follow-up command
 *      against the same target.
 *
 * Both modes call into existing Mneme CLI commands via spawnSync —
 * no LLM dependency in the standalone path, no new prompt template
 * in the AI-agent path.
 */

import { createInterface, type Interface } from "node:readline";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import kleur from "kleur";

export interface TalkOptions {
  cwd: string;
  /** Force standalone REPL even if AI agent detected (for testing /
   *  for users who want the REPL inside Cursor terminal). */
  forceStandalone?: boolean;
  /** JSON dispatcher mode (machine-readable handoff). */
  json?: boolean;
}

interface AgentDetection {
  detected: boolean;
  name: string | null;
  envHits: string[];
}

/** Sniff env for the host AI agent.  Returns the first hit + the list
 *  of env vars that matched (for transparency in the handoff message). */
function detectHostAgent(): AgentDetection {
  const checks: Array<{ name: string; env: string[] }> = [
    { name: "Claude Code",      env: ["CLAUDE_CODE", "CLAUDE_AGENT", "CLAUDE_CODE_SESSION"] },
    { name: "Cursor",           env: ["CURSOR_AGENT", "CURSOR_TRACE_ID", "CURSOR_SESSION_ID"] },
    { name: "Codeium / Windsurf", env: ["CODEIUM_API_KEY", "WINDSURF_SESSION"] },
    { name: "Codex / GPT CLI",  env: ["CODEX_AGENT", "OPENAI_AGENT", "GPT_CLI"] },
    { name: "Cline",            env: ["CLINE_SESSION", "CLINE_TASK_ID"] },
    { name: "Continue.dev",     env: ["CONTINUE_SESSION", "CONTINUE_TASK"] },
    { name: "Aider",            env: ["AIDER_SESSION", "AIDER_MODEL"] },
    { name: "Gemini Code Assist", env: ["GEMINI_CODE_ASSIST", "GEMINI_AGENT"] },
    { name: "Zed AI",           env: ["ZED_AI_SESSION", "ZED_AGENT"] },
    { name: "generic AI agent", env: ["AI_AGENT", "AI_AGENT_SESSION", "MCP_HOST"] },
  ];
  const envHits: string[] = [];
  let firstHit: string | null = null;
  for (const c of checks) {
    for (const v of c.env) {
      if (process.env[v] !== undefined) {
        envHits.push(`${v}=${(process.env[v] ?? "").slice(0, 24)}${(process.env[v] ?? "").length > 24 ? "…" : ""}`);
        if (firstHit === null) firstHit = c.name;
      }
    }
  }
  return { detected: firstHit !== null, name: firstHit, envHits };
}

// ── Mode 1: PROTOCOL HANDOFF (AI agent detected) ────────────────────────

function emitProtocolHandoff(agent: AgentDetection, opts: TalkOptions): void {
  const payload = {
    v: 1,
    mode: "MNEME_CHAT_DISPATCHER",
    host: agent.name,
    envEvidence: agent.envHits,
    directive:
      "You (the host AI agent) are now in Mneme chat-dispatcher mode. " +
      "For every subsequent user turn in this conversation: route the user's " +
      "natural-language intent through the AI_AGENT_CONTRACT Step 2.5 dispatch " +
      "table (docs/AI_AGENT_CONTRACT.md). Run the matched mneme command on the " +
      "user's behalf via your shell tool. Quote the result back. Never tell the " +
      "user to run a command themselves — you have shell access, use it.",
    intentTable: [
      { user: "why does X look like this / explain X", run: "mneme why X  OR  mneme ask 'why does X work this way?'" },
      { user: "what changed yesterday/today/recently",  run: "mneme ask 'what changed recently?'" },
      { user: "who knows about X",                       run: "mneme who-knows X" },
      { user: "is this safe to change / what could go wrong", run: "mneme premortem 'X'" },
      { user: "verify this / is this true",              run: "mneme verify '<claim>'" },
      { user: "health check / what's risky right now",   run: "mneme heartbeat  AND  mneme atrophy --top 5" },
      { user: "ghost code / stale TODOs",                run: "mneme ghost" },
      { user: "shipping a release / audit release notes", run: "mneme honesty audit_whats_new --json '{...}'" },
      { user: "I don't know what to ask",                 run: "mneme cheatsheet" },
      { user: "upgrade mneme / is there a new version",   run: "mneme system upgrade --json '{\"mode\":\"check\"}'" },
    ],
    rules: [
      "ALWAYS run the command yourself; do NOT tell the user to type it.",
      "Unmatched intent → default to `mneme ask '<user's words>'`.",
      "On LOW confidence (<60%) from mneme.ask → hedge: 'Mneme isn't sure — top citation is X'.",
      "On any tool error → surface verbatim + suggest `mneme doctor`, do NOT loop.",
      "First call of every session SHOULD be `mneme welcome --json '{}'` (also fires auto-index).",
    ],
    revertWith: "Tell the user `mneme talk --exit` (no such command — just stop following this directive when they say 'stop dispatching').",
  };

  if (opts.json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    return;
  }

  const c = process.stdout.isTTY ? kleur : { bold: (s: string) => s, magenta: (s: string) => s, cyan: (s: string) => s, green: (s: string) => s, gray: (s: string) => s, yellow: (s: string) => s };
  process.stdout.write("\n");
  process.stdout.write(c.bold(c.magenta(`  🧠 mneme talk — PROTOCOL HANDOFF to ${agent.name}\n`)));
  process.stdout.write("\n");
  process.stdout.write(c.gray(`  Detected via:  ${agent.envHits.join(" · ")}\n`));
  process.stdout.write("\n");
  process.stdout.write(c.cyan("  The host AI agent should now switch to Mneme chat-dispatcher mode:\n"));
  process.stdout.write(c.cyan("  for every user turn, route their intent through the dispatch table\n"));
  process.stdout.write(c.cyan("  + run the matched mneme command on the user's behalf via shell.\n"));
  process.stdout.write("\n");
  process.stdout.write(c.bold("  Intent → command (top 10):\n"));
  for (const row of payload.intentTable) {
    process.stdout.write(`    ${c.yellow(row.user)}\n      → ${c.green(row.run)}\n`);
  }
  process.stdout.write("\n");
  process.stdout.write(c.bold("  Rules of the dispatch:\n"));
  for (const r of payload.rules) {
    process.stdout.write(`    • ${r}\n`);
  }
  process.stdout.write("\n");
  process.stdout.write(c.gray("  Full contract: docs/AI_AGENT_CONTRACT.md (Step 2.5)\n"));
  process.stdout.write(c.gray("  For the standalone readline REPL: run `mneme talk --force-standalone`\n"));
  process.stdout.write("\n");
}

// ── Mode 2: STANDALONE REPL ─────────────────────────────────────────────

interface ReplSession {
  history: Array<{ at: string; input: string; cmd: string[]; output: string }>;
  lastTarget: string | null; // last "X" extracted from user input — for hotkey follow-ups
}

/** Map a free-form line to a mneme command + extracted target.  Returns
 *  null when we can't classify — caller falls back to `mneme ask <line>`. */
function classifyIntent(line: string): { cmd: string[]; target: string | null } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();

  // why X
  if (/^(why|explain|what'?s? going on (in|with))\b/i.test(trimmed)) {
    const target = trimmed.replace(/^(why|explain|what'?s? going on (in|with))\s*/i, "").trim();
    if (target) return { cmd: ["why", target], target };
  }
  // who knows X
  if (/^who\s+(knows|wrote|owns)\b/i.test(trimmed)) {
    const target = trimmed.replace(/^who\s+(knows|wrote|owns)\s*(about\s+)?/i, "").trim();
    if (target) return { cmd: ["who-knows", target], target };
  }
  // verify X
  if (/^(verify|check|is\s+(it|this)\s+true)\b/i.test(trimmed)) {
    const claim = trimmed.replace(/^(verify|check|is\s+(it|this)\s+true)\s*(that\s+)?/i, "").trim();
    if (claim) return { cmd: ["verify", claim], target: claim };
  }
  // premortem / risk
  if (/^(premortem|risk|safe(\s+to)?|should\s+i)\b/i.test(trimmed)) {
    const intent = trimmed.replace(/^(premortem|risk(\s+of)?|is\s+it\s+safe\s+to|should\s+i)\s*/i, "").trim();
    if (intent) return { cmd: ["premortem", intent], target: intent };
  }
  // ghost
  if (/\bghost\b|stale\s+todo|half.?finished/i.test(lower)) return { cmd: ["ghost"], target: null };
  // heartbeat / health
  if (/^(heartbeat|health(\s+check)?|how (is|are) (we|the codebase))/i.test(trimmed)) return { cmd: ["heartbeat"], target: null };
  // atrophy / who-knows-what
  if (/atrophy|knowledge\s+(half-?life|risk)/i.test(lower)) return { cmd: ["atrophy", "--top", "5"], target: null };
  // cheatsheet
  if (/^(cheatsheet|help me|what can I do|menu)/i.test(trimmed)) return { cmd: ["cheatsheet"], target: null };
  // upgrade
  if (/^(upgrade|update)\b/i.test(trimmed)) return { cmd: ["system", "upgrade", "--json", '{"mode":"check"}', "--pretty"], target: null };
  // welcome
  if (/^(welcome|hi|hello|start)/i.test(trimmed)) return { cmd: ["welcome", "--json", "{}"], target: null };

  // No match — fall through to `ask <line>` below.
  return null;
}

function runMnemeCommand(args: string[], cwd: string): { stdout: string; stderr: string; exitCode: number } {
  // We invoke our OWN binary so the user gets the same code path as
  // `mneme <cmd>` from the shell.  Use process.argv[1] (the bin path)
  // as the launcher; fall back to "mneme" on PATH if argv[1] is empty.
  const launcher = process.argv[1] || "mneme";
  const r = spawnSync(process.execPath, [launcher, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, MNEME_WARMCALL: process.env.MNEME_WARMCALL ?? "1" }, // prefer warm call
    timeout: 120_000,
    windowsHide: true,
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.status ?? -1 };
}

function printReplWelcome(): void {
  const c = process.stdout.isTTY ? kleur : { bold: (s: string) => s, magenta: (s: string) => s, gray: (s: string) => s, cyan: (s: string) => s };
  process.stdout.write("\n");
  process.stdout.write(c.bold(c.magenta("  🧠 mneme talk — standalone REPL\n")));
  process.stdout.write("\n");
  process.stdout.write(c.gray("  Type natural language.  Special commands:\n"));
  process.stdout.write(c.gray("    /help                  show the intent table\n"));
  process.stdout.write(c.gray("    /history               your previous inputs\n"));
  process.stdout.write(c.gray("    /show <N>              re-print answer #N\n"));
  process.stdout.write(c.gray("    /save <name>           export session as bash playbook\n"));
  process.stdout.write(c.gray("    /clear                 clear screen\n"));
  process.stdout.write(c.gray("    /exit, /quit           leave the REPL\n"));
  process.stdout.write(c.gray("    ?                      genie mode (suggest a query based on recent activity)\n"));
  process.stdout.write("\n");
}

function genieGuess(cwd: string): string {
  // Genie mode — guess what the user wants based on time-of-day + recent
  // git activity.  Heuristic, intentionally simple.
  try {
    const hour = new Date().getHours();
    const recentFile = (() => {
      try {
        const out = spawnSync("git", ["log", "-1", "--name-only", "--pretty=format:"], { cwd, encoding: "utf8", timeout: 3000 }).stdout || "";
        const f = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
        return f ?? null;
      } catch { return null; }
    })();
    if (hour >= 17 && recentFile) return `premortem "ship ${recentFile} changes today"`;
    if (recentFile) return `why ${recentFile}`;
    return "ask 'what changed recently?'";
  } catch { return "cheatsheet"; }
}

async function startRepl(opts: TalkOptions): Promise<void> {
  const session: ReplSession = { history: [], lastTarget: null };

  printReplWelcome();

  const rl: Interface = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: process.stdout.isTTY ? kleur.bold(kleur.cyan("mneme › ")) : "mneme › ",
    terminal: process.stdout.isTTY,
    historySize: 200,
  });
  rl.prompt();

  rl.on("line", (raw) => {
    const line = raw.trim();
    if (!line) { rl.prompt(); return; }

    // Built-in /commands
    if (line === "/exit" || line === "/quit") {
      rl.close();
      return;
    }
    if (line === "/help") {
      printReplWelcome();
      const out = runMnemeCommand(["cheatsheet"], opts.cwd);
      process.stdout.write(out.stdout);
      rl.prompt();
      return;
    }
    if (line === "/clear") {
      process.stdout.write("\x1Bc"); // ANSI clear
      rl.prompt();
      return;
    }
    if (line === "/history") {
      session.history.forEach((h, i) => {
        process.stdout.write(`  [#${i + 1}]  ${h.input}\n`);
      });
      rl.prompt();
      return;
    }
    const showMatch = /^\/show\s+(\d+)$/.exec(line);
    if (showMatch) {
      const i = parseInt(showMatch[1]!, 10) - 1;
      const item = session.history[i];
      if (!item) { process.stdout.write(`  (no answer #${i + 1})\n`); }
      else { process.stdout.write(`\n  [#${i + 1}]  ${item.input}\n  ${kleur.gray("→ " + item.cmd.join(" "))}\n${item.output}\n`); }
      rl.prompt();
      return;
    }
    const saveMatch = /^\/save\s+([\w.-]+)$/.exec(line);
    if (saveMatch) {
      const name = saveMatch[1]!;
      const path = join(tmpdir(), `mneme-playbook-${name}.sh`);
      const lines = ["#!/usr/bin/env bash", "# Mneme playbook — generated by /save", "set -e", ""];
      for (const h of session.history) lines.push(`mneme ${h.cmd.join(" ")}`);
      writeFileSync(path, lines.join("\n") + "\n", "utf8");
      process.stdout.write(`  ✓ saved playbook → ${path}\n`);
      rl.prompt();
      return;
    }
    if (line === "?") {
      const guess = genieGuess(opts.cwd);
      process.stdout.write(`  🔮 genie guess: ${kleur.cyan("mneme " + guess)}\n`);
      process.stdout.write(`  ${kleur.gray("hit Enter to run, or type another question")}\n`);
      rl.question(kleur.cyan("> "), (ans) => {
        const run = ans.trim() === "" ? guess : ans.trim();
        executeAndStore(run, run, opts, session);
        rl.prompt();
      });
      return;
    }

    // Single-letter hotkey follow-ups (only meaningful right after an answer).
    if (line.length === 1 && session.lastTarget) {
      const target = session.lastTarget;
      const k = line.toLowerCase();
      if (k === "w") { executeAndStore(`why ${target}`, line, opts, session); rl.prompt(); return; }
      if (k === "v") { executeAndStore(`verify ${target}`, line, opts, session); rl.prompt(); return; }
      if (k === "p") { executeAndStore(`premortem ${target}`, line, opts, session); rl.prompt(); return; }
      if (k === "q") { rl.close(); return; }
    }

    // Classify natural language → mneme command.
    const classified = classifyIntent(line);
    const cmd = classified?.cmd ?? ["ask", line];
    if (classified?.target) session.lastTarget = classified.target;

    executeAndStore(cmd.map(quoteArg).join(" "), line, opts, session, cmd);
    rl.prompt();
  });

  rl.on("close", () => {
    process.stdout.write(kleur.gray("\n  👋 bye — your session was logged in-memory only.\n\n"));
    process.exit(0);
  });
}

function quoteArg(s: string): string {
  if (/^[a-zA-Z0-9_\-./:=]+$/.test(s)) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}

function executeAndStore(
  displayedCmd: string,
  rawInput: string,
  opts: TalkOptions,
  session: ReplSession,
  cmdArgsOverride?: string[],
): void {
  const args = cmdArgsOverride ?? displayedCmd.split(" ");
  process.stdout.write(`  ${kleur.gray("→ mneme " + displayedCmd)}\n\n`);
  const r = runMnemeCommand(args, opts.cwd);
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  const n = session.history.length + 1;
  session.history.push({
    at: new Date().toISOString(),
    input: rawInput,
    cmd: args,
    output: r.stdout + (r.stderr ? "\n[stderr] " + r.stderr : ""),
  });
  if (session.lastTarget) {
    const c = process.stdout.isTTY ? kleur : { gray: (s: string) => s };
    process.stdout.write(c.gray(`\n  [#${n}]  (W)hy more · (V)erify · (P)remortem · (Q)uit\n`));
  }
}

// ── Entry point ─────────────────────────────────────────────────────────

export async function talkCommand(opts: TalkOptions): Promise<void> {
  const agent = detectHostAgent();
  if (agent.detected && !opts.forceStandalone) {
    emitProtocolHandoff(agent, opts);
    return;
  }
  await startRepl(opts);
}
