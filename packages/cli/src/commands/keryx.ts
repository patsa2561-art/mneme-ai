/**
 * `mneme keryx` (v2.213.0) — KERYX, the gate-as-a-service relay protocol surface.
 * The PROTOCOL is shipped + measured (keryxGauntlet=100). The hosted relay server + per-
 * provider webhook adapters (LINE / Slack / Discord) deploy on top of `gephyra serve`.
 *   keryx demo            — show a signed ask/answer envelope round-trip
 *   keryx verify <file>   — verify an envelope JSON offline (needs --secret)
 *   keryx status          — protocol + gauntlet status
 */
import type { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { keryx } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }

export function registerKeryxCommands(program: Command): void {
  const k = program.command("keryx").description("🏛 KERYX — the herald: a dumb, signed relay so ANY chat (LINE/Slack/Discord/Telegram) can reach your local agent behind NAT. Only a summary+hash crosses; answers are signed + replay-proof.");

  k.command("status", { isDefault: true }).description("Protocol + gauntlet status.").action(() => {
    const g = keryx.keryxGauntlet();
    out(`🏛 KERYX protocol — gauntlet ${g.score}/100 (${g.checks.filter((c) => c.pass).length}/${g.checks.length}). Channel-agnostic, signed, replay-proof, raw-free.`);
    out("   Deploy the relay on `gephyra serve` (your DO droplet); the daemon connects OUT (behind NAT). See docs/KERYX.md.");
  });

  k.command("demo").description("Show a signed ask→answer round-trip (no network).").action(() => {
    const secret = "demo-daemon-key", now = Date.now();
    const ask = keryx.buildAsk(secret, { id: "demo1", channel: "line", summary: "Deploy to prod?", rawCommand: "kubectl apply -f prod.yaml", nonce: "n1", now });
    const ans = keryx.buildAnswer(secret, ask, "deny", now + 1500);
    out("ASK (agent → human, via relay):"); out("  " + JSON.stringify({ kind: ask.kind, channel: ask.channel, payload: ask.payload, commandHash: ask.commandHash.slice(0, 12) + "…", sig: ask.sig.slice(0, 12) + "…" }));
    out("  raw command NEVER crosses · verify offline: " + keryx.verifyEnvelope(secret, ask, now + 100).ok);
    out("ANSWER (human → agent, via relay):"); out("  " + JSON.stringify({ kind: ans.kind, payload: ans.payload, boundToAsk: ans.id === ask.id }));
    out("  forged by relay (wrong key)? " + keryx.verifyEnvelope("wrong", ask, now + 100).ok + "  ← the relay can route but never fabricate");
  });

  k.command("verify <file>").description("Verify an envelope JSON offline.").requiredOption("--secret <s>", "the daemon shared key")
    .action((file: string, o: { secret: string }) => {
      if (!existsSync(file)) { out("file not found"); process.exitCode = 2; return; }
      try { const e = JSON.parse(readFileSync(file, "utf8")); const r = keryx.verifyEnvelope(o.secret, e, Date.now()); out(`${r.ok ? "✓" : "✗"} ${r.reason}`); if (!r.ok) process.exitCode = 2; }
      catch { out("✗ invalid envelope JSON"); process.exitCode = 2; }
    });
}
