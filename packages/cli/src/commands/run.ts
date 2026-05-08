/**
 * `mneme run <alias-or-id>` — execute a library molecule plan.
 *
 * Resolves the entry by alias or 16-char id, then runs the plan via the
 * executor. Tracks the invocation as a hit so frequency-based promotion
 * picks it up.
 *
 * --dry-run is the default: prints what WOULD execute without invoking
 * any side-effecting steps. --execute opts in to running the plan.
 */

import kleur from "kleur";
import { git, periodic } from "@mneme-ai/core";
import { ui, header, section, kv, divider } from "../ui.js";

export interface RunOptions {
  cwd: string;
  needle: string;
  execute?: boolean;
  json?: boolean;
  quiet?: boolean;
  forbidNetwork?: boolean;
  forbidFilesystem?: boolean;
  forbidGit?: boolean;
  forbidSubprocess?: boolean;
}

export async function runCommand(opts: RunOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);

  const entry = await periodic.findByAliasOrId(meta.rootPath, opts.needle);
  if (!entry) {
    ui.error(`No library entry with alias or id "${opts.needle}". Try \`mneme library\` to list.`);
    return 1;
  }

  const forbidSideEffects: periodic.SideEffect[] = [];
  if (opts.forbidNetwork) forbidSideEffects.push("network");
  if (opts.forbidFilesystem) forbidSideEffects.push("filesystem");
  if (opts.forbidGit) forbidSideEffects.push("git");
  if (opts.forbidSubprocess) forbidSideEffects.push("subprocess");

  if (!opts.execute) {
    if (!opts.quiet && !opts.json) ui.banner();
    if (opts.json) {
      process.stdout.write(JSON.stringify({ entry, dryRun: true }, null, 2) + "\n");
      return 0;
    }
    process.stdout.write(
      header(
        "🧪",
        `Run — ${entry.alias ?? entry.id}  (DRY-RUN)`,
        `"${entry.intent}"`,
        "Showing what would execute. Pass --execute to actually run.",
      ) + "\n\n",
    );
    process.stdout.write(kv("hits", `${entry.hits}`) + "\n");
    process.stdout.write(kv("estimated p50", `${entry.plan.estimatedMsP50.toFixed(1)} ms`) + "\n");
    process.stdout.write(kv("steps", String(entry.plan.steps.length)) + "\n\n");
    process.stdout.write(section("Plan") + "\n\n");
    for (let i = 0; i < entry.plan.steps.length; i++) {
      const s = entry.plan.steps[i]!;
      const m = periodic.registry.get(s.id);
      const cost = m ? `[${m.cost.cpu}·${m.cost.msP50}ms · ${m.sideEffect}]` : "";
      process.stdout.write(
        `  ${kleur.gray(`${i + 1}.`)} ${kleur.cyan(s.id.padEnd(34))} ${kleur.gray(cost.padEnd(22))} ${kleur.white(s.why ?? "")}\n`,
      );
    }
    process.stdout.write(
      "\n  " +
        kleur.gray("Pass --execute to actually run, or --execute --forbid-network for a sandboxed run.") +
        "\n",
    );
    return 0;
  }

  // ── execute ──────────────────────────────────────────────────────
  const result = await periodic.executePlan(entry.plan, {
    cwd: meta.rootPath,
    forbidSideEffects,
  });

  // Bump hit count + lastSeen
  await periodic.recordInvocation(meta.rootPath, entry.intent, entry.plan);

  if (opts.json) {
    // Strip non-serialisable scratch values for JSON safety
    const safe = {
      ...result,
      scratch: Object.fromEntries(
        Object.entries(result.scratch).map(([k, v]) => [k, summariseForJson(v)]),
      ),
    };
    process.stdout.write(JSON.stringify(safe, null, 2) + "\n");
    return result.ok ? 0 : 1;
  }

  if (!opts.quiet) ui.banner();
  process.stdout.write(
    header(
      "🧪",
      `Run — ${entry.alias ?? entry.id}`,
      `"${entry.intent}"`,
      "Executed the plan; results below.",
    ) + "\n\n",
  );
  process.stdout.write(
    kv("total time", `${result.totalMs} ms`) +
      "\n" +
      kv("steps ok", `${result.results.filter((r) => r.ok).length}/${result.results.length}`) +
      "\n" +
      kv("verdict", result.ok ? kleur.green("PASS") : kleur.red("PARTIAL")) +
      "\n\n",
  );

  process.stdout.write(section("Step results") + "\n\n");
  for (let i = 0; i < result.results.length; i++) {
    const r = result.results[i]!;
    const ok = r.ok ? kleur.green("●") : kleur.red("✗");
    process.stdout.write(
      `  ${kleur.gray(`${i + 1}.`)} ${ok} ${kleur.cyan(r.step.id.padEnd(34))} ${kleur.gray(`${r.msActual} ms`)}\n` +
        `      ${kleur.gray("→")} ${kleur.white(r.outputPreview || "(no output)")}\n` +
        (r.error ? `      ${kleur.red("error:")} ${kleur.red(r.error)}\n` : ""),
    );
  }
  process.stdout.write(
    "\n" +
      divider("📘 How to read") +
      "\n  " +
      kleur.gray(
        "Each step's full output lives in the executor scratchpad keyed by step id.\n" +
          "  In v0.42 we render only summaries here. Run with --json for the full scratch.",
      ) +
      "\n\n",
  );

  return result.ok ? 0 : 1;
}

function summariseForJson(v: unknown): unknown {
  if (v == null) return v;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Float32Array || v instanceof Uint8Array) return `<typed-array len=${v.length}>`;
  if (Array.isArray(v)) return `<array len=${v.length}>`;
  if (typeof v === "object") {
    const keys = Object.keys(v as Record<string, unknown>).slice(0, 8);
    return `<object keys=${keys.join(",")}>`;
  }
  return typeof v;
}
