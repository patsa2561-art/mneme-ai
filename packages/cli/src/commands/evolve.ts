/**
 * `mneme evolve` -- self-modifying NUCLEUS proposal CLI (v1.26.4).
 *
 *   mneme evolve scan         show signals collected from local telemetry
 *   mneme evolve propose      generate markdown PR proposals
 *   mneme evolve list         list every persisted proposal
 *   mneme evolve view <id>    print one proposal's markdown
 *   mneme evolve stats        aggregate stats
 *
 * Mneme reads its own bug reports (selfcheck FAILs + antivirus
 * recurrences + PRECOG misses) and writes markdown PR proposals into
 * `.mneme/proposals/<id>.md`. NEVER auto-merges. The user (or a CI
 * agent) opens the actual GitHub PR.
 */

import type { Command } from "commander";
import { evolve } from "@mneme-ai/core";

interface CommonOpts { json?: boolean }

function writeJson(p: unknown): void { process.stdout.write(JSON.stringify(p, null, 2) + "\n"); }
function writeText(s: string): void { process.stdout.write(s + "\n"); }

export function registerEvolveCommands(program: Command): void {
  const ev = program
    .command("evolve")
    .description("MNEME EVOLVE -- self-modifying NUCLEUS. Reads local telemetry, proposes markdown PR patches to Mneme itself. Never auto-merges.");

  ev.command("scan")
    .description("Show every signal Mneme can extract from local telemetry (selfcheck FAILs + antivirus + PRECOG misses).")
    .option("--json", "JSON output.")
    .action((opts: CommonOpts) => {
      const sigs = evolve.scanSignals(process.cwd());
      if (opts.json) { writeJson(sigs); return; }
      if (sigs.length === 0) { writeText("(no signals -- run `mneme selfcheck run` first to populate)"); return; }
      writeText(`Mneme evolve -- ${sigs.length} signal(s)`);
      for (const s of sigs) {
        writeText(`  [${s.kind.padEnd(22)}] ${s.pattern}  x${s.occurrences}`);
        if (s.evidence) writeText(`         ${s.evidence}`);
      }
    });

  ev.command("propose")
    .description("Generate markdown PR proposals from current signals. Persists to .mneme/proposals/.")
    .option("--json", "JSON output.")
    .action((opts: CommonOpts) => {
      const ps = evolve.generateProposals(process.cwd());
      if (opts.json) { writeJson(ps); return; }
      if (ps.length === 0) { writeText("(no proposals generated -- no qualifying signals)"); return; }
      writeText(`Generated ${ps.length} proposal(s):`);
      for (const p of ps) {
        writeText(`  [${p.id}] (${(p.confidence * 100).toFixed(0)}%) ${p.title}`);
      }
      writeText(``);
      writeText(`View any with: mneme evolve view <id>`);
    });

  ev.command("list")
    .description("List every persisted proposal (sorted by confidence desc). v1.27.2: shows Phase-3 synthesis state per proposal.")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const ps = evolve.listProposals(process.cwd());
      if (opts.json) { writeJson(ps); return; }
      if (ps.length === 0) { writeText("(no proposals -- run `mneme evolve propose`)"); return; }
      writeText(`Mneme proposals -- ${ps.length}`);
      // v1.27.2: read Phase-3 sidecars so the listing shows verification state inline.
      const fs = await import("node:fs");
      const path = await import("node:path");
      const dir = path.join(process.cwd(), ".mneme/proposals");
      const synths: Record<string, { verified: boolean; confidence: number; sigShort: string }> = {};
      try {
        for (const f of fs.readdirSync(dir)) {
          if (!f.endsWith(".synth.json")) continue;
          try {
            const s = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { proposalId?: string; verified?: boolean; confidence?: number; signature?: string };
            if (s.proposalId) {
              synths[s.proposalId] = {
                verified: !!s.verified,
                confidence: s.confidence ?? 0,
                sigShort: (s.signature ?? "").slice(0, 8),
              };
            }
          } catch { /* skip */ }
        }
      } catch { /* dir missing -- nothing synthesized yet */ }
      for (const p of ps) {
        const synth = synths[p.id];
        const synthBadge = synth
          ? (synth.verified
              ? `  ✓ Phase-3 VERIFIED (${(synth.confidence * 100).toFixed(0)}%, sig=${synth.sigShort})`
              : `  ✗ Phase-3 not verified`)
          : `  · Phase-3 not yet attempted`;
        writeText(`  [${p.id}] (${(p.confidence * 100).toFixed(0)}%) ${p.title}${synthBadge}`);
      }
    });

  ev.command("view <id>")
    .description("Print one proposal's full markdown.")
    .action((id: string) => {
      const md = evolve.viewProposal(process.cwd(), id);
      if (!md) { writeText(`(no proposal at id ${id})`); process.exit(1); return; }
      writeText(md);
    });

  ev.command("stats")
    .description("Aggregate stats: signal counts by kind, top recurring pattern.")
    .option("--json", "JSON output.")
    .action((opts: CommonOpts) => {
      const s = evolve.evolveStats(process.cwd());
      if (opts.json) { writeJson(s); return; }
      writeText(`Mneme evolve stats`);
      writeText(`  Total signals:    ${s.totalSignals}`);
      writeText(`  Total proposals:  ${s.totalProposals}`);
      writeText(`  By kind:`);
      for (const [k, n] of Object.entries(s.byKind)) writeText(`    ${k.padEnd(22)} ${n}`);
      writeText(`  Top pattern:      ${s.topPattern ?? "(none)"}`);
    });

  // ─── Phase 3 (v1.27.0): code synthesis ────────────────────────────
  ev.command("synthesize <id>")
    .alias("synth")
    .description("Phase 3 -- generate a verified .patch from a Phase-2 proposal. Runs template -> apply -> tsc gate -> vitest gate. Saves only if both gates pass.")
    .option("--json", "JSON output.")
    .action(async (id: string, opts: CommonOpts) => {
      const r = evolve.synthesis.synthesize(process.cwd(), id);
      if (!r) {
        // v1.27.6: synthesize() side-effect-writes a <id>.placeholder.md
        // when no template matches. Detect + report it so the user
        // knows where to look. Pre-fix the CLI just printed a flat
        // reject and the placeholder file was silent.
        const fs = await import("node:fs");
        const path = await import("node:path");
        const placeholderPath = path.join(process.cwd(), ".mneme/proposals", `${id}.placeholder.md`);
        if (fs.existsSync(placeholderPath)) {
          writeText(`No deterministic template matched proposal ${id}.`);
          writeText(``);
          writeText(`✓ Wrote a Phase-3 PLACEHOLDER scaffold for human authoring:`);
          writeText(`  ${placeholderPath}`);
          writeText(``);
          writeText(`Open it, fill in the patch by hand, then save:`);
          writeText(`  git diff > .mneme/proposals/${id}.patch`);
          writeText(`  mneme evolve apply ${id}    # records lineage + verifies HMAC chain`);
          process.exit(0); // not an error -- a structured handoff to the human
          return;
        }
        writeText(`No template matched any signal in proposal ${id}, AND proposal not found at .mneme/proposals/${id}.json.`);
        process.exit(1);
        return;
      }
      if (opts.json) { writeJson(r); return; }
      writeText(`Synthesis [${r.id}] template=${r.templateId}  file=${r.filePath}`);
      writeText(`  Working tree clean: ${r.gates.workingTreeClean ? "✓" : "✗"}`);
      writeText(`  tsc --noEmit:       ${r.gates.compileOk === null ? "(skipped)" : r.gates.compileOk ? "✓" : "✗"}`);
      writeText(`  vitest run:         ${r.gates.testsOk === null ? "(no co-located tests)" : r.gates.testsOk ? "✓" : "✗"}`);
      writeText(`  VERIFIED:           ${r.verified ? "YES (.patch saved + HMAC signed)" : "NO -- file restored to original"}`);
      writeText(`  Confidence:         ${(r.confidence * 100).toFixed(0)}%`);
      writeText(`  Signature:          ${r.signature.slice(0, 16)}...`);
      if (r.gates.errors.length > 0) {
        writeText(``);
        writeText(`Errors:`);
        for (const e of r.gates.errors) writeText(`  ${e}`);
      }
    });

  ev.command("apply <id>")
    .description("Apply a verified .patch via `git apply`. Refuses if not verified or HMAC mismatch.")
    .action((id: string) => {
      const r = evolve.synthesis.applyPatch(process.cwd(), id);
      if (!r.ok) {
        writeText(`✗ Apply failed: ${r.reason}`);
        process.exit(1);
        return;
      }
      writeText(`✓ Applied at ${r.appliedAt}. Review with \`git diff\`.`);
    });

  // ─── Phase 4 (v1.27.0): auto-PR via gh ────────────────────────────
  ev.command("auto-pr <id>")
    .description("Phase 4 -- create a real GitHub PR from a verified .patch. Branch=mneme/evolve/<id>. Requires `gh` CLI.")
    .option("--dry-run", "Detect gh + verified-patch state but don't push or open the PR.")
    .action((id: string, opts: { dryRun?: boolean }) => {
      const r = evolve.synthesis.autoPr(process.cwd(), id, { dryRun: opts.dryRun });
      if (!r.ok) {
        writeText(`✗ auto-pr: ${r.reason}`);
        process.exit(1);
        return;
      }
      writeText(`✓ auto-pr ok${r.prUrl ? `: ${r.prUrl}` : ""}`);
      if (r.reason) writeText(`  ${r.reason}`);
    });

  // ─── Patch Provenance Chain (v1.27.4) ────────────────────────────
  ev.command("lineage [templateId]")
    .description("Show the Patch Provenance Chain. Pass a templateId to filter; no arg = aggregate stats. v1.27.4 -- HMAC-chained record of every applied EVOLVE patch, scoped per template.")
    .option("--json", "JSON output.")
    .option("--verify", "Verify HMAC chain integrity.")
    .action((templateId: string | undefined, opts: { json?: boolean; verify?: boolean }) => {
      const root = process.cwd();
      if (templateId) {
        const tr = evolve.synthesis.trackRecordFor(root, templateId);
        if (opts.json) { writeJson(tr); return; }
        writeText(`Template lineage: ${tr.templateId}`);
        writeText(`  Total accepts:    ${tr.totalAccepts}`);
        writeText(`  Total reverts:    ${tr.totalReverts}`);
        writeText(`  Last applied:     ${tr.lastAppliedAt ?? "(never)"}`);
        writeText(`  Track-record:     ${(tr.score * 100).toFixed(0)}%`);
        return;
      }
      const stats = evolve.synthesis.lineageStats(root);
      if (opts.verify) {
        const v = evolve.synthesis.verifyChain(root);
        if (opts.json) { writeJson(v); return; }
        writeText(`Chain integrity: ${v.ok ? "✓ INTACT" : "✗ BROKEN at index " + v.brokenAt}`);
        writeText(`Total entries:   ${v.total}`);
        return;
      }
      if (opts.json) { writeJson(stats); return; }
      writeText(`Patch Provenance Chain -- ${stats.totalEntries} total entries`);
      writeText(`  HMAC integrity:  ${stats.chain.ok ? "✓ INTACT" : "✗ BROKEN at " + stats.chain.brokenAt}`);
      if (stats.perTemplate.length === 0) {
        writeText(`  (no templates applied yet -- run \`mneme evolve apply <id>\` to populate)`);
        return;
      }
      writeText(``);
      writeText(`Per-template track records:`);
      for (const t of stats.perTemplate) {
        writeText(`  [${(t.score * 100).toFixed(0).padStart(3)}%] ${t.templateId}`);
        writeText(`         accepts=${t.totalAccepts} · reverts=${t.totalReverts} · last=${t.lastAppliedAt?.slice(0, 10) ?? "?"}`);
      }
    });

  // ─── Phase 5 (v1.27.0): evolution pass (manual trigger) ───────────
  ev.command("pass")
    .description("Phase 5 -- run one full evolution pass: scan signals -> propose -> synthesize -> verify -> save. Usually fires from the daemon every 6h.")
    .option("--json", "JSON output.")
    .action((opts: CommonOpts) => {
      // First propose (in case scan -> propose hasn't run yet).
      evolve.generateProposals(process.cwd());
      const r = evolve.synthesis.evolutionPass(process.cwd());
      if (opts.json) { writeJson(r); return; }
      writeText(`Evolution pass complete.`);
      writeText(`  Scanned proposals:  ${r.scanned}`);
      writeText(`  Synthesized:        ${r.synthesized}`);
      writeText(`  VERIFIED (saved):   ${r.verified}`);
      for (const x of r.results) {
        writeText(`  - [${x.id}] ${x.templateId}  verified=${x.verified ? "✓" : "✗"}`);
      }
    });
}
