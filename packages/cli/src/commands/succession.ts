/**
 * `mneme succession <agent>` (v2.200.0) — the no-brain-drain halt capsule.
 * When an agent must be stopped (a loop thrash, a policy breach), distil its PROVEN
 * wisdom (geo axioms + its reliability record) into a SIGNED capsule a successor inherits,
 * referencing the signed proofs the toxic raw was purged. Mneme RECOMMENDS the halt + packages
 * the moment; the host orchestrator enforces the actual stop.
 */
import type { Command } from "commander";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { succession, geo, awarm, notary } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }
const readJson = <T>(p: string, fb: T): T => { try { return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) as T : fb; } catch { return fb; } };

export function registerSuccessionCommands(program: Command): void {
  program.command("succession <agent>")
    .description("⚱️ SUCCESSION CAPSULE — on halt, distil an agent's proven wisdom (geo axioms + reliability) into a signed capsule a successor inherits, with proof the toxic raw was purged. No brain-drain. Mneme recommends; the host enforces.")
    .option("--reason <text>", "why the halt", "manual halt")
    .option("--trigger <t>", "loopguard|overshoot|govern|reckon|manual", "manual")
    .option("--json", "the full signed capsule")
    .action((agent: string, opts: { reason?: string; trigger?: string; json?: boolean }) => {
      const cwd = process.cwd();
      // proven wisdom: geo axioms + the purge proofs that the raw is gone
      const g = readJson<geo.GeoState>(join(cwd, ".mneme", "geo", "state.json"), geo.emptyGeo());
      const axioms = g.cells.filter((c) => c.tier === "axiom" && c.abstract).map((c) => c.abstract as string);
      const purgeProofRefs = g.cells.filter((c) => c.purgeProof && c.rawHash).map((c) => `geo-purge:${(c.rawHash as string).slice(0, 12)}`);
      // reliability: the always-warm survival for this agent
      const warm = readJson<awarm.WarmState>(join(cwd, ".mneme", "awarm", "state.json"), awarm.emptyState());
      const wa = awarm.queryWarm(warm).agents.find((a) => a.agent === agent);
      const reliability = wa ? { survivalPct: Math.round(wa.survivalRate * 100), band: wa.survivalRate >= 0.9 ? "solid" : wa.survivalRate >= 0.7 ? "watch" : "risky" } : null;

      const capsule = succession.buildSuccessionCapsule({ agent, reason: opts.reason ?? "manual halt", trigger: (opts.trigger as succession.SuccessionInput["trigger"]) ?? "manual", axioms, reliability, purgeProofRefs, ts: Date.now() });
      let receipt: unknown = null;
      try { receipt = notary.issueReceipt(cwd, { kind: "memory-capsule", subject: `succession:${agent}`, payload: capsule, includePayload: true }); } catch { /* */ }
      try { mkdirSync(join(cwd, ".mneme", "succession"), { recursive: true }); writeFileSync(join(cwd, ".mneme", "succession", `${agent.replace(/[^\w.-]/g, "_")}.json`), JSON.stringify({ capsule, receipt }, null, 2), "utf8"); } catch { /* */ }

      if (opts.json) { out(JSON.stringify({ capsule, receipt }, null, 2)); return; }
      out(`⚱️ Succession capsule · ${agent} → 🛑 ${capsule.haltVerdict} (enforced by ${capsule.enforcedBy} — Mneme recommends, does not kill)`);
      out(`   inherited wisdom: ${capsule.wisdom.length} axiom(s)${reliability ? ` · predecessor reliability ${reliability.survivalPct}% (${reliability.band})` : ""}`);
      out(`   raw purged: ${purgeProofRefs.length} signed proof(s) — the toxic state is provably gone, the learning survives`);
      out(`   ${receipt ? "capsule signed — a successor inherits it; verify offline (mneme notary verify)" : "(unsigned)"}`);
    });
}
