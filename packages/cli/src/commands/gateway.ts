/**
 * `mneme gateway` (v2.146.0) — THE INTENT GATEWAY. Type free natural language
 * (any language, EN/Thai); the Gateway picks the right Mneme command, compiles a
 * runnable invocation, or asks to clarify when it's unsure. Users never memorize
 * a command.
 *
 *   mneme gateway "stop all the bots, something feels off"
 *   mneme gateway "ดูแลเรื่องงบ 5 หมื่น ห้ามโพสต์ด่าใคร ปล่อยบอทเลย"
 *   mneme gateway bench     # the signed before→after accuracy benchmark
 */

import type { Command } from "commander";
import { intentGateway as gw, notary } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }

export function registerGatewayCommands(program: Command): void {
  const g = program
    .command("gateway")
    .alias("interpret")
    .argument("[text...]", "free natural language — any language")
    .description("🧭 INTENT GATEWAY — type free natural language (any language, EN/Thai); Mneme picks the RIGHT command for the best result, compiles a runnable invocation, or asks to clarify when unsure (never a confident misfire). You never memorize a command. Curated bilingual concept-map + IDF catalog fallback + abstention; measured (see `mneme gateway bench`).")
    .option("--json", "JSON output (signed)")
    .action((text: string[] | undefined, opts: { json?: boolean }) => {
      const q = Array.isArray(text) ? text.join(" ") : String(text ?? "");
      if (!q.trim()) { out("usage: mneme gateway \"<what you want, in your own words>\""); process.exitCode = 2; return; }
      const r = gw.route(q);
      let receipt: unknown = null;
      try { receipt = notary.issueReceipt(process.cwd(), { kind: "claim-verdict", subject: `gateway:${r.verdict}`, payload: { verdict: r.verdict, command: r.command, confidence: r.confidence }, includePayload: true }); } catch { /* */ }
      if (opts.json) { out(JSON.stringify({ ...r, signed: receipt }, null, 2)); process.exitCode = r.verdict === "ROUTED" ? 0 : 2; return; }
      if (r.verdict === "ROUTED") {
        out(`🟢 ${r.command}   (confidence ${(r.confidence * 100).toFixed(0)}%)`);
        if (r.invocation && r.invocation !== r.command) out(`   → run:  ${r.invocation}`);
        const e = r.entities; const ent: string[] = [];
        if (e.budget) ent.push(`budget=${e.budget}`); if (e.forbidden?.length) ent.push(`forbidden=${e.forbidden.join(",")}`); if (e.scope?.length) ent.push(`scope=${e.scope.join(",")}`);
        if (ent.length) out(`   detected: ${ent.join(" · ")}`);
      } else if (r.verdict === "CLARIFY") {
        out(`❔ Not sure — did you mean one of these?`);
        for (const c of r.candidates) out(`   • ${c.command}  (${(c.score).toFixed(2)})`);
      } else {
        out(`❔ I couldn't map that to a Mneme command — try rephrasing, or 'mneme gateway bench' / 'mneme boot' to see what's possible.`);
      }
      process.exitCode = r.verdict === "ROUTED" ? 0 : 2;
    });

  g.command("bench")
    .description("the signed before→after accuracy benchmark (new Gateway vs the old keyword router) over a labeled EN+Thai corpus.")
    .option("--json", "JSON output")
    .action((opts: { json?: boolean }) => {
      const b = gw.benchmark();
      let receipt: unknown = null;
      try { receipt = notary.issueReceipt(process.cwd(), { kind: "reasoning-trace", subject: `gateway.bench:${(b.newAcc * 100).toFixed(0)}pct`, payload: { newAcc: b.newAcc, oldAcc: b.oldAcc, n: b.n }, includePayload: true }); } catch { /* */ }
      if (opts.json) { out(JSON.stringify({ ...b, signed: receipt }, null, 2)); return; }
      out(`🧭 INTENT GATEWAY — accuracy on ${b.n} labeled EN+Thai queries:`);
      out(`   NEW gateway: ${b.newTop1}/${b.n} top-1 = ${(b.newAcc * 100).toFixed(0)}%`);
      out(`   OLD keyword: ${b.oldTop1}/${b.n} top-1 = ${(b.oldAcc * 100).toFixed(0)}%`);
      out(`   abstained (asked to clarify): ${b.abstained}`);
      if (b.newMisses.length) { out("   remaining misses:"); for (const m of b.newMisses) out(`     ${m}`); }
      out(`   ${receipt ? "✓ signed · " : ""}measured + re-runnable; 100% NL routing is impossible — the target is high top-1 + abstain on the rest.`);
    });
}
