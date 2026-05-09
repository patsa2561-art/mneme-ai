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
import { lineage, nucleusDaemon, nucleus, inbox, lineageSeed } from "@mneme-ai/core";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, statSync, watch, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { platform, homedir } from "node:os";

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
      const root = process.cwd();
      const status = nucleusDaemon.daemonStatus(root);
      const dna = nucleus.readNucleus(root);
      const mnemeDir = join(root, ".mneme");
      const lines = [
        `Daemon: ${status.running ? `RUNNING (pid ${status.pid})` : "stopped"}`,
        status.heartbeat ? `Last tick: ${status.lastTickSecondsAgo}s ago` : "",
        status.heartbeat ? `Tick count: ${status.heartbeat.tickCount}` : "",
        status.heartbeat ? `Mutations applied: ${status.heartbeat.mutationsApplied}` : "",
        `DNA: ${nucleus.dnaBanner(dna)}`,
        // v1.23.0 — explain wisdomScore=0 instead of leaving it cryptic
        dna.wisdomScore === 0
          ? `  (wisdom = 0 because no MCP-connected AI has fed the nucleus yet — install MCP via \`mneme mcp --install\`, restart your AI tool, then ask it: "call mneme.welcome")`
          : "",
        // v1.23.0 — show where state lives so users can tail logs / inspect files
        `Storage: ${mnemeDir}`,
        status.healthy ? `✓ healthy` : status.running ? `⚠ heartbeat stale` : "",
      ].filter(Boolean);
      out(opts, { ...status, nucleus: dna, storagePath: mnemeDir }, lines);
    });

  nuc
    .command("dna")
    .description("Read the current DNA snapshot (tick / hash / wisdom score / lessons).")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const n = nucleus.readNucleus(process.cwd());
      // v1.23.0 — show empty-state hint instead of a bare header with nothing under it.
      const lessonLines =
        n.lessons.length === 0
          ? [`  (none yet — connect Mneme via MCP and let an AI agent call mneme.nucleus.tick to generate lessons)`]
          : n.lessons.slice(-5).reverse().map((l) => `  • [tick ${l.tick}] ${l.text}`);
      out(opts, n, [
        nucleus.dnaBanner(n),
        "",
        `Last 5 lessons:`,
        ...lessonLines,
      ]);
    });

  // ─── mneme nucleus tail (v1.23.0) ────────────────────────────────────
  nuc
    .command("tail")
    .description("Stream the nucleus heartbeat (live tail of .mneme/nucleus.heartbeat.json — like `tail -f`).")
    .option("--once", "Print the current heartbeat and exit (no follow).")
    .option("--json", "JSON output.")
    .action(async (opts: { once?: boolean } & CommonOpts) => {
      const root = process.cwd();
      const path = join(root, ".mneme", "nucleus.heartbeat.json");
      function emit(): void {
        const hb = nucleusDaemon.readHeartbeat(root);
        if (!hb) {
          out(opts, { heartbeat: null }, [`(no heartbeat yet — start the daemon with \`mneme nucleus daemon --detach\`)`]);
          return;
        }
        if (opts.json) writeJson(hb);
        else writeText(`[${hb.lastTick}] tick=${hb.tickCount} mutations=${hb.mutationsApplied} · ${hb.lastBanner}`);
      }
      emit();
      if (opts.once) return;
      if (!existsSync(path)) {
        writeText(`(waiting for heartbeat at ${path}…)`);
      }
      // Best-effort fs.watch — falls back to polling if not supported on the FS.
      let lastMtime = 0;
      try {
        if (existsSync(path)) lastMtime = statSync(path).mtimeMs;
        const w = watch(join(root, ".mneme"), { persistent: true }, (_evt, file) => {
          if (file === "nucleus.heartbeat.json" && existsSync(path)) {
            const m = statSync(path).mtimeMs;
            if (m !== lastMtime) {
              lastMtime = m;
              emit();
            }
          }
        });
        process.on("SIGINT", () => { w.close(); process.exit(0); });
      } catch {
        // poll fallback — every 1s
        setInterval(() => {
          if (!existsSync(path)) return;
          const m = statSync(path).mtimeMs;
          if (m !== lastMtime) {
            lastMtime = m;
            emit();
          }
        }, 1000);
      }
    });

  // mneme nucleus seed --demo (v1.23.0; --auto-start --watch in v1.23.2)
  nuc
    .command("seed")
    .description("Plant synthetic seed chromosomes so the daemon has something to aggregate (great for instant wow + offline demos).")
    .option("--demo", "Plant the 3-vendor synthetic lineage (claude / cursor / codex).")
    .option("--force", "Re-plant even if synthetic seeds already exist.")
    .option("--auto-start", "After seeding, spawn the nucleus daemon detached so it ticks immediately.")
    .option("--watch", "Tail the heartbeat in this terminal until Ctrl+C (implies --auto-start).")
    .option("--json", "JSON output.")
    .action(async (opts: { demo?: boolean; force?: boolean; autoStart?: boolean; watch?: boolean } & CommonOpts) => {
      const root = process.cwd();
      if (!opts.demo) {
        out(opts, { hint: "use --demo" }, [`Pass --demo to plant 3 synthetic seed chromosomes (different AI vendors).`]);
        return;
      }
      const r = lineageSeed.synthesizeSeedLineage(root, { force: !!opts.force });
      const seedLines = [
        `OK Planted ${r.created} synthetic chromosome${r.created === 1 ? "" : "s"} (vendors: ${r.vendors.join(", ")})`,
        r.created === 0 ? `  (already seeded -- pass --force to re-plant)` : `  Karma streak history seeded too: 18 verified, achievements unlocked.`,
      ];
      if (!opts.autoStart && !opts.watch) {
        out(opts, r, [...seedLines, `  Next: \`mneme nucleus seed --demo --auto-start --watch\` to spawn daemon + tail in one shot.`]);
        return;
      }
      // auto-start: spawn detached daemon
      const status = nucleusDaemon.daemonStatus(root);
      let spawnedPid: number | null = null;
      if (status.running) {
        seedLines.push(`  Daemon already running (pid ${status.pid}).`);
      } else {
        const argv = process.argv;
        const node = process.execPath;
        const script = argv[1] ?? "";
        const child = spawn(node, [script, "nucleus", "daemon"], {
          detached: true,
          stdio: "ignore",
          cwd: root,
        });
        child.unref();
        spawnedPid = child.pid ?? null;
        seedLines.push(`  Spawned detached nucleus daemon (pid ${spawnedPid}).`);
      }
      if (opts.json) {
        writeJson({ ...r, spawnedPid, watchMode: !!opts.watch });
        return;
      }
      for (const line of seedLines) writeText(line);
      if (!opts.watch) return;
      writeText("");
      writeText(`Watching .mneme/nucleus.heartbeat.json -- Ctrl+C to stop.`);
      const path = join(root, ".mneme", "nucleus.heartbeat.json");
      let lastMtime = 0;
      let lastTick = -1;
      let lastLessonCount = nucleus.readNucleus(root).lessons.length;
      let lastMutations = -1;
      function emitHeartbeat(): void {
        const hb = nucleusDaemon.readHeartbeat(root);
        if (!hb) return;
        if (hb.tickCount === lastTick) return;
        lastTick = hb.tickCount;
        const dna = nucleus.readNucleus(root);
        // v1.23.3 — only show "+ lesson" when a NEW lesson was added this
        // tick. Previous version printed the LATEST lesson every tick,
        // which made stable nuclei look like they were repeating the same
        // event over and over. Same for mutations.
        const newLessons = dna.lessons.length - lastLessonCount;
        const newMutations = lastMutations >= 0 ? hb.mutationsApplied - lastMutations : 0;
        lastLessonCount = dna.lessons.length;
        lastMutations = hb.mutationsApplied;
        const tags: string[] = [];
        if (newLessons > 0) {
          const last = dna.lessons[dna.lessons.length - 1];
          tags.push(`NEW LESSON: ${last?.text ?? ""}`);
        }
        if (newMutations > 0) {
          tags.push(`+${newMutations} mutation${newMutations === 1 ? "" : "s"} (DNA evolved)`);
        }
        const tagSuffix = tags.length > 0 ? "  >> " + tags.join(" | ") : "";
        writeText(`[tick ${hb.tickCount}] wisdom=${dna.wisdomScore} mutations=${hb.mutationsApplied}${tagSuffix}`);
      }
      try {
        if (existsSync(path)) lastMtime = statSync(path).mtimeMs;
        emitHeartbeat();
        const w = watch(join(root, ".mneme"), { persistent: true }, (_evt, file) => {
          if (file === "nucleus.heartbeat.json" && existsSync(path)) {
            const m = statSync(path).mtimeMs;
            if (m !== lastMtime) {
              lastMtime = m;
              emitHeartbeat();
            }
          }
        });
        process.on("SIGINT", () => { w.close(); process.exit(0); });
        await new Promise<void>(() => { /* hold forever; SIGINT exits */ });
      } catch (e) {
        writeText(`(watch error: ${(e as Error).message} -- daemon still running detached)`);
      }
    });

  // ─── mneme nucleus install --as-service (v1.23.0) ────────────────────
  nuc
    .command("install")
    .description("Install the nucleus daemon as a background service (Windows Task Scheduler / Linux systemd / macOS launchd).")
    .option("--as-service", "Generate + install the platform-native service unit.")
    .option("--uninstall", "Remove the previously-installed service.")
    .option("--print", "Print the unit file to stdout instead of installing.")
    .option("--json", "JSON output.")
    .action(async (opts: { asService?: boolean; uninstall?: boolean; print?: boolean } & CommonOpts) => {
      const root = process.cwd();
      const result = installAsService({ root, uninstall: !!opts.uninstall, print: !!opts.print });
      out(opts, result, result.lines);
    });
}

// ─── mneme inbox (v1.23.0 — RLHF Force-Push channel) ────────────────────

export function registerInboxCommands(program: Command): void {
  const ib = program.command("inbox").description("Mneme's force-push channel — daemon + version-check + achievement notices waiting to surface to the user.");

  ib
    .command("list")
    .description("List every inbox message (sent + unsent).")
    .option("--unsent", "Show only unsent messages.")
    .option("--json", "JSON output.")
    .action(async (opts: { unsent?: boolean } & CommonOpts) => {
      const root = process.cwd();
      const all = inbox.readInbox(root);
      const filtered = opts.unsent ? all.filter((m) => !m.sent) : all;
      if (opts.json) {
        writeJson({ total: all.length, unsent: all.filter((m) => !m.sent).length, messages: filtered });
        return;
      }
      if (filtered.length === 0) {
        writeText(`Inbox is empty${opts.unsent ? " (no unsent messages)" : ""}.`);
        return;
      }
      writeText(`Inbox · ${all.length} total · ${all.filter((m) => !m.sent).length} unsent`);
      for (const m of filtered) {
        const flag = m.sent ? "✓" : "•";
        const glyph = m.priority === "critical" ? "🚨" : m.priority === "high" ? "📢" : m.priority === "medium" ? "🔔" : "💬";
        writeText(`  ${flag} ${glyph} [${m.source}] ${m.title}${m.body ? ` — ${m.body}` : ""}`);
        if (m.cta) writeText(`      → ${m.cta}`);
      }
    });

  ib
    .command("push <title>")
    .description("Push a message into the inbox (will surface on the next MCP tool dispatch).")
    .option("--body <text>", "Optional one-line body.")
    .option("--cta <text>", "Optional call-to-action.")
    .option("--priority <p>", "low | medium | high | critical (default medium).", "medium")
    .option("--source <name>", "Source tag (default 'manual').", "manual")
    .option("--json", "JSON output.")
    .action(async (title: string, opts: { body?: string; cta?: string; priority?: string; source?: string } & CommonOpts) => {
      const pri = (opts.priority ?? "medium") as "low" | "medium" | "high" | "critical";
      const msg = inbox.pushInbox(process.cwd(), {
        title,
        body: opts.body,
        cta: opts.cta,
        priority: pri,
        source: opts.source ?? "manual",
      });
      out(opts, msg, [`✓ Queued "${msg.title}" (id ${msg.id}, ${msg.priority}).`]);
    });
}

// ─── nucleus install --as-service helper ────────────────────────────────

interface ServiceResult {
  platform: string;
  installed: boolean;
  printedUnit?: string;
  unitPath?: string;
  lines: string[];
}

function installAsService(opts: { root: string; uninstall: boolean; print: boolean }): ServiceResult {
  const plat = platform();
  const cwd = opts.root;
  const node = process.execPath;
  const script = process.argv[1] ?? "mneme";

  if (plat === "win32") {
    // Windows — use schtasks. Generate an XML or just a `schtasks /create` invocation.
    const taskName = "MnemeNucleusDaemon";
    if (opts.uninstall) {
      const out1 = spawnSyncPowershell(`schtasks /Delete /TN "${taskName}" /F`);
      return { platform: "windows", installed: !out1.err, lines: [out1.err ? `✗ ${out1.err}` : `✓ Uninstalled scheduled task ${taskName}.`] };
    }
    const cmd = `schtasks /Create /SC ONLOGON /RL HIGHEST /TN "${taskName}" /TR "\\"${node}\\" \\"${script}\\" nucleus daemon" /F`;
    if (opts.print) {
      return { platform: "windows", installed: false, printedUnit: cmd, lines: [`# Run as Administrator to install:`, cmd] };
    }
    const result = spawnSyncPowershell(cmd);
    return {
      platform: "windows",
      installed: !result.err,
      lines: result.err
        ? [`✗ schtasks failed: ${result.err}`, `  (run from an elevated PowerShell, or pass --print to see the command)`]
        : [`✓ Installed Windows scheduled task "${taskName}" — runs at logon.`, `  Inspect: schtasks /Query /TN "${taskName}"`],
    };
  }

  if (plat === "linux") {
    // systemd user-unit
    const userDir = join(homedir(), ".config", "systemd", "user");
    const unitName = "mneme-nucleus.service";
    const unitPath = join(userDir, unitName);
    if (opts.uninstall) {
      try {
        if (existsSync(unitPath)) {
          spawnSyncPowershell(`systemctl --user stop ${unitName}; systemctl --user disable ${unitName}`);
        }
        return { platform: "linux", installed: false, unitPath, lines: [`✓ Disabled + stopped ${unitName}.`] };
      } catch (e) {
        return { platform: "linux", installed: false, unitPath, lines: [`✗ ${(e as Error).message}`] };
      }
    }
    const unit = `[Unit]
Description=Mneme Nucleus Infinity Wisdom Brain (per-user)
After=network.target

[Service]
Type=simple
WorkingDirectory=${cwd}
ExecStart=${node} ${script} nucleus daemon
Restart=on-failure
RestartSec=15

[Install]
WantedBy=default.target
`;
    if (opts.print) {
      return { platform: "linux", installed: false, printedUnit: unit, lines: [`# Save to ${unitPath} then run:`, `# systemctl --user daemon-reload && systemctl --user enable --now ${unitName}`, unit] };
    }
    try {
      mkdirSync(userDir, { recursive: true });
      writeFileSync(unitPath, unit, "utf8");
      return {
        platform: "linux",
        installed: true,
        unitPath,
        lines: [
          `✓ Wrote systemd user-unit to ${unitPath}.`,
          `  Activate: systemctl --user daemon-reload && systemctl --user enable --now ${unitName}`,
        ],
      };
    } catch (e) {
      return { platform: "linux", installed: false, unitPath, lines: [`✗ ${(e as Error).message}`] };
    }
  }

  if (plat === "darwin") {
    // launchd plist in ~/Library/LaunchAgents
    const dir = join(homedir(), "Library", "LaunchAgents");
    const label = "ai.mneme.nucleus";
    const plistPath = join(dir, `${label}.plist`);
    if (opts.uninstall) {
      try {
        if (existsSync(plistPath)) {
          spawnSyncPowershell(`launchctl unload ${plistPath}`);
        }
        return { platform: "darwin", installed: false, unitPath: plistPath, lines: [`✓ Unloaded launch agent ${label}.`] };
      } catch (e) {
        return { platform: "darwin", installed: false, unitPath: plistPath, lines: [`✗ ${(e as Error).message}`] };
      }
    }
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node}</string>
    <string>${script}</string>
    <string>nucleus</string>
    <string>daemon</string>
  </array>
  <key>WorkingDirectory</key><string>${cwd}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
`;
    if (opts.print) {
      return { platform: "darwin", installed: false, printedUnit: plist, lines: [`# Save to ${plistPath} then:`, `# launchctl load ${plistPath}`, plist] };
    }
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(plistPath, plist, "utf8");
      try { chmodSync(plistPath, 0o644); } catch { /* ignore */ }
      return { platform: "darwin", installed: true, unitPath: plistPath, lines: [`✓ Wrote launchd plist to ${plistPath}.`, `  Activate: launchctl load ${plistPath}`] };
    } catch (e) {
      return { platform: "darwin", installed: false, unitPath: plistPath, lines: [`✗ ${(e as Error).message}`] };
    }
  }

  return { platform: plat, installed: false, lines: [`✗ Unsupported platform '${plat}' — only win32 / linux / darwin are wired.`] };
}

function spawnSyncPowershell(cmd: string): { err: string | null; out: string } {
  try {
    const isWin = platform() === "win32";
    const r = isWin
      ? spawnSync("powershell.exe", ["-NoProfile", "-Command", cmd], { encoding: "utf8" })
      : spawnSync("sh", ["-c", cmd], { encoding: "utf8" });
    if (r.status !== 0) return { err: (r.stderr || r.stdout || "non-zero exit").trim(), out: r.stdout ?? "" };
    return { err: null, out: r.stdout ?? "" };
  } catch (e) {
    return { err: (e as Error).message, out: "" };
  }
}
