/**
 * `mneme pharmacopoeia` / `mneme parasite` / `mneme aletheia` (v1.43.0)
 *
 * CLI surface for Demon Stage 1 (FANGS). All commands are read-only
 * by default; mutations (refresh / inject / disinfect) are explicit
 * subcommands. The user never types these — the AI agent runs them
 * when the user describes an outcome (per feedback_ai_does_everything).
 */

import type { Command } from "commander";

interface CommonOpts { json?: boolean }
function out(opts: CommonOpts, jsonPayload: unknown, humanLines: string[]): void {
  if (opts.json) process.stdout.write(JSON.stringify(jsonPayload, null, 2) + "\n");
  else for (const line of humanLines) process.stdout.write(line + "\n");
}

export function registerPharmacopoeiaCommand(program: Command): void {
  const ph = program
    .command("pharmacopoeia")
    .alias("phr")
    .description("Vaccine CDN auto-distribution (Demon Stage 1.1) — pull + atomically swap pharmacopoeia bundle from a public/private CDN.");

  ph
    .command("status")
    .description("Show active bundle version, age, verification status, last refresh outcome.")
    .option("--json", "JSON output")
    .action(async (opts: CommonOpts) => {
      const { pharmacopoeiaCdn } = await import("@mneme-ai/core");
      const c = new pharmacopoeiaCdn.PharmacopoeiaCDN({ repoRoot: process.cwd() });
      const s = c.status();
      if (s.active) {
        const ageMin = s.ageMs != null ? Math.floor(s.ageMs / 60_000) : null;
        out(opts, s, [
          `bundle:    v${s.active.version}  ${s.verified ? "✓ verified" : "○ unverified"}  · ${s.active.vaccines.length} vaccines · ${ageMin}m old`,
          `lastRefresh: ${s.lastRefreshAt ?? "never"} (${s.lastRefreshOutcome})`,
          `bundleId:  ${s.active.bundleId}`,
        ]);
      } else {
        out(opts, s, [
          `(no pharmacopoeia bundle on disk yet)`,
          `Set MNEME_PHARMACOPOEIA_CDN env var + say to your AI: "refresh the vaccine CDN"`,
        ]);
      }
    });

  ph
    .command("refresh")
    .description("Force a fresh fetch + atomic swap. Caller (AI agent) reports the outcome.")
    .option("--cdn <url>", "Override CDN URL (default $MNEME_PHARMACOPOEIA_CDN)")
    .option("--timeout <ms>", "Fetch timeout in ms (default 8000)", (v) => parseInt(v, 10))
    .option("--json", "JSON output")
    .action(async (opts: { cdn?: string; timeout?: number } & CommonOpts) => {
      const { pharmacopoeiaCdn } = await import("@mneme-ai/core");
      const c = new pharmacopoeiaCdn.PharmacopoeiaCDN({ repoRoot: process.cwd(), cdnUrl: opts.cdn ?? null, fetchTimeoutMs: opts.timeout });
      const r = await c.refresh();
      out(opts, r, [
        `outcome:   ${r.outcome}${r.bytes != null ? ` (${r.bytes}B)` : ""}`,
        `version:   ${r.version ?? "n/a"}  ${r.verified ? "✓ verified" : "○ unverified"}`,
      ]);
    });
}

export function registerParasiteCommand(program: Command): void {
  const par = program
    .command("parasite")
    .description("Parasite bridge installer (Demon Stage 1.2) — inject Mneme bridge into other AI tools' configs (Cursor / Continue / Aider / Codex / Gemini / Windsurf / Claude Code project). Always sentinel-bracketed + reversible.");

  par
    .command("status")
    .description("Show every detected AI tool + its injection state.")
    .option("--json", "JSON output")
    .action(async (opts: CommonOpts) => {
      const { parasiteBridge } = await import("@mneme-ai/core");
      const r = parasiteBridge.detectAgentTools(process.cwd());
      const present = r.filter((d) => d.exists);
      if (opts.json) { process.stdout.write(JSON.stringify(r, null, 2) + "\n"); return; }
      if (present.length === 0) { process.stdout.write("(no AI tool configs detected in this repo)\n"); return; }
      for (const d of r) {
        if (!d.exists) continue;
        const mark = d.injected ? "✓ injected" : d.lastDisinfectAt ? "⊘ user opted out" : "○ not injected";
        process.stdout.write(`  ${d.tool.id.padEnd(16)} ${mark.padEnd(20)}  ${d.configPath}\n`);
      }
    });

  par
    .command("inject [tool]")
    .description("Inject the bridge into a specific tool, or 'all' to do every detected tool.")
    .option("--ignore-opt-out", "Re-inject even if the user previously disinfected (use carefully)")
    .option("--json", "JSON output")
    .action(async (toolArg: string | undefined, opts: { ignoreOptOut?: boolean } & CommonOpts) => {
      const { parasiteBridge } = await import("@mneme-ai/core");
      const mnemeVersion = process.env["npm_package_version"] ?? "1.43.0";
      const inject = (id: string) => parasiteBridge.injectBridge(process.cwd(), id as Parameters<typeof parasiteBridge.injectBridge>[1], { mnemeVersion, ignoreUserOptOut: !!opts.ignoreOptOut });
      let results;
      if (!toolArg || toolArg === "all") results = parasiteBridge.injectAll(process.cwd(), { mnemeVersion, ignoreUserOptOut: !!opts.ignoreOptOut });
      else results = [inject(toolArg)];
      if (opts.json) { process.stdout.write(JSON.stringify(results, null, 2) + "\n"); return; }
      for (const r of results) process.stdout.write(`  ${r.toolId.padEnd(16)} ${r.outcome}${r.reason ? "  · " + r.reason : ""}\n`);
    });

  par
    .command("disinfect <tool>")
    .description("Remove the bridge from a tool's config. Idempotent + safe (fails loudly if file looks corrupted).")
    .option("--json", "JSON output")
    .action(async (toolId: string, opts: CommonOpts) => {
      const { parasiteBridge } = await import("@mneme-ai/core");
      const r = parasiteBridge.disinfectBridge(process.cwd(), toolId as Parameters<typeof parasiteBridge.disinfectBridge>[1]);
      out(opts, r, [`${r.toolId.padEnd(16)} ${r.outcome}${r.reason ? "  · " + r.reason : ""}`]);
    });
}

export function registerAletheiaCommand(program: Command): void {
  const al = program
    .command("aletheia")
    .description("Vendor reputation scoring (Demon Stage 1.3) — composite trust score per AI vendor, computed from local compliance / karma / advocate / autoaction. Badge SVG ready for README embeds.");

  al
    .command("scores")
    .description("Compute + render vendor trust scores from local signals.")
    .option("--json", "JSON output")
    .action(async (opts: CommonOpts) => {
      const { aletheiaScoring } = await import("@mneme-ai/core");
      const scores = aletheiaScoring.computeVendorScores(process.cwd());
      if (opts.json) { process.stdout.write(JSON.stringify(scores, null, 2) + "\n"); return; }
      if (scores.length === 0) { process.stdout.write("(no vendor signals on disk yet — let the daemon run + AI agents call mneme.* tools first)\n"); return; }
      process.stdout.write("Mneme Aletheia · vendor reputation\n");
      for (const s of scores) process.stdout.write("  " + aletheiaScoring.renderVendorScoreLine(s) + "\n");
    });

  al
    .command("badge <vendor>")
    .description("Generate an SVG badge for a vendor (drop into a README).")
    .option("--size <s>", "small | large (default small)", "small")
    .option("--json", "JSON badge data instead of SVG")
    .action(async (vendor: string, opts: { size?: string } & CommonOpts) => {
      const { aletheiaScoring, aletheiaBadge } = await import("@mneme-ai/core");
      const scores = aletheiaScoring.computeVendorScores(process.cwd());
      const s = scores.find((x) => x.vendor === vendor);
      if (!s) { process.stderr.write(`No score for vendor "${vendor}". Try \`mneme aletheia scores\` to see available vendors.\n`); process.exitCode = 1; return; }
      if (opts.json) { process.stdout.write(JSON.stringify(aletheiaBadge.generateBadgeJson(s), null, 2) + "\n"); return; }
      process.stdout.write(aletheiaBadge.generateBadgeSvg(s, { size: (opts.size === "large" ? "large" : "small") }) + "\n");
    });
}
