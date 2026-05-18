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

/**
 * v2.19.41 — OMNI-FLAG protocol.
 *
 *   User mandate (2026-05-18): `mneme system upgrade --mode install` failed
 *   with "unknown option '--mode'" because the router only registered the
 *   generic `--json '{...}'` flag. AI agents had to memorise which command
 *   family used JSON-blob vs POSIX flags. v2.19.41 reads each tool's
 *   inputSchema.properties and auto-registers every property as a POSIX
 *   option. Both forms now work for every tool:
 *
 *     mneme system upgrade --mode install           # POSIX
 *     mneme system upgrade --json '{"mode":"install"}'  # JSON-blob
 *
 *   Boolean properties become flag-form (no value); string/number/array
 *   become value-form. Auto-derived args merge with --json args (POSIX
 *   wins on conflict so user can override the JSON-blob).
 */
function isJsonSchemaObject(schema: unknown): schema is { type?: string; properties?: Record<string, { type?: string; description?: string; default?: unknown }> } {
  return !!schema && typeof schema === "object" && (schema as { type?: string }).type !== undefined;
}

function deriveOmniFlags(tool: ToolLike): Array<{ flag: string; description: string; coerce: (v: string) => unknown }> {
  const out: Array<{ flag: string; description: string; coerce: (v: string) => unknown }> = [];
  if (!isJsonSchemaObject(tool.inputSchema)) return out;
  const props = tool.inputSchema.properties ?? {};
  for (const [key, def] of Object.entries(props)) {
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "");
    if (!safeKey || safeKey === "json" || safeKey === "pretty") continue; // reserved
    const flagName = `--${safeKey}`;
    const desc = (def && typeof def === "object" && typeof def.description === "string") ? def.description.slice(0, 80) : `${key} arg`;
    if (def && def.type === "boolean") {
      out.push({ flag: flagName, description: desc, coerce: (v: string) => v === "" || v === "true" || v === "1" });
    } else if (def && (def.type === "number" || def.type === "integer")) {
      out.push({ flag: `${flagName} <n>`, description: desc, coerce: (v: string) => Number(v) });
    } else if (def && def.type === "array") {
      out.push({ flag: `${flagName} <items>`, description: desc + " (JSON array or comma-separated)", coerce: (v: string) => { try { return JSON.parse(v); } catch { return v.split(",").map((s) => s.trim()); } } });
    } else if (def && def.type === "object") {
      out.push({ flag: `${flagName} <json>`, description: desc + " (JSON object)", coerce: (v: string) => { try { return JSON.parse(v); } catch { return v; } } });
    } else {
      out.push({ flag: `${flagName} <value>`, description: desc, coerce: (v: string) => v });
    }
  }
  return out;
}

function mergeArgs(jsonArgs: Record<string, unknown>, posixOpts: Record<string, unknown>, omniFlags: Array<{ flag: string; coerce: (v: string) => unknown }>): Record<string, unknown> {
  const merged = { ...jsonArgs };
  for (const f of omniFlags) {
    // Extract the option name from flags like "--mode <value>" or "--force"
    const match = f.flag.match(/^--([a-zA-Z0-9_-]+)/);
    if (!match) continue;
    const optName = match[1]!;
    const camelName = optName.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (posixOpts[camelName] !== undefined) {
      const rawVal = posixOpts[camelName];
      merged[optName] = typeof rawVal === "string" ? f.coerce(rawVal) : rawVal;
    }
  }
  return merged;
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

/** v2.19.35 R4 fix — 2-part tool names like `mneme.browse` were silently
 *  skipped pre-v2.19.35 (router required 3 parts). Now register them as
 *  top-level CLI commands so `mneme browse` works as documented. */
function findTwoPartTools(tools: ToolLike[]): ToolLike[] {
  return tools.filter((t) => {
    const parts = t.name.split(".");
    return parts.length === 2 && parts[0] === "mneme";
  });
}

/**
 * Register `mneme <family>` parent commands + `mneme <family> <action>` children
 * for every MCP tool family. Idempotent (Commander silently dedupes).
 */
export interface RouterStats {
  families: number;
  actions: number;
  /** v2.19.21 — families whose MCP wrappers were mounted onto an EXISTING legacy parent. */
  mountedOnExisting: string[];
  /** v2.19.28 — families or family.action pairs that threw during registration; never aborts the loop. */
  skipped: string[];
}

/** v2.19.28 B2 fix — check both .name() AND .aliases() so an MCP family
 *  whose name matches a LEGACY ALIAS (e.g., `hive` is alias of `stigmergy`)
 *  is recognised as "existing" and mounted-on instead of throwing
 *  `cannot add command 'X' as already have command 'Y|X'`. */
function findExistingCommand(program: Command, name: string): Command | undefined {
  for (const c of program.commands) {
    if (c.name() === name) return c;
    const aliases = typeof c.aliases === "function" ? c.aliases() : [];
    if (aliases.includes(name)) return c;
  }
  return undefined;
}

export function registerUniversalMcpSubcommands(program: Command, tools: ToolLike[]): RouterStats {
  const families = groupByFamily(tools);
  let actionCount = 0;
  const mountedOnExisting: string[] = [];
  const skipped: string[] = [];
  for (const [family, familyTools] of families) {
    // v2.19.21 — CLI FAMILY-CLASH RESOLVER. v2.19.28 extended to alias clashes.
    //
    // If a family clashes with an existing legacy top-level command (e.g.,
    // `ghost` collides with the ghost-code lens; `dream` collides with the
    // dream-research subcommand; `oracle` collides with revenue-primitive
    // CLI; `constitution` collides with v0.x constitution editor; `hive` is
    // an alias of `stigmergy`), DO NOT skip the family. Instead, MOUNT the
    // MCP subcommands onto the existing parent. Commander dispatches
    // first-positional-arg to a registered subcommand when the name matches;
    // falls back to the parent's own action otherwise. So `mneme ghost` still
    // runs the legacy ghost-code lens, but `mneme ghost distill` now
    // dispatches to the MCP wrapper.
    //
    // v2.19.28 B2 fix: wrap each family in try/catch so ONE bad family does
    // not abort the entire router loop (which previously lost 100+ families
    // including DREAMSPACE).
    try {
      const existing = findExistingCommand(program, family);
      let parent: Command;
      if (existing) {
        parent = existing;
        if (!mountedOnExisting.includes(family)) mountedOnExisting.push(family);
      } else {
        parent = program.command(family)
          .description(`Mneme ${family} family — ${familyTools.length} action(s). Run \`mneme ${family} --help\` for actions, or \`mneme ${family} <action> --json '{...}'\` to invoke.`)
          .action(() => {
            process.stdout.write(`📚 mneme.${family}.* · ${familyTools.length} action(s):\n`);
            for (const t of familyTools) {
              const action = t.name.split(".")[2] ?? "";
              process.stdout.write(`  ${action.padEnd(28)} ${(t.description ?? "").slice(0, 80)}\n`);
            }
            process.stdout.write(`\nInvoke: mneme ${family} <action> --json '{...}'\n`);
          });
      }

      for (const tool of familyTools) {
        const action = tool.name.split(".")[2]!;
        // Skip if action name already registered on this parent (e.g., when a
        // legacy command happens to have an option with the same name, or
        // re-running registration in the same process).
        if (parent.commands.find((c) => c.name() === action)) continue;
        try {
          const omniFlags = deriveOmniFlags(tool);
          const cmd = parent.command(action)
            .description((tool.description ?? "").slice(0, 200))
            .option("--json [jsonArgs]", "Tool arguments as a JSON object string (or '{}' for none)")
            .option("--pretty", "Pretty-print the output (default: compact JSON)");
          for (const f of omniFlags) {
            cmd.option(f.flag, f.description);
          }
          cmd.action(async (opts: Record<string, unknown>) => {
              let args: Record<string, unknown> = {};
              const jsonOpt = opts["json"];
              if (typeof jsonOpt === "string" && jsonOpt.length > 0) {
                try { args = JSON.parse(jsonOpt) as Record<string, unknown>; }
                catch (e) { process.stderr.write(`⚠ --json parse error: ${(e as Error).message}\n`); process.exit(2); }
              }
              // v2.19.41 OMNI-FLAG: merge POSIX-derived args over JSON-blob args.
              args = mergeArgs(args, opts, omniFlags);
              try {
                const result = await tool.handler({ repoRoot: process.cwd() }, args);
                const out = opts["pretty"] ? JSON.stringify(result, null, 2) : JSON.stringify(result);
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
        } catch {
          // Per-tool registration failure must not abort the loop.
          skipped.push(`${family}.${action}`);
        }
      }
    } catch {
      // Per-family failure must not abort the loop.
      skipped.push(family);
    }
  }

  // v2.19.35 R4 fix — register 2-part tool names (e.g., mneme.browse,
  // mneme.suggest) as top-level CLI commands. Pre-v2.19.35 these were
  // silently skipped because the router only handled 3-part mneme.X.Y.
  for (const tool of findTwoPartTools(tools)) {
    const name = tool.name.split(".")[1]!;
    if (findExistingCommand(program, name)) continue;
    try {
      const omniFlags = deriveOmniFlags(tool);
      const cmd = program.command(name)
        .description((tool.description ?? "").slice(0, 200))
        .option("--json [jsonArgs]", "Tool arguments as a JSON object string (or '{}' for none)")
        .option("--pretty", "Pretty-print the output (default: compact JSON)");
      for (const f of omniFlags) cmd.option(f.flag, f.description);
      cmd.action(async (opts: Record<string, unknown>) => {
          let args: Record<string, unknown> = {};
          const jsonOpt = opts["json"];
          if (typeof jsonOpt === "string" && jsonOpt.length > 0) {
            try { args = JSON.parse(jsonOpt) as Record<string, unknown>; }
            catch (e) { process.stderr.write(`⚠ --json parse error: ${(e as Error).message}\n`); process.exit(2); }
          }
          args = mergeArgs(args, opts, omniFlags);
          try {
            const result = await tool.handler({ repoRoot: process.cwd() }, args);
            const out = opts["pretty"] ? JSON.stringify(result, null, 2) : JSON.stringify(result);
            process.stdout.write(out + "\n");
            process.exit(0);
          } catch (e) {
            process.stderr.write(`⚠ tool '${tool.name}' threw: ${(e as Error).message}\n`);
            process.exit(1);
          }
        });
      actionCount++;
    } catch {
      skipped.push(name);
    }
  }

  return { families: families.size, actions: actionCount, mountedOnExisting, skipped };
}
