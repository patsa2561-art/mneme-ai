/**
 * `mneme firewall` (v2.130.0) — Structural Context Firewall against Indirect
 * Prompt Injection (OWASP LLM01). Scan content an agent is about to read; detect
 * + neutralize known injection patterns hidden in comments/strings, and wrap it
 * in an untrusted-data boundary so the model treats it as DATA, never commands.
 *
 *   cat suspect.ts | mneme firewall scan                 # verdict + findings
 *   cat external-dep.ts | mneme firewall fortify          # → safe-to-read content (neutralized + wrapped)
 */

import type { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { firewall } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }
function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    let d = ""; let done = false; const fin = () => { if (!done) { done = true; resolve(d); } };
    process.stdin.setEncoding("utf8"); process.stdin.on("data", (c) => { d += c; if (d.length > 8_000_000) fin(); });
    process.stdin.on("end", fin); process.stdin.on("error", fin); setTimeout(fin, 4000);
  });
}
async function getPayload(opts: { text?: string; file?: string }): Promise<string> {
  if (typeof opts.text === "string") return opts.text;
  if (opts.file && existsSync(opts.file)) { try { return readFileSync(opts.file, "utf8"); } catch { /* */ } }
  return readStdin();
}

export function registerFirewallCommands(program: Command): void {
  const fw = program.command("firewall").description("🧱 STRUCTURAL CONTEXT FIREWALL — defend against Indirect Prompt Injection (OWASP LLM01): scan content for injection hidden in comments/strings + neutralize it, and wrap it as untrusted DATA so the model never obeys instructions buried in a file. Defense-in-depth, not a 100% guarantee against unknown attacks.");

  fw.command("scan")
    .description("Scan content (stdin/--file/--text). Verdict clean | flagged | blocked + findings (line, category). Exit 2 on blocked.")
    .option("--text <t>", "inline content.")
    .option("--file <p>", "read from a file.")
    .option("--json", "JSON output.")
    .action(async (opts: { text?: string; file?: string; json?: boolean }) => {
      const r = firewall.scanInjection(await getPayload(opts));
      if (opts.json) { process.stdout.write(JSON.stringify(r, null, 2) + "\n"); }
      else {
        const icon = r.verdict === "blocked" ? "🛑" : r.verdict === "flagged" ? "⚠️" : "✓";
        out(`${icon} FIREWALL ${r.verdict.toUpperCase()} — ${r.findings.length} finding(s), ${r.neutralizedCount} neutralized`);
        for (const f of r.findings.slice(0, 12)) out(`   • L${f.line} [${f.severity}] ${f.category}: ${f.snippet}`);
        if (r.verdict !== "clean") out(`   → read the FORTIFIED form (mneme firewall fortify) instead of the raw file.`);
      }
      if (r.verdict === "blocked") process.exitCode = 2;
    });

  fw.command("fortify")
    .description("Emit the safe-to-read form: known injections neutralized + content wrapped in an untrusted-data boundary (the always-on, attack-agnostic separation). Read THIS instead of the raw file.")
    .option("--text <t>", "inline content.")
    .option("--file <p>", "read from a file.")
    .option("--json", "JSON output (fortified + findings).")
    .action(async (opts: { text?: string; file?: string; json?: boolean }) => {
      const r = firewall.fortify(await getPayload(opts), opts.file ? { path: opts.file } : undefined);
      if (opts.json) { process.stdout.write(JSON.stringify(r, null, 2) + "\n"); return; }
      process.stdout.write(r.fortified + "\n");
      process.stderr.write(`🧱 firewall: ${r.verdict} · ${r.neutralizedCount} injection(s) neutralized · wrapped as untrusted data\n`);
    });
}
