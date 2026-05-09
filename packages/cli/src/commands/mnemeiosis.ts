/**
 * MneMeiosis CLI — Mode 2 manual control mirror of the MCP tool surface.
 *
 * Top-level commands:
 *   mneme welcome                                  — install handoff (mirror of mneme.welcome)
 *   mneme spore <init|push|pull|sync|status>       — cross-machine sync
 *   mneme lin <status|on|off|crystallize|...>      — MneMeiosis core
 *
 * All commands accept --json for machine-readable output (parity with
 * existing CLI conventions).
 */

import type { Command } from "commander";
import { lineage, nucleusDaemon, nucleus } from "@mneme-ai/core";
import { spawn } from "node:child_process";

function writeJson(payload: unknown): void {
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
}

function writeText(line: string): void {
  process.stdout.write(line + "\n");
}

interface CommonOpts {
  json?: boolean;
}

function out(opts: CommonOpts, jsonPayload: unknown, humanLines: string[]): void {
  if (opts.json) {
    writeJson(jsonPayload);
  } else {
    for (const line of humanLines) writeText(line);
  }
}

// ─── mneme welcome ────────────────────────────────────────────────────

export function registerWelcomeCommand(program: Command): void {
  program
    .command("welcome")
    .description("Show the install handoff: what's auto-enabled + how to opt out (mirror of mneme.welcome MCP tool).")
    .option("--json", "Machine-readable output.")
    .action(async (opts: CommonOpts) => {
      const version = process.env["npm_package_version"] ?? "1.19.0";
      const w = lineage.buildWelcome(process.cwd(), version);
      lineage.markWelcomeShown(process.cwd(), version);
      out(opts, w, [
        `Mneme v${version} ${w.freshInstall ? "— fresh install" : "— welcome back"}`,
        "",
        w.userMessageTemplate,
        "",
        "Auto-enabled features:",
        ...Object.entries(w.autoEnabled).flatMap(([name, def]) => [
          `  ${name}: ${def.enabled ? "ON" : "OFF"}`,
          ...def.defaultsApplied.map((d) => `    • ${d}`),
        ]),
        "",
        "Next: mneme.capabilities · mneme lin status · mneme spore status",
      ]);
    });
}

// ─── mneme spore ──────────────────────────────────────────────────────

export function registerSporeCommands(program: Command): void {
  const spore = program.command("spore").description("Cross-machine lineage sync (git-backed).");

  spore
    .command("init")
    .description("Initialize cross-machine sync. Auto-detects git origin if no --remote.")
    .option("--remote <url>", "Git remote URL (defaults to repo's origin).")
    .option("--branch <name>", "Branch name (default: mneme-lineage).")
    .option("--json", "JSON output.")
    .action(async (opts: { remote?: string; branch?: string } & CommonOpts) => {
      const r = lineage.sporeInit(process.cwd(), { remote: opts.remote, branch: opts.branch });
      out(opts, r, [r.ok ? `✓ Spore initialized — remote ${r.remote!.url} · branch ${r.remote!.branch}` : `✗ ${r.reason}`]);
    });

  spore
    .command("push")
    .description("Push local lineage to the configured remote.")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const machineId = lineage.machineFingerprint(process.cwd());
      const r = lineage.sporePush(process.cwd(), machineId);
      out(opts, r, [r.ok ? `✓ Pushed ${r.pushedFiles} chromosome${r.pushedFiles === 1 ? "" : "s"} (${r.message})` : `${r.dryRun ? "⚠" : "✗"} ${r.message}`]);
    });

  spore
    .command("pull")
    .description("Pull lineage updates from the configured remote.")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const r = lineage.sporePull(process.cwd());
      out(opts, r, [r.ok ? `✓ Pulled ${r.newChromosomes} new chromosome${r.newChromosomes === 1 ? "" : "s"}` : `${r.dryRun ? "⚠" : "✗"} ${r.message}`]);
    });

  spore
    .command("sync")
    .description("Push + pull in one operation.")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const machineId = lineage.machineFingerprint(process.cwd());
      const push = lineage.sporePush(process.cwd(), machineId);
      const pull = lineage.sporePull(process.cwd());
      out(opts, { push, pull }, [
        `Push: ${push.ok ? "✓" : push.dryRun ? "⚠ dry-run" : "✗"} ${push.message}`,
        `Pull: ${pull.ok ? "✓" : pull.dryRun ? "⚠ dry-run" : "✗"} ${pull.message}`,
      ]);
    });

  spore
    .command("status")
    .description("Report cross-machine sync state in plain English.")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const s = lineage.sporeStatus(process.cwd());
      const clockEntries = Object.entries(s.vectorClock);
      out(opts, s, [
        s.configured
          ? `Sync to git: configured ✓ → branch '${s.remote?.branch}' on ${s.remote?.url}`
          : `Sync to git: not configured yet → run \`mneme spore init\` to enable cross-machine inheritance`,
        s.localChromosomeCount > 0
          ? `Local sessions saved: ${s.localChromosomeCount} chromosome${s.localChromosomeCount === 1 ? "" : "s"}`
          : `Local sessions saved: 0 → none captured yet (need MCP-connected AI; run \`mneme mcp --install\`)`,
        s.identityReady
          ? `Identity: ready ✓ (cryptographic ID generated, signs every chromosome before push)`
          : `Identity: not yet generated (will auto-create on first chromosome write)`,
        clockEntries.length === 0
          ? `Causality clock: empty (will track who-saw-what across your machines)`
          : `Causality clock: ${clockEntries.map(([m, n]) => `${m}=${n}`).join(", ")}`,
      ]);
    });
}

// ─── mneme lin (MneMeiosis core) ──────────────────────────────────────

const LINEAGE_SCHEMA_VERSION = 1;

export function registerLinCommands(program: Command): void {
  const lin = program.command("lin").description("MneMeiosis Lineage — session inheritance across AI agents and machines.");

  lin
    .command("version")
    .description("Print the lineage schema version (relevant for cross-machine pull compatibility).")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const data = { schemaVersion: LINEAGE_SCHEMA_VERSION, mnemeVersion: process.env["npm_package_version"] ?? "unknown" };
      out(opts, data, [
        `Lineage schema version: ${LINEAGE_SCHEMA_VERSION}`,
        `Mneme version: ${data.mnemeVersion}`,
        ``,
        `Cross-machine compatibility: same schemaVersion required to merge.`,
        `Future schema bumps will ship a migration path via \`mneme lin migrate\`.`,
      ]);
    });

  lin
    .command("status")
    .description("Lineage state: identity, chromosome count, head, top vendor, spore.")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const settings = lineage.readSettings(process.cwd());
      const ids = lineage.listChromosomes(process.cwd());
      const tree = lineage.readTree(process.cwd());
      const identity = lineage.loadOrCreateIdentity(process.cwd());
      const spore = lineage.sporeStatus(process.cwd());
      const ped = ids.length > 0 ? lineage.buildPedigree(process.cwd()) : null;
      const data = {
        optedOut: settings.optedOut,
        identity: identity.fingerprint,
        chromosomes: ids.length,
        head: tree.head,
        topVendor: ped?.vendors[0]?.vendor ?? null,
        spore,
      };
      // v1.20.0 — when chromosomes=0, the user might be running CLI standalone
      // without MCP. Point them to the right path so Mneme actually starts
      // capturing context.
      const empty = ids.length === 0 && !settings.optedOut;
      out(opts, data, [
        `Lineage: ${settings.optedOut ? "OPTED OUT" : "active"}`,
        `Identity fingerprint: ${identity.fingerprint}`,
        `Chromosomes on disk: ${ids.length}`,
        tree.head ? `Head: ${tree.head}` : "",
        ped?.vendors[0] ? `Top vendor: ${ped.vendors[0].vendor} (karma ${ped.vendors[0].totalKarma})` : "",
        `Spore: ${spore.configured ? `configured (${spore.remote?.url})` : "local-only"}`,
        ...(empty ? [
          "",
          "⚠ Lineage is empty — chromosomes only get written when an AI agent",
          "  uses Mneme via MCP. To start capturing context:",
          "    1. Run `mneme mcp --install` (auto-configs Claude Code/Cursor/Continue)",
          "    2. Restart your AI tool",
          "    3. Ask the AI: 'call mneme.welcome'",
          "  Then come back to this CLI to see chromosomes appear.",
        ] : []),
      ].filter(Boolean));
    });

  lin
    .command("on")
    .description("Enable lineage (default).")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const s = lineage.setLineageOptedOut(process.cwd(), false);
      out(opts, s, ["✓ Lineage enabled."]);
    });

  lin
    .command("off")
    .description("Disable lineage — no chromosomes will be written.")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const s = lineage.setLineageOptedOut(process.cwd(), true);
      out(opts, s, ["⚠ Lineage disabled. Future sessions will not crystallize."]);
    });

  lin
    .command("crystallize")
    .description("Manually checkpoint the current session (no-op when no MCP server is running).")
    .option("--topic <s>", "Optional topic label.")
    .option("--json", "JSON output.")
    .action(async (opts: { topic?: string } & CommonOpts) => {
      const r = lineage.crystallize(process.cwd(), { endReason: "manual", topic: opts.topic });
      if (!r) {
        out(opts, { error: "no active session" }, ["⚠ No active MCP session — nothing to crystallize."]);
        return;
      }
      lineage.addToTree(process.cwd(), r.chromosome);
      out(opts, r, [`✓ Crystallized ${r.chromosome.id} (${r.bytes} bytes, ${r.durationMs}ms).`]);
    });

  lin
    .command("fertilize")
    .description("Compute the inheritance bundle from recent ancestors (preview).")
    .option("--top <n>", "How many ancestors (default 3).", parseIntStr)
    .option("--json", "JSON output.")
    .action(async (opts: { top?: number } & CommonOpts) => {
      const b = lineage.fertilize(process.cwd(), { topN: opts.top ?? 3 });
      if (!b) {
        out(opts, { empty: true }, ["No lineage to inherit — fresh repo."]);
        return;
      }
      out(opts, b, [
        `Inherited from ${b.sourceIds.length} ancestor${b.sourceIds.length === 1 ? "" : "s"}:`,
        ...b.sourceIds.map((id) => `  • ${id}`),
        `Vendors: ${b.vendors.join(", ")}`,
        `Atoms inherited: ${b.inheritedAtomCount}`,
        `Top molecules: ${b.topMolecules.slice(0, 3).map((m) => m.name).join(", ")}`,
        `Lethal recessives: ${b.lethalRecessives.length}`,
        "",
        b.narrative,
      ]);
    });

  lin
    .command("ancestors")
    .description("List the most recent N chromosomes (one per AI session).")
    .option("--limit <n>", "How many to list (default 10).", parseIntStr)
    .option("--json", "JSON output.")
    .action(async (opts: { limit?: number } & CommonOpts) => {
      const limit = opts.limit ?? 10;
      const ids = lineage.listChromosomes(process.cwd()).slice(0, Math.max(1, limit));
      const items = ids.map((id) => {
        try {
          const c = lineage.loadChromosome(process.cwd(), id);
          return { id: c.id, vendor: c.vendor, topic: c.topic, createdAt: c.createdAt, atomCount: Object.keys(c.atomKarmaDeltas).length };
        } catch (e) {
          return { id, error: (e as Error).message };
        }
      });
      out(opts, items, items.length === 0 ? [
        "Lineage is empty — no chromosomes yet.",
        "",
        "Each chromosome is a saved AI session. They appear when:",
        "  1. You install Mneme as an MCP server: `mneme mcp --install`",
        "  2. Restart your AI tool (Claude Code / Cursor / Continue)",
        "  3. Talk to your AI normally — every session auto-saves on exit",
        "",
        "Quick demo without MCP setup: `mneme demo` (synthesizes 3 sample chromosomes)",
      ] : items.map((i) => "vendor" in i ? `  ${i.createdAt} · ${i.vendor} · "${i.topic}" · ${i.atomCount} atoms · ${i.id}` : `  [error] ${i.id}: ${i.error}`));
    });

  lin
    .command("show <id>")
    .description("Open one chromosome by ID.")
    .option("--json", "JSON output.")
    .action(async (id: string, opts: CommonOpts) => {
      try {
        const c = lineage.loadChromosome(process.cwd(), id);
        const v = lineage.verifyChromosome(c);
        out(opts, { chromosome: c, verified: v.valid, reason: v.reason }, [
          `Chromosome ${c.id}`,
          `Vendor: ${c.vendor}`,
          `Created: ${c.createdAt}`,
          `Topic: ${c.topic}`,
          `Total calls: ${c.session.totalCalls}`,
          `Atoms: ${Object.keys(c.atomKarmaDeltas).length}`,
          `Molecules: ${c.molecules.length}`,
          `Verified: ${v.valid ? "yes" : `NO (${v.reason})`}`,
        ]);
      } catch (e) {
        out(opts, { error: (e as Error).message }, [`✗ ${(e as Error).message}`]);
      }
    });

  lin
    .command("species")
    .description("Detect speciation events in the lineage.")
    .option("--threshold <n>", "Jaccard threshold (default 0.7).", parseFloatStr)
    .option("--window <n>", "Window size (default 5).", parseIntStr)
    .option("--json", "JSON output.")
    .action(async (opts: { threshold?: number; window?: number } & CommonOpts) => {
      const events = lineage.detectSpeciation(process.cwd(), { threshold: opts.threshold, windowSize: opts.window });
      out(opts, events, events.length === 0 ? ["No speciation events."] : events.map((e) => `  ${e.detectedAt} · mean distance ${e.meanDistance} · labels ${e.suggestedLabels.join(", ")}`));
    });

  lin
    .command("pedigree")
    .description("Cross-AI family tree — per-vendor stats (which AI vendor shipped which molecule).")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const p = lineage.buildPedigree(process.cwd());
      out(opts, p, [
        `Total chromosomes: ${p.totalChromosomes}`,
        p.vendors.length === 0
          ? `Vendors: (none yet — chromosomes appear once an MCP-connected AI talks to Mneme)`
          : `Vendors:`,
        ...p.vendors.map((v) => `  ${v.vendor} · ${v.chromosomeCount} chromosomes · karma ${v.totalKarma} · verified ${(v.verifiedRate * 100).toFixed(0)}%`),
      ]);
    });

  lin
    .command("routing-hint <query...>")
    .description("Recommend the best AI vendor for a free-text query.")
    .option("--json", "JSON output.")
    .action(async (queryParts: string[], opts: CommonOpts) => {
      const query = queryParts.join(" ");
      const r = lineage.routingHint(process.cwd(), query);
      out(opts, r, [r.vendor ? `Recommended: ${r.vendor} (score ${r.score}) — ${r.reason}` : `No recommendation — ${r.reason}`]);
    });

  lin
    .command("lethal")
    .description("List atoms culled from inheritance (hallucination-flagged).")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const ids = lineage.listChromosomes(process.cwd());
      const all = new Set<string>();
      for (const id of ids) {
        try { for (const a of lineage.loadChromosome(process.cwd(), id).lethalRecessives) all.add(a); } catch { /* skip */ }
      }
      const list = [...all].sort();
      out(opts, list, list.length === 0 ? ["No lethal-recessive atoms."] : list.map((a) => `  • ${a}`));
    });

  lin
    .command("purge")
    .description("Wipe ALL lineage data (chromosomes + tree + identity + spore). Requires --confirm.")
    .option("--confirm", "Required to actually purge.")
    .option("--json", "JSON output.")
    .action(async (opts: { confirm?: boolean } & CommonOpts) => {
      if (!opts.confirm) {
        out(opts, { error: "missing --confirm" }, ["⚠ Refusing to purge without --confirm."]);
        return;
      }
      const { rmSync } = await import("node:fs");
      try {
        rmSync(lineage.lineageRoot(process.cwd()), { recursive: true, force: true });
        out(opts, { ok: true }, ["✓ Lineage purged."]);
      } catch (e) {
        out(opts, { error: (e as Error).message }, [`✗ ${(e as Error).message}`]);
      }
    });
}

function parseIntStr(s: string): number {
  const n = parseInt(s, 10);
  if (Number.isNaN(n)) throw new Error(`invalid integer: ${s}`);
  return n;
}

function parseFloatStr(s: string): number {
  const n = parseFloat(s);
  if (Number.isNaN(n)) throw new Error(`invalid number: ${s}`);
  return n;
}

// ─── mneme nucleus daemon ─────────────────────────────────────────────

export function registerNucleusCommands(program: Command): void {
  const nuc = program.command("nucleus").description("Infinity Wisdom Brain — persistent loop that grows DNA across sessions.");

  nuc
    .command("daemon")
    .description("Start the persistent nucleus daemon (foreground). Use --detach to fork into background.")
    .option("--detach", "Spawn a detached background process and return immediately.")
    .option("--interval <ms>", "Tick interval in ms (default 30000).", parseIntStr)
    .option("--json", "JSON output.")
    .action(async (opts: { detach?: boolean; interval?: number } & CommonOpts) => {
      const repoRoot = process.cwd();
      const status = nucleusDaemon.daemonStatus(repoRoot);
      if (status.running) {
        out(opts, status, [`⚠ Nucleus daemon already running (pid ${status.pid}) — last tick ${status.lastTickSecondsAgo}s ago.`]);
        return;
      }
      if (opts.detach) {
        // Re-spawn ourselves with --no-detach so the child runs the loop.
        const argv = process.argv;
        const node = process.execPath;
        const script = argv[1] ?? "";
        const child = spawn(node, [script, "nucleus", "daemon", ...(opts.interval ? ["--interval", String(opts.interval)] : [])], {
          detached: true,
          stdio: "ignore",
          cwd: repoRoot,
        });
        child.unref();
        out(opts, { spawned: true, pid: child.pid }, [`✓ Spawned detached nucleus daemon (pid ${child.pid}).`, `  Heartbeat: \`mneme nucleus status\` or \`mneme.nucleus.heartbeat\` via MCP.`]);
        return;
      }
      out(opts, { starting: true }, [`Starting nucleus daemon (foreground)... Ctrl+C to stop.`]);
      try {
        await nucleusDaemon.runDaemonLoop(repoRoot, {
          intervalMs: opts.interval,
          onTick: ({ tickCount, banner }) => {
            if (!opts.json) process.stderr.write(`[tick ${tickCount}] ${banner}\n`);
          },
        });
      } catch (e) {
        out(opts, { error: (e as Error).message }, [`✗ ${(e as Error).message}`]);
      }
    });

  nuc
    .command("stop")
    .description("Stop the running nucleus daemon (sends SIGTERM).")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const r = nucleusDaemon.stopDaemon(process.cwd());
      out(opts, r, [r.stopped ? `✓ Stopped nucleus daemon (pid ${r.pid}).` : `⚠ ${r.reason}`]);
    });

  nuc
    .command("status")
    .description("Show nucleus daemon status (pid + uptime + last tick + DNA banner).")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const status = nucleusDaemon.daemonStatus(process.cwd());
      const dna = nucleus.readNucleus(process.cwd());
      out(opts, { ...status, nucleus: dna }, [
        `Daemon: ${status.running ? `RUNNING (pid ${status.pid})` : "stopped"}`,
        status.heartbeat ? `Last tick: ${status.lastTickSecondsAgo}s ago` : "",
        status.heartbeat ? `Tick count: ${status.heartbeat.tickCount}` : "",
        status.heartbeat ? `Mutations applied: ${status.heartbeat.mutationsApplied}` : "",
        `DNA: ${nucleus.dnaBanner(dna)}`,
        status.healthy ? `✓ healthy` : status.running ? `⚠ heartbeat stale` : "",
      ].filter(Boolean));
    });

  nuc
    .command("dna")
    .description("Read the current DNA snapshot (tick / hash / wisdom score / lessons).")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const n = nucleus.readNucleus(process.cwd());
      out(opts, n, [
        nucleus.dnaBanner(n),
        "",
        `Last 5 lessons:`,
        ...n.lessons.slice(-5).reverse().map((l) => `  • [tick ${l.tick}] ${l.text}`),
      ]);
    });
}
