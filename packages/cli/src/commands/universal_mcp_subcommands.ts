/**
 * v2.19.8 — UNIVERSAL MCP SUBCOMMAND AUTO-ROUTER
 *
 *   "User shouldn't have to memorise 446 tool names — but also
 *    shouldn't have to wait for someone to hand-write `mneme arena`
 *    + `mneme badge` + ... for every family. We read the MCP tool
 *    catalog at CLI startup, and for each `mneme.<family>.<action>`
 *    we register `mneme <family> <action>` automatically. ONE file
 *    covers EVERY existing + future MCP family. The 'forgot to write
 *    a CLI route' bug class dies."
 *
 * Usage (after install):
 *   mneme <family>                          # list actions in that family
 *   mneme <family> <action> --json '{...}'  # invoke with JSON args
 *   mneme <family> <action> --help          # show schema + examples
 *
 * Example:
 *   mneme arena                              # list arena.judge + arena.leaderboard
 *   mneme arena judge --json '{"prompt":"...","taskClass":"fact_check",...}'
 *   mneme chronostasis tick                  # zero-arg tools work without --json
 *   mneme chronostasis propose --json '{"body":"...","deadlineSec":600}'
 *
 * Honest scope:
 *   - JSON-args is universal but not ergonomic. v2.19.9 should add typed
 *     flags per-tool by mining the inputSchema. For now: JSON-args + --help.
 *   - The handler INVOKES the tool's handler directly (bypasses MCP
 *     server), which means we need a minimal runtime stub that the tool
 *     handlers accept. We supply { repoRoot: process.cwd() } as runtime.
 */

import type { Command } from "commander";

interface ToolLike {
  name: string;
  description?: string;
  category?: string;
  inputSchema?: unknown;
  examples?: Array<{ userQuery: string; args?: Record<string, unknown>; expectedOutput?: string }>;
  pitfalls?: string[];
  // Handler shape varies by runtime; accept any shape and pass-through.
  handler: (rt: unknown, args: Record<string, unknown>) => Promise<unknown> | unknown;
}

function groupByFamily(tools: ToolLike[]): Map<string, ToolLike[]> {
  const m = new Map<string, ToolLike[]>();
  for (const t of tools) {
    const parts = t.name.split(".");
    if (parts.length !== 3 || parts[0] !== "mneme") continue;
    const family = parts[1]!;
    const arr = m.get(family) ?? [];
    arr.push(t);
    m.set(family, arr);
  }
  return m;
}

/**
 * Register `mneme <family>` parent commands + `mneme <family> <action>` children
 * for every MCP tool family. Idempotent (Commander silently dedupes).
 */
export function registerUniversalMcpSubcommands(program: Command, tools: ToolLike[]): { families: number; actions: number } {
  const families = groupByFamily(tools);
  let actionCount = 0;
  for (const [family, familyTools] of families) {
    // Some families clash with existing top-level commands (e.g., `tools`, `do`,
    // `init`, `guard`). Skip those — the existing commands take precedence.
    const existing = program.commands.find((c) => c.name() === family);
    if (existing) continue;

    const parent = program.command(family)
      .description(`Mneme ${family} family — ${familyTools.length} action(s). Run \`mneme ${family} --help\` for actions, or \`mneme ${family} <action> --json '{...}'\` to invoke.`)
      .action(() => {
        process.stdout.write(`📚 mneme.${family}.* · ${familyTools.length} action(s):\n`);
        for (const t of familyTools) {
          const action = t.name.split(".")[2] ?? "";
          process.stdout.write(`  ${action.padEnd(28)} ${(t.description ?? "").slice(0, 80)}\n`);
        }
        process.stdout.write(`\nInvoke: mneme ${family} <action> --json '{...}'\n`);
      });

    for (const tool of familyTools) {
      const action = tool.name.split(".")[2]!;
      const cmd = parent.command(action)
        .description((tool.description ?? "").slice(0, 200))
        .option("--json <jsonArgs>", "Tool arguments as a JSON object string")
        .option("--pretty", "Pretty-print the output (default: compact JSON)")
        .action(async (opts: { json?: string; pretty?: boolean }) => {
          let args: Record<string, unknown> = {};
          if (opts.json) {
            try { args = JSON.parse(opts.json) as Record<string, unknown>; }
            catch (e) { process.stderr.write(`⚠ --json parse error: ${(e as Error).message}\n`); process.exit(2); }
          }
          try {
            const result = await tool.handler({ repoRoot: process.cwd() }, args);
            const out = opts.pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result);
            process.stdout.write(out + "\n");
            process.exit(0);
          } catch (e) {
            process.stderr.write(`⚠ tool '${tool.name}' threw: ${(e as Error).message}\n`);
            process.exit(1);
          }
        });
      // Show examples in --help if present
      if (tool.examples && tool.examples.length > 0) {
        const ex = tool.examples[0]!;
        cmd.addHelpText("after", `\nExample:\n  mneme ${family} ${action} --json '${JSON.stringify(ex.args ?? {})}'\n`);
      }
      actionCount++;
    }
  }
  return { families: families.size, actions: actionCount };
}
