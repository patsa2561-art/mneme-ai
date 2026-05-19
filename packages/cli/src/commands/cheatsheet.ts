/**
 * v2.19.75 — `mneme cheatsheet` command.
 *
 *   The single-screen "what do I actually type?" guide.  No
 *   pagination, no scrolling, no nested menus — pick a line,
 *   copy-paste, run.
 *
 *   Designed for the user-confusion problem the user audited
 *   2026-05-19: "ถึงแม้จะบอกว่าติดตั้ง mneme ใน ai agent แต่ user ก็งงอยู่ดี
 *   ว่าจะใช้คำสั่งอะไรพิมพ์อะไรแบบไหน".  Mneme has 711 MCP tools +
 *   `groups`, `capabilities`, `browse`, `welcome` already, but each is
 *   a deep surface that expects the user to know what they're looking
 *   for.  The cheatsheet is the OPPOSITE: ten commands, the most
 *   common questions, one screen, copy-paste ready.
 *
 *   Smart bit: examples reference the USER'S actual repo (latest
 *   commit, top file by churn, current branch) so they're never
 *   abstract.  Falls back to generic examples if the repo isn't
 *   indexed yet.
 */

import kleur from "kleur";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

export interface CheatsheetOptions {
  cwd: string;
  json?: boolean;
}

interface RepoContext {
  branch: string | null;
  latestCommit: string | null;
  topFile: string | null;
  isMnemeRepo: boolean;
}

function discoverRepoContext(cwd: string): RepoContext {
  let branch: string | null = null;
  let latestCommit: string | null = null;
  let topFile: string | null = null;
  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000,
    }).trim() || null;
  } catch { /* */ }
  try {
    latestCommit = execSync("git log -1 --format=%H", {
      cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000,
    }).trim().slice(0, 7) || null;
  } catch { /* */ }
  try {
    // Pick the most-modified non-test, non-dist file in the last 90 days.
    const out = execSync(
      "git log --since=\"90 days ago\" --name-only --pretty=format: -- . \":(exclude)*.test.*\" \":(exclude)dist/**\"",
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 },
    );
    const counts: Record<string, number> = {};
    for (const line of out.split("\n")) {
      const f = line.trim();
      if (!f) continue;
      counts[f] = (counts[f] ?? 0) + 1;
    }
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) topFile = sorted[0]![0]!;
  } catch { /* */ }
  let isMnemeRepo = false;
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as { name?: string };
    isMnemeRepo = !!pkg.name && (pkg.name === "mneme-monorepo" || pkg.name.startsWith("@mneme-ai/") || pkg.name === "mneme-ai");
  } catch { /* */ }
  return { branch, latestCommit, topFile, isMnemeRepo };
}

interface CheatsheetRow {
  cmd: string;          // copy-paste-ready command string
  what: string;         // short description of what it does
  when: string;         // when you'd use it (the user's mental model)
}

function buildRows(ctx: RepoContext): CheatsheetRow[] {
  const exampleFile = ctx.topFile ?? "packages/core/src/index.ts";
  const exampleCommit = ctx.latestCommit ?? "HEAD";
  return [
    {
      cmd: `mneme welcome --json '{}'`,
      what: `the AI-agent first-contact ritual`,
      when: `at the start of every session — surface what Mneme can do`,
    },
    {
      cmd: `mneme ask "why does ${exampleFile} look the way it does?"`,
      what: `Q&A against the codebase's git history + commit memory`,
      when: `when you're staring at unfamiliar code + want context`,
    },
    {
      cmd: `mneme why ${exampleFile}`,
      what: `the originating commits + author lineage of one file`,
      when: `before you change a file you didn't write — "who knew why?"`,
    },
    {
      cmd: `mneme verify "<your claim about the repo>"`,
      what: `claim verification — ACCEPTED / REFUTED / NEEDS-DATA`,
      when: `before you let your AI tool ship a fact it just stated`,
    },
    {
      cmd: `mneme premortem "<thing you're about to do>"`,
      what: `P(regret) — historical fraction of similar attempts that backfired`,
      when: `before risky refactors / migrations / dep bumps`,
    },
    {
      cmd: `mneme heartbeat`,
      what: `20-axis codebase MRI vs your rolling baseline`,
      when: `daily / weekly — catches "we're in firefight mode" earlier than vibes`,
    },
    {
      cmd: `mneme atrophy --top 5`,
      what: `knowledge half-life — who still remembers what`,
      when: `before someone takes a holiday or a refactor lands on legacy code`,
    },
    {
      cmd: `mneme ghost`,
      what: `half-finished features, stale TODOs, mystery edits`,
      when: `before an audit or onboarding a new contributor`,
    },
    {
      cmd: `mneme honesty audit_whats_new --json '{}'`,
      what: `release-note verifier — refuses ship-broken claims`,
      when: `before tagging a release`,
    },
    {
      cmd: `mneme chat`,
      what: `interactive natural-language REPL — no CLI flag memorisation`,
      when: `when you don't know which command to use — just describe it`,
    },
  ];
}

export function cheatsheetCommand(opts: CheatsheetOptions): void {
  const ctx = discoverRepoContext(opts.cwd);
  const rows = buildRows(ctx);

  if (opts.json) {
    process.stdout.write(JSON.stringify({
      v: 1,
      repo: ctx,
      rows,
      footer: "Run `mneme chat` for interactive natural-language mode.",
    }, null, 2) + "\n");
    return;
  }

  const tty = !!process.stdout.isTTY;
  const c = tty
    ? { dim: kleur.gray, bold: kleur.bold, cyan: kleur.cyan, green: kleur.green, yellow: kleur.yellow, magenta: kleur.magenta }
    : { dim: (s: string) => s, bold: (s: string) => s, cyan: (s: string) => s, green: (s: string) => s, yellow: (s: string) => s, magenta: (s: string) => s };

  const lines: string[] = [];
  lines.push("");
  lines.push(c.bold(c.magenta("  ╭──────────────────────────────────────────────────────────────────╮")));
  lines.push(c.bold(c.magenta("  │  μνήμη · Mneme cheatsheet — 10 commands, one screen, copy-paste  │")));
  lines.push(c.bold(c.magenta("  ╰──────────────────────────────────────────────────────────────────╯")));
  lines.push("");
  if (ctx.branch || ctx.latestCommit) {
    const here = [
      ctx.branch ? `branch ${c.cyan(ctx.branch)}` : null,
      ctx.latestCommit ? `HEAD ${c.cyan(ctx.latestCommit)}` : null,
      ctx.topFile ? `hot file ${c.cyan(ctx.topFile)}` : null,
    ].filter(Boolean).join("  ·  ");
    lines.push(c.dim(`  you are here:  ${here}`));
    lines.push("");
  }

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const num = c.dim(`  ${(i + 1).toString().padStart(2, " ")}. `);
    lines.push(num + c.bold(c.green(r.cmd)));
    lines.push(`      ${c.yellow(r.what)}`);
    lines.push(`      ${c.dim("when → " + r.when)}`);
    lines.push("");
  }

  lines.push(c.dim("  Pro tips"));
  lines.push(c.dim("  • Every command accepts --json '{}' for machine-readable output."));
  lines.push(c.dim("  • Every command accepts --pretty when --json is set (human-readable JSON)."));
  lines.push(c.dim("  • Run `mneme groups` for the 40+ commands organised by intent."));
  lines.push(c.dim("  • Run `mneme chat` to interactively describe what you want in natural language."));
  lines.push("");

  process.stdout.write(lines.join("\n"));
}
