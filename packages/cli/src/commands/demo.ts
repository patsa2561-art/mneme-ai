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
    .description("List Mneme's MCP tool catalog. v2.19.24 adds --tier (starter|explorer|deep|experimental). AI agents always see all tiers via MCP; --tier is a human view.")
    .option("--category <name>", "Filter to one category.")
    // v1.42.5 (#16 fix) — curator default: 20 high-value tools instead
    // of the full 172. Stops the catalog-explosion problem where smaller
    // models thrash through tool selection.
    .option("--curated", "Show only the 20-tool starter set + per-tool rationale (best for first-touch with new AI agents).")
    // v2.19.24 — TIER classifier (extends v2.19.23 PROPRIOCEPTION).
    .option("--tier <tier>", "Filter to a tier: starter | explorer | deep | experimental. AI agents see all tiers regardless.")
    .option("--json", "JSON output.")
    .action(async (opts: { category?: string; curated?: boolean; tier?: string } & CommonOpts) => {
      // v2.19.24 — TIER path (preferred for human users).
      if (opts.tier) {
        const tier = opts.tier.toLowerCase();
        const allowed = new Set(["starter", "explorer", "deep", "experimental"]);
        if (!allowed.has(tier)) {
          writeText(`⚠ Unknown --tier "${opts.tier}". Use one of: starter | explorer | deep | experimental`);
          process.exit(2);
        }
        const [{ buildAllTools: ba }, core] = await Promise.all([
          import("@mneme-ai/mcp/tools/registry"),
          import("@mneme-ai/core"),
        ]);
        const allTools = ba();
        const budget = core.toolTier.computeTierBudget({ toolNames: allTools.map((t) => t.name) });
        const filtered = allTools
          .filter((t) => core.toolTier.classifyTier(t.name).tier === tier)
          .sort((a, b) => a.name.localeCompare(b.name));
        if (opts.json) {
          writeJson({
            total: budget.totalTools,
            tier,
            budget: { starter: budget.starter, explorer: budget.explorer, deep: budget.deep, experimental: budget.experimental },
            entries: filtered.map((t) => ({ name: t.name, description: (t.description ?? "").slice(0, 140) })),
          });
          return;
        }
        const tierBudget = ({ starter: budget.starter, explorer: budget.explorer, deep: budget.deep, experimental: budget.experimental } as Record<string, number>)[tier] ?? 0;
        writeText(`μνήμη Mneme tools · ${budget.totalTools} total · showing tier=${tier} (${tierBudget})`);
        writeText("");
        writeText(`⭐⭐⭐ STARTER       (${String(budget.starter).padStart(3)}) · always shown · curated for first-time users`);
        writeText(`⭐⭐  EXPLORER      (${String(budget.explorer).padStart(3)}) · mneme tools --tier explorer`);
        writeText(`⭐   DEEP          (${String(budget.deep).padStart(3)}) · mneme tools --tier deep`);
        writeText(`🔬  EXPERIMENTAL  (${String(budget.experimental).padStart(3)}) · mneme tools --tier experimental`);
        writeText("");
        const badge = core.toolTier.TIER_BADGE[tier as "starter" | "explorer" | "deep" | "experimental"];
        for (const t of filtered) {
          writeText(`  ${badge} ${t.name.padEnd(48)}  ${(t.description ?? "").slice(0, 80)}`);
        }
        writeText("");
        writeText(`💡 AI agents always see ALL ${budget.totalTools} tools via MCP regardless of tier.`);
        writeText(`💡 Run \`mneme tools --tier explorer\` for v2.18+ power-user tools.`);
        return;
      }
      // v1.42.5 (#16) curated path — short-circuit before hitting the
      // big registry import.
      if (opts.curated) {
        const { curatedTools } = await import("@mneme-ai/core");
        const list = curatedTools.CURATED_DEFAULT_TOOLS;
        if (opts.json) { writeJson({ curated: list, count: list.length }); return; }
        const byCat = curatedTools.curatedByCategory();
        writeText(`✨ Mneme · curated 20-tool starter set (v1.42.5 — 20 of 172)`);
        writeText("");
        for (const [cat, tools] of Object.entries(byCat)) {
          writeText(`── ${cat.toUpperCase()} (${tools.length}) ${"─".repeat(60 - cat.length)}`);
          for (const t of tools) {
            writeText(`  ${t.name}`);
            writeText(`    ${t.why}`);
          }
          writeText("");
        }
        writeText(`Run \`mneme tools\` (no flag) for the full 172-tool catalog.`);
        return;
      }
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
    .description("Bot Squadron — spawn 6 specialized sub-agents to investigate ONE claim from 6 angles, then run the v1.39 DEVIL'S ADVOCATE + EVIDENCE QUORUM aggregator + v1.51 ACGV (Chandrasekhar/Neutrino/Godel/Confession/Vaccine/Stake) on top so the verdict is bias-aware AND repo-grounded. Example: `mneme squad \"the auth refactor in v1.42 introduced a regression\"`")
    .option("--json", "JSON output.")
    .option("--no-advocate", "Skip the v1.39 devil's advocate (legacy verdict only). Default: advocate ON.")
    .option("--require-advocate", "COMPLIANCE-GRADE: refuse to verdict without the advocate present.")
    .option("--no-acgv", "Skip the v1.51 ACGV pre-filter (Chandrasekhar / Neutrino / Godel / Vaccine).")
    .option("--counter-evidence <points>", "Inline confession: '|'-separated counter-points (e.g. 'no .rs files|no Cargo.toml|node daemon'). Triggers Confession layer.")
    .addHelpText("after", `
Examples:
  $ mneme squad "the auth refactor in v1.42 introduced a regression"
  $ mneme squad "this commit is safe to ship" --require-advocate
  $ mneme squad we need to revert HEAD --json

The claim should be a single sentence -- the squadron splits it across 6 angles
(architect / historian / forensics / quality / security / business). With
--require-advocate the verdict refuses to render unless DEVIL'S ADVOCATE
ran on top (compliance-grade evidence quorum).
`)
    .action(async (claim: string[], opts: { advocate?: boolean; requireAdvocate?: boolean; acgv?: boolean; counterEvidence?: string } & CommonOpts) => {
      const { runSquadron } = await import("@mneme-ai/mcp/tools/squadron");
      const { squadronAdvocate } = await import("@mneme-ai/core");
      const text = claim.join(" ");
      const counter = opts.counterEvidence ? opts.counterEvidence.split("|").map((s) => s.trim()).filter(Boolean) : undefined;
      writeText(`🚀 Spawning 6-bot squadron + 🦹 advocate + 🌌 ACGV — claim: "${text.slice(0, 80)}"…\n`);
      // Build a minimal runtime so the squadron can call git etc.
      const { buildRuntime } = await import("@mneme-ai/mcp/tools/runtime");
      const rt = await buildRuntime(process.cwd());
      const verdict = await runSquadron({ rt, claim: text }, undefined, { skipAcgv: opts.acgv === false, counterEvidence: counter });

      // v1.39+ DEVIL'S ADVOCATE + EVIDENCE QUORUM. Run the advocate
      // over the squad's findings, then re-aggregate with bias-aware
      // quorum semantics. The legacy `verdict.consensus` is preserved
      // for comparison; the NEW `quorum.consensus` is what users
      // should trust for compliance-grade decisions.
      const wantAdvocate = opts.advocate !== false;
      const otherFindings = verdict.findings.map((f: { bot: string; verdict: string; confidence: number; evidence?: string[] }) => ({
        bot: f.bot, verdict: f.verdict as "supports" | "contradicts" | "neutral" | "needs_data",
        confidence: f.confidence, evidence: f.evidence ?? [],
      }));
      const advocateFinding = wantAdvocate
        // v1.50.0 — pass repoRoot so the advocate runs FACT GROUNDING.
        // Without this, a claim like "Mneme is written in Rust" gets
        // rubber-stamped SUPPORTED 57% because pattern-matching bots
        // never check the actual repo state.
        ? squadronAdvocate.runAdvocate({ claim: text, otherFindings, repoRoot: process.cwd() })
        : null;
      const quorum = squadronAdvocate.aggregateWithQuorum(text, otherFindings, advocateFinding, {
        repoRoot: process.cwd(),
        requireAdvocate: !!opts.requireAdvocate,
      });

      if (opts.json) { writeJson({ legacyVerdict: verdict, advocate: advocateFinding, quorum, acgv: verdict.acgv }); return; }

      // v1.51.0 -- ACGV verdict surfaces FIRST when authoritative. It uses
      // hard repo grounding, not pattern matching, so its verdict overrides
      // the legacy quorum for IMPOSSIBLE_REFUTE / BLACK_HOLE / AUTO_REFUTE.
      if (verdict.acgv && verdict.acgv.verdict !== "PASSTHROUGH") {
        const acgvGlyph = {
          IMPOSSIBLE_REFUTE: "🌑 IMPOSSIBLE_REFUTE",
          AUTO_REFUTE:       "🦠 AUTO_REFUTE (vaccine match)",
          BLACK_HOLE:        "🕳 BLACK_HOLE collapse",
          FUSION:            "☀ FUSION",
          LIMBO:             "🌫 LIMBO (REFUSE_VERDICT)",
          PASSTHROUGH:       "·",
        }[verdict.acgv.verdict];
        writeText(`${acgvGlyph} (ACGV · v1.51+) · confidence ${(verdict.acgv.confidence * 100).toFixed(0)}%`);
        const c = verdict.acgv.layers.chandrasekhar;
        if (c.verdict !== "UNKNOWN_MASS") {
          writeText(`   mass=${c.mass.toFixed(1)} · density=${c.density.toFixed(3)} · rho_crit=[${c.rhoCritLow.toFixed(3)}, ${c.rhoCritHigh.toFixed(3)}]`);
        }
        if (verdict.acgv.layers.grounding.length > 0) {
          writeText(`   neutrino flavors:`);
          for (const g of verdict.acgv.layers.grounding) {
            writeText(`     ${g.claim.kind}=${g.claim.asserted} → surface=${g.surface.score.toFixed(2)} · substrate=${g.substrate.score.toFixed(2)} · spectrum=${g.spectrum.score.toFixed(2)} · harmonic=${g.harmonic.toFixed(2)}`);
          }
        }
        if (verdict.acgv.layers.godel.status === "UNSAT") {
          writeText(`   godel UNSAT-core (${verdict.acgv.layers.godel.core.length} constraint(s) simultaneously unsatisfiable):`);
          for (const u of verdict.acgv.layers.godel.core.slice(0, 3)) {
            writeText(`     ${u.asserted}`);
          }
        }
        if (verdict.acgv.layers.confession) {
          writeText(`   confession: ${verdict.acgv.layers.confession.responded ? `${verdict.acgv.layers.confession.pointCount} point(s), ${verdict.acgv.layers.confession.groundedCount} grounded` : "no counter-evidence supplied"}`);
        } else if (verdict.acgv.layers.confessionRequest) {
          writeText(`   confession: PENDING -- supply counter-evidence with --counter-evidence "p1|p2|p3" to lock in verdict`);
        }
        if (verdict.acgv.vaccineEmitted) {
          writeText(`   vaccine emitted -- future variants of this lie will auto-refute in microseconds`);
        }
        writeText(``);
      }

      // Render: advocate-aware verdict (NEXT), legacy verdict (LAST) for diff transparency.
      const quorumGlyph =
        quorum.consensus === "verdict_for" ? "✅ SUPPORTED" :
        quorum.consensus === "verdict_against" ? "❌ CONTRADICTED" :
        quorum.consensus === "split" ? "⚖ SPLIT" : "❓ INSUFFICIENT DATA";
      writeText(`${quorumGlyph} (quorum-aware · v1.39+) · confidence ${(quorum.confidence * 100).toFixed(0)}% · ${verdict.totalMs}ms`);
      writeText(`📊 ${quorum.summary}`);
      writeText(`📚 Evidence sources: ${quorum.uniqueSourcesFor} for · ${quorum.uniqueSourcesAgainst} against`);
      if (quorum.caveats.length > 0) {
        writeText(`⚠ Caveats: ${quorum.caveats.join(", ")}`);
      }
      writeText(``);
      writeText(`Per-bot findings:`);
      for (const f of verdict.findings) {
        writeText(`  ${f.glyph} ${f.bot.padEnd(14)} → ${f.verdict.padEnd(11)} · ${f.headline}`);
      }
      if (advocateFinding) {
        const flag = advocateFinding.verdict === "contradicts" ? "✗" : advocateFinding.verdict === "supports" ? "✓" : "·";
        writeText(`  🦹 advocate       → ${flag} ${advocateFinding.verdict.padEnd(11)} · ${advocateFinding.reasoning.slice(0, 100)}`);
        if (advocateFinding.biasSignals.length > 0) {
          writeText(`     bias signals: ${advocateFinding.biasSignals.join(", ")}`);
        }
      }
      writeText(``);
      // Legacy verdict for diff transparency.
      const legacyGlyph =
        verdict.consensus === "verdict_for" ? "✅" :
        verdict.consensus === "verdict_against" ? "❌" :
        verdict.consensus === "split" ? "⚖" : "❓";
      writeText(`(legacy v1.38 verdict for comparison: ${legacyGlyph} ${verdict.consensus} @ ${(verdict.confidence * 100).toFixed(0)}%)`);
      if (quorum.consensus !== verdict.consensus) {
        writeText(`🎯 ADVOCATE FLIPPED THE VERDICT: ${verdict.consensus} → ${quorum.consensus}. Bias signals saved you from rubber-stamping a hallucinated claim.`);
      }
    });
}

// ─── mneme health (= mneme.system.health) ────────────────────────────
// ─── mneme verify (v1.52.0 friendly UX) ──────────────────────────────
export function registerVerifyCommand(program: Command): void {
  program
    .command("verify [claim...]")
    .description("Fast truth-check on a claim. Plain-English verdict (TRUSTWORTHY / MIXED / REFUTED / IMPOSSIBLE) anchored to the ACGV pipeline. Pass --explain for the math; --json for machine output.")
    .option("--json", "Structured JSON output for AI agents.")
    .option("--format <fmt>", "v2.19.61 backward-compat alias: 'human' = friendly text (default), 'json' = same as --json. Explicit override of TTY auto-detect for shell scripts that grep TRUSTWORTHY/REFUTED.", "human")
    .option("--explain", "Surface the ACGV layer breakdown (Chandrasekhar / Neutrino / Godel / Vaccine).")
    .option("--counter-evidence <points>", "Pipe-separated counter-points to feed the Confession layer.")
    .option("--engine <name>", "'z3' = use Z3 SAT (requires optional z3-solver); 'propositional' = fast path (default 'z3' when available).", "z3")
    .option("--stdin", "v2.43.0 — read the claim from stdin (preserves hostile codepoints that the shell strips from argv: BIDI override / NUL byte / control chars).")
    .option("--hex <hex>", "v2.43.0 — accept the claim as hex-encoded UTF-8 (use when the shell drops hostile codepoints).")
    .option("--base64 <b64>", "v2.43.0 — accept the claim as base64-encoded UTF-8 (use when the shell drops hostile codepoints).")
    .option("--clipboard", "v2.44.0 — read the claim from the OS clipboard (pbpaste / xclip / Get-Clipboard); preserves all Unicode losslessly.")
    .option("--file <path>", "v2.44.0 — read the claim from a UTF-8 file (preserves hostile codepoints, useful for very long claims).")
    .addHelpText("after", `
Examples:
  $ mneme verify "the codebase is healthy"
  $ mneme verify "this depends on typescript" --explain
  $ mneme verify "v1.51 introduced a regression" --counter-evidence "tests still pass|no revert commits"

How to read the verdict:
  TRUSTWORTHY  every assertion grounds in the repo + git history -- safe to relay
  MIXED        some assertions ground, others don't -- ask Mneme to drill deeper
  REFUTED      Mneme found contradictory evidence -- retract the claim
  IMPOSSIBLE   Godel SAT proof: no repo state can satisfy this claim -- formal refute
`)
    .action(async (claimWords: string[], opts: { json?: boolean; format?: string; explain?: boolean; counterEvidence?: string; engine?: string; stdin?: boolean; hex?: string; base64?: string; clipboard?: boolean; file?: string }) => {
      // v2.44.0 — SEAMLESS PROTOCOL multi-source claim resolution.
      // Priority (all paths preserve hostile codepoints losslessly):
      //   1. --hex / --base64        (explicit encoded forms)
      //   2. --file <path>           (file content)
      //   3. --clipboard             (OS clipboard via pbpaste/xclip/Get-Clipboard)
      //   4. --stdin                 (explicit stdin)
      //   5. STDIN AUTO-FALLBACK     (no args + non-TTY stdin → auto-read)
      //   6. positional args         (default; shell may strip hostile chars)
      let claim = "";
      if (opts.hex && opts.hex.length > 0) {
        try { claim = Buffer.from(opts.hex.replace(/\s+/g, ""), "hex").toString("utf8"); }
        catch (e) { process.stdout.write(`error: --hex decode failed: ${(e as Error).message}\n`); process.exitCode = 1; return; }
      } else if (opts.base64 && opts.base64.length > 0) {
        try { claim = Buffer.from(opts.base64, "base64").toString("utf8"); }
        catch (e) { process.stdout.write(`error: --base64 decode failed: ${(e as Error).message}\n`); process.exitCode = 1; return; }
      } else if (opts.file && opts.file.length > 0) {
        try {
          const { readFileSync, existsSync } = await import("node:fs");
          if (!existsSync(opts.file)) { process.stdout.write(`error: --file path not found: ${opts.file}\n`); process.exitCode = 1; return; }
          claim = readFileSync(opts.file, "utf8");
        } catch (e) { process.stdout.write(`error: --file read failed: ${(e as Error).message}\n`); process.exitCode = 1; return; }
      } else if (opts.clipboard === true) {
        try {
          const { spawnSync } = await import("node:child_process");
          const platform = process.platform;
          let r: { status: number | null; stdout?: string; stderr?: string };
          if (platform === "darwin") {
            r = spawnSync("pbpaste", [], { encoding: "utf8", timeout: 5000 });
          } else if (platform === "win32") {
            r = spawnSync("powershell", ["-NoProfile", "-Command", "Get-Clipboard -Raw"], { encoding: "utf8", timeout: 5000 });
          } else {
            // Try xclip first then xsel
            r = spawnSync("xclip", ["-selection", "clipboard", "-o"], { encoding: "utf8", timeout: 5000 });
            if (r.status !== 0) r = spawnSync("xsel", ["--clipboard", "--output"], { encoding: "utf8", timeout: 5000 });
          }
          if (r.status !== 0) {
            process.stdout.write(`error: clipboard read failed (${platform}). Install pbpaste/xclip/xsel.\n`);
            process.exitCode = 1; return;
          }
          claim = (r.stdout ?? "").replace(/\r\n$/, "");
        } catch (e) { process.stdout.write(`error: --clipboard failed: ${(e as Error).message}\n`); process.exitCode = 1; return; }
      } else if (opts.stdin === true || ((claimWords?.length ?? 0) === 0 && !process.stdin.isTTY)) {
        // v2.44.0 STDIN AUTO-FALLBACK: when called with NO positional args
        // AND stdin is non-TTY (pipe/redirect), auto-read stdin. This is
        // the standard Unix convention so `echo "claim" | mneme verify`
        // just works without --stdin.
        try {
          const chunks: Buffer[] = [];
          for await (const c of process.stdin) chunks.push(c as Buffer);
          claim = Buffer.concat(chunks).toString("utf8");
        } catch (e) {
          process.stdout.write(`error: stdin read failed: ${(e as Error).message}\n`);
          process.exitCode = 1; return;
        }
      } else {
        claim = (claimWords ?? []).join(" ");
      }
      if (!claim || claim.length === 0) {
        process.stdout.write(`error: empty claim. Pass positional args, pipe via stdin, or use --stdin / --hex / --base64 / --clipboard / --file.\n`);
        process.exitCode = 1; return;
      }
      // v2.44.0 SHELL-STRIP DETECTIVE: warn when claim mentions hostile
      // chars (BIDI / null / override) but contains none — the user
      // probably meant to test hostile input and the shell stripped it.
      try {
        const { detectShellStrip } = await import("@mneme-ai/core").then((m) => (m as { acgvShellStripDetective?: { detectShellStrip: (s: string) => { suspicious: boolean; hint: string } } }).acgvShellStripDetective ?? { detectShellStrip: () => ({ suspicious: false, hint: "" }) });
        const ssd = detectShellStrip(claim);
        if (ssd.suspicious && !opts.json) {
          process.stderr.write(ssd.hint + "\n\n");
        }
      } catch { /* best-effort */ }
      // v2.19.61 — --format=json is an explicit alias for --json (backward
      // compat for user shell scripts that grep specific verdict strings).
      // --format=human (default) forces human output even if user piped stdout.
      if (opts.format === "json") opts.json = true;
      const { acgv, acgvExplain } = await import("@mneme-ai/core");
      const counter = opts.counterEvidence ? opts.counterEvidence.split("|").map((s) => s.trim()).filter(Boolean) : undefined;
      const result = opts.engine === "propositional"
        ? acgv.runACGV({ claim, repoRoot: process.cwd(), counterEvidence: counter })
        : await acgv.runACGVAsync({ claim, repoRoot: process.cwd(), counterEvidence: counter });

      const explained = acgvExplain.explain(result, claim);

      // v2.19.15 TRUTH FORENSIC PIPELINE — the W2 kill (replaces the v2.19.8
      // regex string mutation with a real falsification gate).
      //
      // For AI-tool-self-description claims (the W2 class), we now sniff
      // verifiable assertions (mneme.X.Y exists, "N mneme.X.* tools",
      // version, file paths) and CHECK them against Mneme's own ground
      // truth — the live MCP catalog + installed version. The previous
      // implementation regex-mutated the headline string but never
      // actually checked the catalog; this one DOES.
      const { truthForensic } = await import("@mneme-ai/core");
      const { buildAllTools } = await import("@mneme-ai/mcp");
      const { existsSync } = await import("node:fs");
      const { resolve: pathResolve } = await import("node:path");
      const mcpCatalog = buildAllTools().map((t: { name: string }) => t.name);
      const pkgVersion = (() => {
        try {
          const pkg = require("../../package.json");
          return String(pkg.version);
        } catch {
          return undefined;
        }
      })();
      const repoRoot = process.cwd();
      const forensic = truthForensic.forensicVerify({
        claim,
        groundTruth: {
          mcpCatalog,
          ...(pkgVersion ? { installedVersion: pkgVersion } : {}),
          fileExists: (p: string) => existsSync(pathResolve(repoRoot, p)),
        },
      });
      // v2.35.0 WIRING FIX — preserve ACGV Layer-0 explicit verdicts.
      //
      // v2.34.0 shipped SELF_PARADOX / SELF_REFERENCE / FAKE_COMMIT_HASH /
      // INPUT_TRUNCATED caveats in the ACGV pipeline + explainer headlines,
      // BUT the forensic-merge logic below would overwrite those headlines
      // with FORENSIC-ACCEPTED whenever ACGV returned PASSTHROUGH (which
      // self-paradox + self-ref + truncated all do — they're category errors,
      // not falsehoods). User-visible bug N3 / R3 / R1 came from this
      // wiring gap: my Layer-0b/0c verdicts were CORRECT in core but the CLI
      // overrode them. Fix: when ACGV emits an explicit Layer-0 caveat,
      // SHORT-CIRCUIT the forensic merge entirely.
      const layer0Caveats = ["SELF_PARADOX_DETECTED", "SELF_REFERENCE_DETECTED"];
      // v2.40.0 — INPUT_TAMPERED (BIDI/null-byte/tag-char) + INPUT_HYGIENE
      // (zero-width / NFC / homoglyph) + NUMBER_BRIDGE are Layer-0 verdicts
      // and must short-circuit the forensic merge (same fix-class as v2.35).
      const layer0Prefixes = ["INPUT_TRUNCATED", "FAKE_COMMIT_HASH", "INPUT_UNVERIFIABLE", "HYPERBOLE_DETECTOR_FIRED", "HISTORICAL_CLAIM", "FUTURE_VERSION_CLAIM", "INPUT_TAMPERED", "INPUT_HYGIENE", "NUMBER_BRIDGE"];
      const hasLayer0Verdict = (result.caveats ?? []).some((c) =>
        layer0Caveats.includes(c) || layer0Prefixes.some((p) => c.startsWith(p))
      );
      // v2.19.42 N3 FIX — forensic-FIRST routing (Layer-0 short-circuit applied).
      //
      // Pre-v2.19.42 bug: ACGV's legacy sniffers don't recognise the
      // "mneme.X.Y is registered" assertion shape, so claims like
      // `mneme.truth.forensic is registered` returned PASSTHROUGH /
      // NEEDS-DATA from ACGV while forensic correctly returned ACCEPTED
      // (1 grounded assertion). The two layers disagreed and the CLI
      // surfaced the weaker one.
      //
      // New routing rule (one place, deterministic):
      //   forensic = REJECTED → red (overrides everything; honest refute)
      //   forensic = ACCEPTED → green if ACGV was weak/PASSTHROUGH; otherwise append
      //   forensic = UNKNOWN  → keep ACGV's verdict; only downgrade
      //                         TRUSTWORTHY when forensic sniffed assertions
      //                         it couldn't ground (be cautious)
      //
      // Effect: `mneme verify` now matches `mneme.truth.forensic` MCP
      // exactly when forensic has a verdict. Legacy ACGV remains the
      // fallback for claims forensic can't sniff (numeric/logical/
      // language-of-implementation).
      const mutable = explained as unknown as { headline?: string; plain?: string; trafficLight?: string };
      const acgvWeak = result.verdict === "PASSTHROUGH" || result.verdict === "LIMBO";
      // v2.35.0 — when ACGV Layer 0b/0c emitted an explicit caveat
      // (SELF_PARADOX / SELF_REFERENCE / INPUT_TRUNCATED / FAKE_COMMIT_HASH /
      // INPUT_UNVERIFIABLE / HYPERBOLE_DETECTOR_FIRED), the forensic
      // sniffer must NOT overwrite the headline — those are explicit
      // category errors / input-bound flags and the headline tells the
      // user something forensic can't add to.
      if (!hasLayer0Verdict) {
      if (forensic.verdict === "REJECTED") {
        mutable.headline = `❌ FORENSIC-REJECTED — claim contains refuted assertion(s).`;
        mutable.plain = (mutable.plain ?? "") + "\n\n" + forensic.explanation;
        mutable.trafficLight = "red";
      } else if (forensic.verdict === "ACCEPTED" && acgvWeak) {
        // v2.19.42 N3 promotion: ACGV had no opinion, forensic grounded every
        // assertion → upgrade to TRUSTWORTHY so verify CLI matches forensic MCP.
        const sup = forensic.assertions.filter((a) => a.sub_verdict === "supported").length;
        mutable.headline = `✅ FORENSIC-ACCEPTED — ${sup}/${forensic.assertions.length} assertion(s) grounded in the live MCP catalog`;
        mutable.plain = (mutable.plain ?? "") + "\n\n" + forensic.explanation;
        mutable.trafficLight = "green";
      } else if (forensic.verdict === "ACCEPTED") {
        // v2.19.43 N8 fix — when ACGV is a STRONG REFUTE (IMPOSSIBLE_REFUTE
        // / BLACK_HOLE) but forensic ACCEPTED, the two layers genuinely
        // disagree. Pre-fix the appended "✅ ACCEPTED" leaked emoji into a
        // 🌑 IMPOSSIBLE rendering → user saw conflicting glyphs in the same
        // output. Now we surface "LAYERS DISAGREE" explicitly and let the
        // emoji neutraliser strip the contradicting ✓ from the rendered
        // plain (presentation invariant in acgvExplain.renderExplained).
        const strongRefute = result.verdict === "IMPOSSIBLE_REFUTE" || result.verdict === "BLACK_HOLE";
        if (strongRefute) {
          mutable.plain = (mutable.plain ?? "") + "\n\nLAYERS DISAGREE — forensic sniffer grounded "
            + forensic.assertions.length + " assertion(s), but ACGV proved the compound claim impossible. "
            + "The strict math refute wins; the grounded parts are noted for transparency.\n\n"
            + forensic.explanation;
        } else {
          // ACGV had an opinion (FUSION etc) — just append the forensic trail.
          mutable.plain = (mutable.plain ?? "") + "\n\n" + forensic.explanation;
        }
      } else if (typeof mutable.headline === "string" && /TRUSTWORTHY/i.test(mutable.headline) && forensic.assertions.length > 0) {
        // Sniffer found assertions but couldn't ground them (untested) — be cautious.
        mutable.headline = mutable.headline.replace(/TRUSTWORTHY/gi, "MIXED-NEEDS-DATA");
        mutable.plain = (mutable.plain ?? "") + "\n\n" + forensic.explanation;
        if (mutable.trafficLight === "green") mutable.trafficLight = "yellow";
      }
      } // close v2.35.0 !hasLayer0Verdict guard
      // Stash the forensic result on the JSON output (AI agents can read it)
      (result as unknown as { forensic?: typeof forensic }).forensic = forensic;

      if (opts.json) {
        process.stdout.write(JSON.stringify({ verdict: result.verdict, confidence: result.confidence, headline: explained.headline, plain: explained.plain, nextAction: explained.nextAction, trafficLight: explained.trafficLight, engine: (result as { engine?: string }).engine ?? "propositional", acgv: result }, null, 2) + "\n");
        return;
      }

      const lines = acgvExplain.renderExplained(explained, claim);
      for (const l of lines) writeText(l);

      if (opts.explain) {
        writeText(``);
        writeText(`-- ACGV layer breakdown --`);
        const c = result.layers.chandrasekhar;
        if (c.verdict !== "UNKNOWN_MASS") {
          writeText(`  Chandrasekhar: mass=${c.mass.toFixed(2)} density=${c.density.toFixed(3)} verdict=${c.verdict}`);
          writeText(`                 thresholds: rho_crit_low=${c.rhoCritLow.toFixed(3)} rho_crit_high=${c.rhoCritHigh.toFixed(3)}`);
        }
        if (result.layers.grounding.length > 0) {
          writeText(`  Neutrino (per assertion):`);
          for (const g of result.layers.grounding) {
            writeText(`    ${g.claim.kind}=${g.claim.asserted} -> surface=${g.surface.score.toFixed(2)} substrate=${g.substrate.score.toFixed(2)} spectrum=${g.spectrum.score.toFixed(2)} harmonic=${g.harmonic.toFixed(2)}`);
          }
        }
        const engine = (result as { engine?: string }).engine;
        if (result.layers.godel.status === "UNSAT") {
          writeText(`  Godel: UNSAT proof (engine=${engine ?? "propositional"})`);
          for (const u of result.layers.godel.core.slice(0, 3)) writeText(`    ${u.asserted}`);
        } else if (result.layers.godel.status !== "SKIPPED") {
          writeText(`  Godel: ${result.layers.godel.status} (engine=${engine ?? "propositional"})`);
        }
        if (result.vaccineEmitted) writeText(`  Vaccine: emitted for future variants`);
        if (result.layers.confession) writeText(`  Confession: ${result.layers.confession.responded ? `${result.layers.confession.pointCount} point(s), ${result.layers.confession.groundedCount} grounded` : "none supplied"}`);
      }
    });
}

// ─── mneme covenant (v1.58.0 Tier 2 — bilateral contracts) ───────────
export function registerCovenantCommand(program: Command): void {
  const cov = program.command("covenant").description("Tier 2 -- HMAC-signed bilateral contract between user + AI vendor. Mneme enforces; Aletheia compliance score moves over time.");

  cov.command("sign").description("Sign a new covenant with the default user + vendor promises.").option("--user <name>", "User name", "user").option("--vendor <name>", "Target vendor", "any-vendor").option("--renewal-days <n>", "Renewal window in days", "30").action(async (opts: { user?: string; vendor?: string; renewalDays?: string }) => {
    const { covenant } = await import("@mneme-ai/core");
    const c = covenant.signCovenant(process.cwd(), { userName: opts.user ?? "user", vendorName: opts.vendor, renewalDays: opts.renewalDays ? parseInt(opts.renewalDays, 10) : 30 });
    writeText(`Covenant signed (id ${c.id}, hmac ${c.hmac.slice(0, 8)}...)`);
    writeText(`User: ${c.signedBy.user.name} (sig ${c.signedBy.user.signature.slice(0, 8)}...)`);
    writeText(`Vendor: ${c.signedBy.vendor.name}`);
    writeText(`Renewal: ${c.renewalDays} days`);
    writeText(``); writeText(`User promises (${c.userPromises.length}):`);
    for (const p of c.userPromises) writeText(`  [${p.weight}] ${p.id} -- ${p.text}`);
    writeText(``); writeText(`Vendor promises (${c.vendorPromises.length}):`);
    for (const p of c.vendorPromises) writeText(`  [${p.weight}] ${p.id} -- ${p.text}`);
  });

  cov.command("show").description("Read the active covenant.").option("--json", "JSON output.").action(async (opts: { json?: boolean }) => {
    const { covenant } = await import("@mneme-ai/core");
    const c = covenant.readActiveCovenant(process.cwd());
    if (!c) { writeText("No active covenant. Run 'mneme covenant sign' first."); return; }
    if (opts.json) { writeJson(c); return; }
    const v = covenant.verifyCovenant(process.cwd(), c);
    writeText(`Covenant ${c.id} -- ${v.ok ? "HMAC VALID" : "TAMPERED: " + v.reason}`);
    writeText(`Signed: ${c.signedAt} by ${c.signedBy.user.name}`);
    const days = covenant.renewalDaysRemaining(process.cwd());
    writeText(`Renewal: ${days ?? "?"} days remaining`);
  });

  cov.command("violations").description("Scan for covenant violations and (with --record) persist them to the audit log.").option("--json", "JSON output.").option("--record", "Persist detected violations to .mneme/covenant/violations.jsonl.").action(async (opts: { json?: boolean; record?: boolean }) => {
    const { covenant } = await import("@mneme-ai/core");
    const violations = covenant.detectViolations(process.cwd());
    if (opts.record) { for (const v of violations) covenant.recordViolation(process.cwd(), v); }
    if (opts.json) { writeJson(violations); return; }
    writeText(`Detected ${violations.length} violation(s)${opts.record ? " (recorded)" : ""}`);
    for (const v of violations.slice(0, 10)) writeText(`  [${v.severity}] ${v.vendor} -- ${v.promiseId} -- ${v.context.slice(0, 80)}`);
  });

  cov.command("score <vendor>").description("Compute the Aletheia compliance score for a vendor.").option("--json", "JSON output.").action(async (vendor: string, opts: { json?: boolean }) => {
    const { covenant } = await import("@mneme-ai/core");
    const s = covenant.complianceScore(process.cwd(), vendor);
    if (opts.json) { writeJson(s); return; }
    writeText(`${vendor} compliance: ${s.score}/100`);
    writeText(`  total violations: ${s.violations}`);
    writeText(`  last 30 days:     ${s.recentViolations}`);
  });
}

// ─── mneme sovereign (v1.57.0 Sovereignty Kernel) ────────────────────
export function registerAskCommand(program: Command): void {
  const sov = program
    .command("sovereign")
    .description("Sovereignty Kernel -- Mneme answers questions about THIS repo using local Ollama + ACGV grounding gate. Free-first: no API key, no cloud, no source code leaves the laptop. v1.57.0.");

  sov
    .command("ask <question...>")
    .description("Ask Mneme a grounded question. Ollama generates the text; Mneme (ACGV) decides whether to relay it. Refuses to fake confidence.")
    .option("--json", "JSON output.")
    .option("--show-evidence", "Print the evidence slices that grounded the answer.")
    .option("--skip-grounding", "Bypass the ACGV grounding gate (debug / power-user).")
    .option("--model <name>", "Ollama model name. Defaults to MNEME_OLLAMA_MODEL or llama3.2.")
    .addHelpText("after", `
Examples:
  $ mneme ask "what does the harmonic mean function do?"
  $ mneme ask "when was v1.42 shipped?" --show-evidence
  $ mneme ask "is Mneme written in Rust?"

Prerequisites:
  - Ollama running locally: 'ollama serve' (default http://127.0.0.1:11434)
  - At least one model pulled: 'ollama pull llama3.2'

Set MNEME_OLLAMA_URL / MNEME_OLLAMA_MODEL to override defaults.
`)
    .action(async (words: string[], opts: { json?: boolean; showEvidence?: boolean; skipGrounding?: boolean; model?: string }) => {
      const { sovereign } = await import("@mneme-ai/core");
      const question = words.join(" ");
      const t0 = Date.now();
      const r = await sovereign.sovereignAsk({
        repoRoot: process.cwd(),
        question,
        skipGroundingGate: opts.skipGrounding === true,
        ollama: opts.model ? { model: opts.model } : undefined,
      });
      if (opts.json) { writeJson(r); return; }
      const glyph = r.verdict === "grounded" ? "✓"
        : r.verdict === "ungrounded" ? "?"
        : r.verdict === "refused" ? "X"
        : "!";
      writeText(`Mneme · ${glyph} ${r.verdict.toUpperCase()}  (${(Date.now() - t0)}ms)`);
      writeText(``);
      if (r.text) {
        writeText(r.text);
        writeText(``);
      }
      writeText(`> ${r.reason}`);
      if (opts.showEvidence && r.evidence.length > 0) {
        writeText(``);
        writeText(`Evidence that grounded the prompt:`);
        for (const s of r.evidence) {
          writeText(`  [${s.label}]`);
          for (const l of s.lines) writeText(`    - ${l}`);
        }
      }
      writeText(``);
      writeText(`latency: context=${r.latency.contextMs}ms  ollama=${r.latency.ollamaMs}ms  grounding=${r.latency.groundingMs}ms  total=${r.latency.totalMs}ms`);
    });
}

// ─── mneme autoboot (v1.56.0 Phoenix Resurrection) ───────────────────
export function registerAutobootCommand(program: Command): void {
  const cmd = program
    .command("autoboot")
    .description("Phoenix Resurrection Protocol -- install / uninstall / status of the cross-platform auto-boot mechanisms. Arms Plan 1/2/3 simultaneously so the daemon resurrects after every reboot regardless of which mechanism is blocked by the host.");

  cmd
    .command("install")
    .description("Arm auto-boot. Default mode='triple' installs every available mechanism for the host platform; 'first-success' stops after the first armed mechanism.")
    .option("--json", "JSON output.")
    .option("--mode <mode>", "'triple' (default) or 'first-success'", "triple")
    .action(async (opts: { json?: boolean; mode?: string }) => {
      const { autoboot } = await import("@mneme-ai/core");
      // mnemeBin: derive from process.argv[1] (the CLI entry that's running now).
      const mnemeBin = process.argv[1] ?? "mneme";
      const summary = autoboot.installAutoBoot({
        mnemeBin,
        mode: opts.mode === "first-success" ? "first-success" : "triple",
        repoRoot: process.cwd(),
      });
      if (opts.json) { writeJson(summary); return; }
      writeText(`Phoenix Resurrection Protocol -- install`);
      writeText(`  platform: ${summary.platform}`);
      writeText(`  plan:     ${summary.plan.join(" -> ")}`);
      writeText(``);
      for (const r of summary.results) {
        const glyph = r.ok ? "OK" : "FAIL";
        writeText(`  [${glyph}] ${r.mechanism.padEnd(16)} -- ${r.message}${r.target ? ` (${r.target})` : ""}`);
      }
      writeText(``);
      writeText(`  armed mechanisms: ${summary.armedMechanisms.length}/${summary.plan.length}`);
      writeText(`  resurrection probability (5% indep. failure assumption): ${(summary.estimatedResurrectionProbability * 100).toFixed(2)}%`);
    });

  cmd
    .command("uninstall")
    .description("Remove every Phoenix mechanism (scheduled task / startup folder / registry / LaunchAgent / cron / systemd unit / shell rc).")
    .option("--json", "JSON output.")
    .action(async (opts: { json?: boolean }) => {
      const { autoboot } = await import("@mneme-ai/core");
      const summary = autoboot.uninstallAutoBoot({ repoRoot: process.cwd() });
      if (opts.json) { writeJson(summary); return; }
      writeText(`Phoenix Resurrection Protocol -- uninstall (platform: ${summary.platform})`);
      for (const r of summary.results) {
        writeText(`  [${r.ok ? "OK" : "FAIL"}] ${r.mechanism.padEnd(16)} -- ${r.message}`);
      }
    });

  cmd
    .command("status")
    .description("Diagnose the current auto-boot state. Reports which mechanisms are armed, the last install timestamp, and whether the daemon is alive.")
    .option("--json", "JSON output.")
    .action(async (opts: { json?: boolean }) => {
      const { autoboot } = await import("@mneme-ai/core");
      const report = autoboot.autoBootStatus(process.cwd());
      if (opts.json) { writeJson(report); return; }
      writeText(`Phoenix Resurrection Protocol -- status`);
      writeText(`  platform:        ${report.platform}`);
      writeText(`  daemon running:  ${report.daemonRunning ? "yes" : "no"}`);
      writeText(``);
      writeText(`  available mechanisms:`);
      for (const [name, cap] of Object.entries(report.capabilities)) {
        writeText(`    [${cap.available ? "OK" : "--"}] ${name.padEnd(16)} -- ${cap.reason}`);
      }
      writeText(``);
      writeText(`  recommended plan: ${report.plan.join(" -> ") || "(none on this host)"}`);
      writeText(``);
      if (report.lastInstall) {
        writeText(`  last install:    ${report.lastInstall.installedAt}`);
        writeText(`  armed:           ${report.lastInstall.mechanisms.join(", ")}`);
        writeText(`  resurrection P:  ${(report.lastInstall.probSuccess * 100).toFixed(2)}%`);
      } else {
        writeText(`  no install record -- run 'mneme autoboot install' (or it'll be done silently on next 'mneme upgrade').`);
      }
    });
}

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
