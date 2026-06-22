/**
 * `mneme launch` (v3.135.0) — THE PR ENGINE. Generate a launch kit (Hacker News · X
 * thread · Reddit · changelog) where EVERY claim is VERICERT-screened first — an
 * overclaiming / fabricated / unfalsifiable-superlative line is rejected and never
 * ships. Launch copy that can't lie. With no --claim flags it uses Mneme's own
 * measured claims (dogfood). `--json` for the structured kit.
 */

import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { prEngine } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }

const DEFAULT_CLAIMS = [
  "Deterministic, MIT-licensed, local-first — no LLM in the analysis path.",
  "A poisoned cross-agent context entry is never inherited (measured: 0 leaks).",
  "Every PR gets one grounded comment: a check of the description, context for each changed file (cited), and the author's commit persona.",
  "Paste any public repo for a signed report, the team's commit personas, or why a file is the way it is — no install.",
  "Vendor-neutral via MCP and a CLI; the source never leaves your machine.",
];

export function registerLaunchCommands(program: Command): void {
  program
    .command("launch")
    .description("📣 PR ENGINE — generate a launch kit (HN · X · Reddit · changelog) where every claim is VERICERT-screened first; overclaims & unfalsifiable superlatives are rejected and never ship. Launch copy that can't lie. No --claim flags → uses Mneme's own measured claims.")
    .option("--product <name>", "product name", "Mneme")
    .option("--release <v>", "release/version label")
    .option("--url <u>", "try-it URL", "https://xray.mneme-ai.space")
    .option("--install <cmd>", "install command", "npm i -g mneme-ai")
    .option("--claim <text>", "a candidate claim (repeatable)", (v: string, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
    .option("--claims-file <path>", "read candidate claims, one per line")
    .option("--json", "JSON output (the full kit)")
    .action((o: { product: string; release?: string; url: string; install: string; claim: string[]; claimsFile?: string; json?: boolean }) => {
      let claims = o.claim && o.claim.length ? o.claim : [];
      if (o.claimsFile) { try { claims = claims.concat(readFileSync(o.claimsFile, "utf8").split("\n").map((s) => s.trim()).filter(Boolean)); } catch { /* */ } }
      if (!claims.length) claims = DEFAULT_CLAIMS;
      const kit = prEngine.buildLaunchKit({ product: o.product, version: o.release, url: o.url, install: o.install, claims });
      if (o.json) { out(JSON.stringify(kit, null, 2)); return; }
      out(`📣 LAUNCH KIT — ${o.product}  (${kit.approved.length} claims approved · ${kit.rejected.length} rejected · ${kit.clean ? "✓ zero-overclaim" : "⚠ overclaim leaked"})`);
      if (kit.rejected.length) { out(`\n  ✗ rejected (won't ship):`); for (const r of kit.rejected) out(`     [${r.reason}] ${r.claim}`); }
      out(`\n━━ Hacker News ━━\n${kit.hn.title}\n\n${kit.hn.body}`);
      out(`\n━━ X / Twitter thread ━━`); kit.x.forEach((t, i) => out(`${i + 1}/ ${t}`));
      out(`\n━━ Reddit ━━\n${kit.reddit.title}\n\n${kit.reddit.body}`);
      out(`\n━━ Changelog ━━\n${kit.changelog}`);
      out(`\n  📣 every line above passed VERICERT — defensible, not hype. (Honest: screens known overclaim patterns, doesn't make a claim true.)`);
    });
}
