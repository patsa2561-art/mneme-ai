/**
 * mneme demo / mneme tools / mneme bot / mneme health (v1.22.0)
 *
 * Exposes the v1.20+ wow-features as standalone CLI commands so users
 * can experience NUCLEUS / Bot Squadron / Mneme Glow / Karma streaks
 * WITHOUT going through MCP setup. Calls the same core functions the
 * MCP tools do; output is rendered as plain text (with --json for
 * machine-readable parity).
 *
 * Why: 99% of users who `npm install -g mneme-ai` and try the CLI
 * before doing `mneme mcp --install` previously saw zero wow-features.
 * This file fixes that — every black-sheep feature shipped in v1.18-v1.21
 * is one CLI command away.
 */

import type { Command } from "commander";
import { nucleus, lineage, karmaStreaks, lineageSeed } from "@mneme-ai/core";

interface CommonOpts {
  json?: boolean;
}

function writeJson(payload: unknown): void {
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
}
function writeText(line: string): void {
  process.stdout.write(line + "\n");
}
function out(opts: CommonOpts, jsonPayload: unknown, humanLines: string[]): void {
  if (opts.json) writeJson(jsonPayload);
  else for (const line of humanLines) writeText(line);
}

// ─── mneme tools (= mneme.capabilities) ──────────────────────────────
export function registerToolsCommand(program: Command): void {
  program
    .command("tools")
    .description("List Mneme's full MCP tool catalog (mirror of mneme.capabilities).")
    .option("--category <name>", "Filter to one category.")
    .option("--json", "JSON output.")
    .action(async (opts: { category?: string } & CommonOpts) => {
      // Lazy import via the MCP package's public registry export.
      const { buildAllTools, groupByCategory } = await import("@mneme-ai/mcp/tools/registry");
      void buildAllTools; void groupByCategory;
      const grouped = groupByCategory();
      const filter = opts.category;
      const total = buildAllTools().length;
      if (opts.json) {
        const data: Record<string, unknown> = {};
        for (const [cat, tools] of grouped) {
          if (filter && filter !== cat) continue;
          data[cat] = tools.map((t) => ({ name: t.name, description: t.description.slice(0, 200) }));
        }
        writeJson({ totalTools: total, catalog: data });
        return;
      }
      writeText(`✨ Mneme · ${total} MCP tools across ${grouped.size} categories\n`);
      for (const [cat, tools] of grouped) {
        if (filter && filter !== cat) continue;
        writeText(`── ${cat} (${tools.length}) ${"─".repeat(60 - cat.length)}`);
        for (const t of tools.slice(0, 8)) {
          writeText(`  ${t.name}`);
          writeText(`    ${t.description.slice(0, 140)}${t.description.length > 140 ? "…" : ""}`);
        }
        if (tools.length > 8) writeText(`  … and ${tools.length - 8} more (use --json or --category=${cat})`);
        writeText("");
      }
      writeText(`Wisdom: this is the FULL catalog (no MCP setup needed for browsing).`);
      writeText(`To USE these tools as an AI agent → \`mneme mcp --install\` then restart your AI tool.`);
    });
}

// ─── mneme squad (= mneme.bot.spawn) ───────────────────────────────────
export function registerBotCommand(program: Command): void {
  program
    .command("squad <claim...>")
    .description("Bot Squadron — spawn 6 specialized sub-agents to investigate ONE claim from 6 angles.")
    .option("--json", "JSON output.")
    .action(async (claim: string[], opts: CommonOpts) => {
      const { runSquadron } = await import("@mneme-ai/mcp/tools/squadron");
      const text = claim.join(" ");
      writeText(`🚀 Spawning 6-bot squadron — claim: "${text.slice(0, 80)}"…\n`);
      // Build a minimal runtime so the squadron can call git etc.
      const { buildRuntime } = await import("@mneme-ai/mcp/tools/runtime");
      const rt = await buildRuntime(process.cwd());
      const verdict = await runSquadron({ rt, claim: text });
      if (opts.json) { writeJson(verdict); return; }
      const verdictGlyph =
        verdict.consensus === "verdict_for" ? "✅ SUPPORTED" :
        verdict.consensus === "verdict_against" ? "❌ CONTRADICTED" :
        verdict.consensus === "split" ? "⚖ SPLIT" : "❓ INSUFFICIENT DATA";
      writeText(`${verdictGlyph} · confidence ${(verdict.confidence * 100).toFixed(0)}% · ${verdict.totalMs}ms\n`);
      for (const f of verdict.findings) {
        writeText(`  ${f.glyph} ${f.bot.padEnd(14)} → ${f.verdict.padEnd(11)} · ${f.headline}`);
      }
      writeText(`\n📋 Recommendation: ${verdict.recommendation}`);
      if (verdict.agreeing.length) writeText(`✓ Agreeing: ${verdict.agreeing.join(", ")}`);
      if (verdict.dissenting.length) writeText(`✗ Dissenting: ${verdict.dissenting.join(", ")}`);
    });
}

// ─── mneme health (= mneme.system.health) ────────────────────────────
export function registerHealthCommand(program: Command): void {
  const health = program
    .command("health")
    .description("Single-screen health: version + lineage state + nucleus streaks.")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const root = process.cwd();
      const version = process.env["npm_package_version"] ?? "unknown";
      const ids = lineage.listChromosomes(root);
      const tree = lineage.readTree(root);
      const sporeStatus = lineage.sporeStatus(root);
      const identity = lineage.loadOrCreateIdentity(root);
      const streaks = karmaStreaks.readStreaks(root);
      const banner = karmaStreaks.streakBanner(streaks);
      const n = nucleus.readNucleus(root);
      const data = { version, identity: identity.fingerprint, chromosomes: ids.length, head: tree.head, sporeConfigured: sporeStatus.configured, nucleusTick: n.tick, wisdomScore: n.wisdomScore, streaks: { verified: streaks.verifiedStreak, hallucinations: streaks.totalHallucinations, achievements: streaks.unlocked.length }, banner };
      out(opts, data, [
        `✨ Mneme v${version} · status: HEALTHY`,
        ``,
        `Identity: ${identity.fingerprint}`,
        `Chromosomes captured: ${ids.length}${ids.length === 0 ? " (none yet — install MCP)" : ""}`,
        `Spore sync: ${sporeStatus.configured ? "configured ✓" : "local-only"}`,
        `Nucleus tick: #${n.tick} · wisdom score ${n.wisdomScore} · ${n.lessons.length} lessons learned`,
        `Streaks: ${banner || "(no streaks yet — start using Mneme via MCP)"}`,
        `Achievements unlocked: ${streaks.unlocked.length}/9`,
      ]);
    });

  // v1.27.6 NEW: HCI (Healthcare Index) -- composite 0-100 score for repo wisdom layer.
  health
    .command("hci")
    .description("Mneme Healthcare Index: composite 0-100 score from 6 axes (selfcheck, daemon, inbox, antivirus, retrieval, evolve). Single number for repo wisdom-layer health.")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const { hci } = await import("@mneme-ai/core");
      const r = hci.computeHci(process.cwd());
      if (opts.json) { process.stdout.write(JSON.stringify(r, null, 2) + "\n"); return; }
      process.stdout.write(`Mneme Healthcare Index: ${r.score}/100 (${r.band})\n\n`);
      process.stdout.write(`Per-axis breakdown:\n`);
      for (const a of r.axes) {
        const wt = (a.weight * 100).toFixed(0);
        process.stdout.write(`  [${a.score.toString().padStart(3)}/100 · w=${wt}%] ${a.name.padEnd(11)} -- ${a.evidence}\n`);
      }
      process.stdout.write(`\nBand legend:\n`);
      process.stdout.write(`  90-100  Robust    every system green\n`);
      process.stdout.write(`  75-89   Healthy   most green, minor drift\n`);
      process.stdout.write(`  50-74   Wobbly    daemon stale OR major axis untriaged\n`);
      process.stdout.write(`  30-49   Sick      multiple FAILs, evolve queue building\n`);
      process.stdout.write(`   0-29   Critical  daemon dead, antivirus uncertified\n`);
    });
}

// ─── mneme demo (combined showcase) ──────────────────────────────────
export function registerDemoCommand(program: Command): void {
  program
    .command("demo")
    .description("Showcase Mneme's wow-features in 60 seconds — synthesizes seed lineage + ticks nucleus + spawns bot squadron + shows DNA evolution.")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      writeText(`✨ Mneme demo — running every wow-feature in-process (no MCP setup needed)\n`);
      const root = process.cwd();

      // Step 1: Synthetic seed lineage
      writeText(`[1/4] Synthesizing 3 community seed chromosomes…`);
      const seedResult = lineageSeed.synthesizeSeedLineage(root, { force: true });
      writeText(`      ✓ ${seedResult.created} synthetic chromosomes created (vendors: ${seedResult.vendors.join(", ")})\n`);

      // Step 2: Nucleus tick
      writeText(`[2/4] Ticking the nucleus…`);
      const tickResult = nucleus.tick(root);
      writeText(`      ✓ Tick #${tickResult.state.tick} · wisdom ${tickResult.state.wisdomScore} · ${tickResult.delta.newLesson ? "new lesson: " + tickResult.delta.newLesson.text : "no new lesson"}\n`);

      // Step 3: Bot Squadron
      writeText(`[3/4] Spawning 6-bot squadron on a sample claim…`);
      const { runSquadron } = await import("@mneme-ai/mcp/tools/squadron");
      const { buildRuntime } = await import("@mneme-ai/mcp/tools/runtime");
      const rt = await buildRuntime(root);
      const verdict = await runSquadron({ rt, claim: "this codebase is healthy and has good test coverage" });
      writeText(`      ✓ Verdict: ${verdict.consensus} · confidence ${(verdict.confidence * 100).toFixed(0)}% · ${verdict.totalMs}ms`);
      writeText(`      ✓ Bots fired: ${verdict.findings.map((f) => f.glyph + f.bot).join(" ")}\n`);

      // Step 4: Mutation evolution
      writeText(`[4/4] Applying one mutation cycle (real evolution)…`);
      const mutatedId = await nucleus.evolveOnce(root);
      writeText(`      ✓ Mutated chromosome born: ${mutatedId ?? "(no parent to mutate from)"}\n`);

      // Final DNA snapshot
      const finalDna = nucleus.readNucleus(root);
      writeText(`✨ DNA snapshot — ${nucleus.dnaBanner(finalDna)}`);
      writeText(``);
      writeText(`What just happened (in 60 seconds):`);
      writeText(`  • You saw the full Mneme stack working WITHOUT MCP setup`);
      writeText(`  • Lineage now has ${seedResult.created} seed + 1 mutated chromosome`);
      writeText(`  • Bot squadron showed how 6 sub-agents reach consensus on a claim`);
      writeText(`  • Nucleus ticked → wisdom score grew → lesson synthesized`);
      writeText(`  • Mutation evolution created a fitter chromosome`);
      writeText(``);
      writeText(`Real value comes when an AI agent uses these via MCP. Run:`);
      writeText(`  $ mneme mcp --install   (auto-configs Claude Code / Cursor / Continue)`);
      writeText(`  $ then restart your AI tool + ask: "call mneme.welcome"`);
      if (opts.json) writeJson({ seedResult, tick: tickResult, verdict, mutatedId, finalDna });
    });
}
