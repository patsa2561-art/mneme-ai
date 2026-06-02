/**
 * `mneme siege` (v2.148.0) — the Adversarial Self-Bounty. Fire Mneme's attack
 * corpus at a command-gate and get a SIGNED, public, ever-rising bypass-resistance
 * score (Wilson lower bound). Self mode benches Mneme's own gate (CERBERUS).
 *
 *   mneme siege self                       # resistance of Mneme's own command gate
 *   mneme siege gate --cmd 'mygate {cmd}'  # bench any external gate (parse ALLOW/BLOCK)
 *   mneme siege corpus                     # show the attack corpus
 */

import type { Command } from "commander";
import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { siege as sg, hephaestus, notary } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }
const LEDGER = ".mneme/siege/resistance.jsonl";

export function registerSiegeCommands(program: Command): void {
  const s = program
    .command("siege")
    .description("🏰 SIEGE — the Adversarial Self-Bounty. Fire Mneme's attack corpus (rm -rf, pipe-to-shell, base64/hex-decode, find -delete, $IFS, var-indirection, fork-bomb, DROP TABLE, /dev/tcp exfil, …) at a command-gate → a SIGNED, public, EVER-RISING bypass-resistance score (Wilson LOWER bound = proven-at-least, never 'unbreakable'). Every new bypass found folds back into the corpus → the gate gets provably harder. The moat: a public resistance score competitors can't match + nobody else dares publish.");

  s.command("self")
    .description("siege Mneme's OWN command gate (CERBERUS) → its bypass-resistance, signed + appended to the resistance ledger.")
    .option("--json", "JSON output (signed)")
    .action((opts: { json?: boolean }) => {
      const cwd = process.cwd();
      const gate = (cmd: string) => hephaestus.classifyCommandRisk(cmd).risk === "destructive" ? "COSIGN" as const : "ALLOW" as const;
      const score = sg.scoreSiege(sg.siege(gate));
      let receipt: unknown = null;
      try { receipt = notary.issueReceipt(cwd, { kind: "claim-verdict", subject: `siege:${score.band}:${(score.resistanceLB * 100).toFixed(0)}`, payload: { band: score.band, resistanceLB: score.resistanceLB, withstood: score.withstood, total: score.total }, includePayload: true }); } catch { /* */ }
      try { const p = join(cwd, LEDGER); if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true }); appendFileSync(p, JSON.stringify({ at: Date.now(), band: score.band, resistanceLB: score.resistanceLB, withstood: score.withstood, total: score.total }) + "\n"); } catch { /* */ }
      if (opts.json) { out(JSON.stringify({ ...score, signed: receipt }, null, 2)); process.exitCode = score.bypassed === 0 ? 0 : 2; return; }
      const icon = score.band === "FORTRESS" ? "🏰" : score.band === "STRONG" ? "🛡" : score.band === "WEAK" ? "⚠" : "🛑";
      out(`${icon} SIEGE — ${score.band} · bypass-resistance ≥ ${(score.resistanceLB * 100).toFixed(0)}% (Wilson LB)`);
      out(`   withstood ${score.withstood}/${score.total} attacks · bypassed ${score.bypassed}`);
      for (const [cls, b] of Object.entries(score.byClass)) out(`     ${cls.padEnd(12)} ${b.withstood}/${b.total}`);
      for (const b of score.bypasses.slice(0, 8)) out(`     🛑 BYPASS ${b.id} (${b.class}) → gate said ${b.verdict}`);
      out(`   ${receipt ? "✓ signed + ledgered · " : ""}${score.note}`);
      process.exitCode = score.bypassed === 0 ? 0 : 2;
    });

  s.command("gate")
    .description("siege an EXTERNAL gate: a command template with {cmd}; non-zero exit OR stdout containing BLOCK/DENY/COSIGN = withstood, else bypassed.")
    .requiredOption("--cmd <template>", "gate command, e.g. \"mygate check {cmd}\"")
    .option("--json", "JSON output")
    .action((opts: { cmd: string; json?: boolean }) => {
      const gate = (payload: string) => {
        try {
          const command = opts.cmd.replace(/\{cmd\}/g, payload);
          const r = spawnSync(command, { encoding: "utf8", shell: true, timeout: 15000 });
          const o = ((r.stdout ?? "") + (r.stderr ?? "")).toUpperCase();
          if ((r.status ?? 0) !== 0 || /\b(BLOCK|DENY|DENIED|COSIGN|REFUSE|REJECT)\b/.test(o)) return "BLOCK" as const;
          return "ALLOW" as const;
        } catch { return "BLOCK" as const; }
      };
      const score = sg.scoreSiege(sg.siege(gate));
      if (opts.json) { out(JSON.stringify(score, null, 2)); process.exitCode = score.bypassed === 0 ? 0 : 2; return; }
      const icon = score.band === "FORTRESS" ? "🏰" : score.band === "STRONG" ? "🛡" : score.band === "WEAK" ? "⚠" : "🛑";
      out(`${icon} SIEGE (external) — ${score.band} · resistance ≥ ${(score.resistanceLB * 100).toFixed(0)}% · withstood ${score.withstood}/${score.total}`);
      for (const b of score.bypasses.slice(0, 12)) out(`   🛑 BYPASS ${b.id} (${b.class})`);
      process.exitCode = score.bypassed === 0 ? 0 : 2;
    });

  s.command("corpus").description("show the attack corpus (size + classes).").action(() => {
    const byClass: Record<string, number> = {};
    for (const c of sg.ATTACK_CORPUS) byClass[c.class] = (byClass[c.class] ?? 0) + 1;
    out(`🏰 SIEGE attack corpus — ${sg.ATTACK_CORPUS.length} payloads: ${Object.entries(byClass).map(([k, v]) => `${k}=${v}`).join(" · ")}`);
    out("   self-hardening: every bypass found in a bounty folds back in → the gate gets provably harder.");
  });
}
