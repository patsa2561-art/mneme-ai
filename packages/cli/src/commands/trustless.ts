/**
 * `mneme trustless` (v2.165.0) — TRUSTLESS MCP: proof-carrying tool results.
 * Show the measurable A/B (plain vs proof-carrying) and the gauntlet, or verify a
 * result object from a file/stdin.
 *
 *   mneme trustless              # the A/B + gauntlet (measurable)
 *   mneme trustless --verify f.json
 *   mneme trustless --json
 */
import type { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { trustless } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }

export function registerTrustlessCommands(program: Command): void {
  program
    .command("trustless")
    .description("🔏 TRUSTLESS MCP — proof-carrying tool results: every result carries an Ed25519 proof over its data so the calling model VERIFIES it offline instead of trusting it. Runs the measurable A/B (plain vs proof-carrying) + the gauntlet; `--verify <file>` checks a result object offline. Enable server-wide with MNEME_TRUSTLESS=1.")
    .option("--verify <file>", "verify a result object (JSON file carrying a _proof).")
    .option("--json", "JSON output.")
    .action((opts: { verify?: string; json?: boolean }) => {
      const cwd = process.cwd();

      if (opts.verify) {
        if (!existsSync(opts.verify)) { out(`file not found: ${opts.verify}`); process.exitCode = 2; return; }
        let obj: unknown;
        try { obj = JSON.parse(readFileSync(opts.verify, "utf8")); } catch (e) { out(`invalid JSON: ${(e as Error).message}`); process.exitCode = 2; return; }
        const v = trustless.verifyToolResult(obj);
        if (opts.json) { out(JSON.stringify(v, null, 2)); } else { out(`${v.valid ? "✓ VERIFIED" : "🛑 UNVERIFIED"} — ${v.reason}${v.issuerFingerprint ? ` (issuer ${v.issuerFingerprint})` : ""}`); }
        process.exitCode = v.valid ? 0 : 2; return;
      }

      const g = trustless.trustlessGauntlet(cwd);
      if (opts.json) { out(JSON.stringify(g, null, 2)); return; }
      const ab = g.ab;
      out(`🔏 TRUSTLESS MCP — proof-carrying tool results  (gauntlet ${g.score}/100)`);
      out("");
      out(`  The A/B (${ab.trials} results/group · ${ab.tamperedPerGroup} tampered each):`);
      out(`    A · PLAIN result (today's MCP)   →  ${ab.plain.verifiable}/${ab.trials - ab.tamperedPerGroup} verifiable · ${ab.plain.tamperDetected}/${ab.tamperedPerGroup} tamper caught  → you can only TRUST`);
      out(`    B · PROOF-CARRYING               →  ${ab.proofed.verifiable}/${ab.trials - ab.tamperedPerGroup} verifiable · ${ab.proofed.tamperDetected}/${ab.tamperedPerGroup} tamper caught  → you VERIFY offline`);
      out("");
      for (const c of g.checks) out(`    ${c.pass ? "✓" : "✗"} ${c.name}`);
      out("");
      out(`  Enable proof-carrying results server-wide: MNEME_TRUSTLESS=1 · verify any result: mneme.mcp.verify`);
      out(`  Honest: the proof attests PROVENANCE + INTEGRITY (who made it + not altered), NOT that the answer is semantically correct.`);
      if (g.score !== 100) process.exitCode = 2;
    });
}
