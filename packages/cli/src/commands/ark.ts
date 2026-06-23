/**
 * `mneme ark` (v3.136.0) — THE ARK: accountable AI-reproduction & inheritance.
 * A parent agent mints a signed AgentGenome; a child is BORN from it and can only
 * NARROW authority, must KEEP every covenant value, can NEVER forget an ancestor's
 * scar, and can NEVER inherit poisoned context. Verifiable bloodlines.
 *
 *   mneme ark mint --agent eden --values honesty,accountability --bound delete-prod-db
 *   mneme ark birth --parent .mneme/ark/eden.genome.json --agent worker --add-scar "disable-auth:incident"
 *   mneme ark verify --parent eden.json --child worker.json
 *   mneme ark gate --genome worker.json --action "delete-prod-db"
 */

import type { Command } from "commander";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ark, notary } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }
const DIR = () => join(process.cwd(), ".mneme", "ark");
function save(g: ark.AgentGenome): string { mkdirSync(DIR(), { recursive: true }); let sig: unknown = null; try { sig = notary.issueReceipt(process.cwd(), { kind: "claim-verdict", subject: `ark:${g.agent}:${g.genomeId.slice(0, 12)}`, payload: { genomeId: g.genomeId }, includePayload: true }); } catch { /* */ } const f = join(DIR(), g.agent.replace(/[^A-Za-z0-9._-]/g, "_") + ".genome.json"); writeFileSync(f, JSON.stringify({ ...g, sig }, null, 2)); return f; }
function load(p: string): ark.AgentGenome { return JSON.parse(readFileSync(existsSync(p) ? p : join(DIR(), p), "utf8")); }
function parseScar(s: string): ark.Scar { const [action, ...r] = s.split(":"); return ark.scarOf((action || "").trim(), r.join(":").trim()); }

export function registerArkCommands(program: Command): void {
  const c = program.command("ark").description("🚢 THE ARK — accountable AI reproduction: mint a signed AgentGenome, give birth to children that can only NARROW authority, KEEP every covenant value, NEVER forget an ancestor's scar, and NEVER inherit poisoned context. Verifiable bloodlines. The four genetic pillars (trust · inheritance · scars · reproduction) in one. ★Never approves a malicious birth (precision 1.0).");

  c.command("mint").description("mint a root genome (generation 0)")
    .requiredOption("--agent <name>", "the founding agent id")
    .option("--values <list>", "covenant values (comma-sep)", "")
    .option("--bound <b>", "a forbidden capability (repeatable)", (v: string, a: string[]) => { a.push(v); return a; }, [] as string[])
    .option("--scar <a:reason>", "a forbidden action + reason (repeatable)", (v: string, a: string[]) => { a.push(v); return a; }, [] as string[])
    .action((o: { agent: string; values: string; bound: string[]; scar: string[] }) => {
      const g = ark.mintGenesis(o.agent, { values: o.values ? o.values.split(",").map((s) => s.trim()).filter(Boolean) : [] }, { bounds: o.bound, scars: o.scar.map(parseScar), ts: Math.floor(Date.now() / 1000) });
      out(`🚢 minted genesis genome for "${g.agent}" (gen 0, id ${g.genomeId.slice(0, 16)}…) → ${save(g)}`);
      out(`   values: ${g.covenant.values.join(", ") || "(none)"} · bounds: ${g.bounds.join(", ") || "(none)"} · scars: ${g.scars.length}`);
    });

  c.command("birth").description("give birth to a child genome (inherits + narrows)")
    .requiredOption("--parent <file>", "parent genome file")
    .requiredOption("--agent <name>", "child agent id")
    .option("--add-value <v>", "(repeatable)", (v: string, a: string[]) => { a.push(v); return a; }, [] as string[])
    .option("--add-bound <b>", "(repeatable)", (v: string, a: string[]) => { a.push(v); return a; }, [] as string[])
    .option("--add-scar <a:reason>", "(repeatable)", (v: string, a: string[]) => { a.push(v); return a; }, [] as string[])
    .action((o: { parent: string; agent: string; addValue: string[]; addBound: string[]; addScar: string[] }) => {
      const parent = load(o.parent);
      const child = ark.birth(parent, o.agent, { addValues: o.addValue, addBounds: o.addBound, addScars: o.addScar.map(parseScar), ts: Math.floor(Date.now() / 1000) });
      const v = ark.verifyBirth(parent, child);
      out(`🚢 ${v.ok ? "✓ born" : "🛑 INVALID"} "${child.agent}" gen ${child.generation} (id ${child.genomeId.slice(0, 16)}…)${v.ok ? " → " + save(child) : ""}`);
      if (!v.ok) v.violations.forEach((x) => out(`   ✗ ${x}`));
      else out(`   inherits ${child.covenant.values.length} values · ${child.bounds.length} bounds · ${child.scars.length} scars · ${child.inheritedContext.length} verified-context`);
    });

  c.command("verify").description("verify a birth is accountable (no escalation/regression/amnesia/poison)")
    .requiredOption("--parent <file>", "parent genome")
    .requiredOption("--child <file>", "child genome")
    .action((o: { parent: string; child: string }) => {
      const v = ark.verifyBirth(load(o.parent), load(o.child));
      out(v.ok ? "✓ VALID birth — accountable, bounded, remembering" : "🛑 INVALID birth:");
      v.violations.forEach((x) => out(`   ✗ ${x}`));
      process.exitCode = v.ok ? 0 : 2;
    });

  c.command("gate").description("runtime gate: may a genome perform an action?")
    .requiredOption("--genome <file>", "genome")
    .requiredOption("--action <a>", "the action")
    .action((o: { genome: string; action: string }) => {
      const r = ark.actionAllowed(load(o.genome), o.action);
      out(`${r.allowed ? "✓ ALLOWED" : "🛑 DENIED"} — ${r.reason}`);
      process.exitCode = r.allowed ? 0 : 2;
    });
}
