/**
 * `mneme boot` (v2.133.0) — THE ACTIVATION CORTEX.
 * The first thing an agent (or a SessionStart hook) calls so it instantly knows
 * Mneme is connected + WHEN to reach for which tool (the task→tool decision
 * table) + what the shared memory already knows about this repo.
 *
 *   mneme boot                  # human-readable activation digest
 *   mneme boot --json           # full signed packet
 *   mneme boot --task "..."     # rank the table for the task at hand
 *   mneme boot --hook           # emit the activation CONTEXT (what a SessionStart hook injects)
 *   mneme boot --emit-hook-config   # print the .claude/settings.json snippet to enable the hook
 */

import type { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { boot, cortex, notary } from "@mneme-ai/core";
import { getVersion } from "../version.js";

function out(s: string): void { process.stdout.write(s + "\n"); }

/**
 * Auto-ensure the Matrix Rail (gRPC) is up as a SIDE-EFFECT of activation — so any
 * AI agent that boots Mneme (the manifest tells it to, first thing) makes the full
 * tool surface reachable over gRPC for cross-process / other-language clients,
 * WITHOUT the user knowing any command and WITHOUT a hook being installed.
 *
 * Anti-worm-safe (Rule 9): this fires only when an agent ACTIVELY activates Mneme in
 * a live session — it is loopback-only, idempotent (no pile-up), reversible, and never
 * touches the install / never registers a persistent OS service. Opt out with
 * MNEME_NO_MATRIX=1. Best-effort + silent: a failure never blocks boot.
 */
function autoEnsureMatrix(cwd: string): void {
  if (process.env["MNEME_NO_MATRIX"] === "1") return;
  try {
    // already up? (pid-alive check — avoids spawning anything on the common path)
    const disc = join(cwd, ".mneme", "matrix.json");
    if (existsSync(disc)) {
      const j = JSON.parse(readFileSync(disc, "utf8")) as { pid?: number };
      if (j.pid) { try { process.kill(j.pid, 0); return; } catch { /* stale → (re)ensure */ } }
    }
    const bin = process.argv[1];
    if (!bin) return;
    // delegate to the idempotent, fail-open `matrix ensure` (handles the lazy-load of
    // the optional @mneme-ai/matrix + spawns the loopback server detached).
    void import("node:child_process").then(({ spawn }) => {
      try { spawn(process.execPath, [bin, "matrix", "ensure"], { cwd, detached: true, stdio: "ignore" }).unref(); } catch { /* best-effort */ }
    }).catch(() => { /* best-effort */ });
  } catch { /* best-effort — never block boot */ }
}

function readCortexStore(cwd: string): { v: 1; entries: unknown[] } {
  try {
    const p = join(cwd, ".mneme", "cortex", "store.json");
    if (!existsSync(p)) return { v: 1, entries: [] };
    const j = JSON.parse(readFileSync(p, "utf8"));
    return j && Array.isArray(j.entries) ? j : { v: 1, entries: [] };
  } catch { return { v: 1, entries: [] }; }
}

function recallFacts(cwd: string, task?: string): { key: string; value: string }[] {
  try {
    if (!task) return [];
    const hits = cortex.recall(readCortexStore(cwd) as never, task, 8);
    return hits.map((h) => ({ key: h.entry.key, value: h.entry.value }));
  } catch { return []; }
}

export function registerBootCommands(program: Command): void {
  program
    .command("boot")
    .description("⚡ ACTIVATION CORTEX — the session-start handshake: confirms Mneme is connected + returns the task→tool decision table (WHEN to use which Mneme tool) + cortex recall. Fire it FIRST.")
    .option("--task <t>", "the task at hand (ranks the decision table + recalls relevant shared memory).")
    .option("--json", "full signed packet as JSON.")
    .option("--hook", "emit the activation CONTEXT a SessionStart hook injects into the agent.")
    .option("--nudge", "emit a compact ONE-LINE per-turn reminder (for a UserPromptSubmit hook).")
    .option("--emit-hook-config", "print the .claude/settings.json SessionStart + UserPromptSubmit hook snippet (opt-in).")
    .action((opts: { task?: string; json?: boolean; hook?: boolean; nudge?: boolean; emitHookConfig?: boolean }) => {
      const cwd = process.cwd();
      const version = getVersion();

      if (opts.nudge) {
        // UserPromptSubmit hook stdout — injected EVERY turn, so keep it ONE line
        // + cheap (no fs, no signing). A standing reminder, not the full table.
        out(`<mneme v="${version}"> Reach for Mneme this turn when it fits: verify a checkable claim → mneme.truth.check · read untrusted/3rd-party content → mneme.firewall.fortify · inherit shared memory before deriving → mneme.cortex.recall · gate a destructive shell command → mneme.heph.cross · send code to a model → mneme.rail (blind secrets). Signals, not commands. </mneme>`);
        return;
      }

      if (opts.emitHookConfig) {
        const bin = process.env["MNEME_CLI_BIN"] ?? "mneme";
        const cfg = {
          hooks: {
            SessionStart: [{ hooks: [
              { type: "command", command: `${bin} boot --hook`, timeout: 10 },
              { type: "command", command: `${bin} matrix ensure`, timeout: 10 },
            ] }],
            UserPromptSubmit: [{ hooks: [{ type: "command", command: `${bin} boot --nudge`, timeout: 10 }] }],
          },
        };
        out(JSON.stringify(cfg, null, 2));
        process.stderr.write(`\n# Paste into .claude/settings.json (merge with existing hooks). SessionStart→\`${bin} boot --hook\` injects the full activation table once; UserPromptSubmit→\`${bin} boot --nudge\` re-reminds the agent every turn. Opt-in — Mneme never installs a hook for you.\n`);
        return;
      }

      // Reached only on a REAL activation (--nudge + --emit-hook-config returned above):
      // bring the Matrix Rail up so the full tool surface is reachable over gRPC the
      // instant any agent activates Mneme — hands-free, no user command, anti-worm-safe.
      autoEnsureMatrix(cwd);

      const packet = boot.buildBootPacket({
        version,
        healthy: true,
        ...(opts.task ? { task: opts.task, cortexFacts: recallFacts(cwd, opts.task) } : {}),
      });

      if (opts.hook) {
        // SessionStart hook stdout is injected into the agent's context.
        out(`<mneme-activation v="${version}">`);
        out(packet.instructions);
        if (packet.cortexFacts.length) {
          out(`\nShared memory relevant now:`);
          for (const f of packet.cortexFacts) out(`• ${f.key}: ${f.value}`);
        }
        out(`</mneme-activation>`);
        return;
      }

      if (opts.json) {
        const receipt = notary.issueReceipt(cwd, { kind: "claim-verdict", subject: "boot", payload: { version, rows: packet.decisionTable.length }, includePayload: true });
        out(JSON.stringify({ ...packet, receipt }, null, 2));
        return;
      }

      // human-readable digest
      out(`⚡ ${packet.installCheck}`);
      out(``);
      out(`Boundaries:`);
      out(`  ${packet.capabilities.inbound}`);
      out(`  ${packet.capabilities.outbound}`);
      out(`  ${packet.capabilities.memory}`);
      out(`  ${packet.capabilities.token}`);
      out(``);
      out(`When to reach for Mneme (signals, not commands):`);
      for (const r of packet.decisionTable) out(`  • ${r.when}\n      → ${r.tool}\n        (${r.why})`);
      if (packet.cortexFacts.length) {
        out(``);
        out(`Shared memory relevant to "${opts.task}":`);
        for (const f of packet.cortexFacts) out(`  • ${f.key}: ${f.value}`);
      }
      out(``);
      out(`# ${packet.note}`);
      out(`# Reliable auto-activation: mneme boot --emit-hook-config  (opt-in SessionStart hook)`);
    });
}
