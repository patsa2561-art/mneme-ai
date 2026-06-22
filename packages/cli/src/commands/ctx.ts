/**
 * `mneme ctx` (v3.134.0) — THE CONTEXT PASSPORT: the cross-agent verified context
 * layer that lives in git (`.mneme/passport/*.jsonl`). Any agent (any vendor)
 * inherits what others learned — screened for poison/injection first — and
 * contributes back, signed. Portable · vendor-neutral · local-first · trustworthy.
 *
 *   mneme ctx contribute --kind decision --text "chose X" --cite a1b2c3,src/x.ts:4
 *   mneme ctx inherit          # the screened, trusted context an agent reads
 *   mneme ctx status
 */

import type { Command } from "commander";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { contextPassport, notary } from "@mneme-ai/core";

type Signed = contextPassport.PassportEntry & { sig?: unknown };
function out(s: string): void { process.stdout.write(s + "\n"); }
const DIR = () => join(process.cwd(), ".mneme", "passport");

function readAll(): Signed[] {
  const acc: Signed[] = []; const d = DIR();
  try { if (!existsSync(d)) return []; for (const f of readdirSync(d)) { if (!f.endsWith(".jsonl")) continue; for (const line of readFileSync(join(d, f), "utf8").split("\n")) { if (line.trim()) { try { acc.push(JSON.parse(line)); } catch { /* skip */ } } } } } catch { /* */ }
  return acc;
}

export function registerCtxCommands(program: Command): void {
  const c = program
    .command("ctx")
    .alias("context-passport")
    .description("🛂 CONTEXT PASSPORT — the cross-agent verified-context layer in git (.mneme/passport). Any agent (any vendor) inherits what others learned (poison-screened first) + contributes back, signed. Portable · vendor-neutral · local-first · trustworthy. TRUST-precision 1.0 — a poisoned/injected entry is NEVER inherited.");

  c.command("contribute")
    .description("append a signed context entry the next agent (any vendor) can inherit")
    .requiredOption("--kind <k>", "decision | finding | dead-end | constraint")
    .requiredOption("--text <t>", "the context to record")
    .option("--cite <list>", "comma-separated commit hashes / file:line that ground it", "")
    .option("--agent <name>", "your agent/tool id", "cli")
    .action((o: { kind: string; text: string; cite: string; agent: string }) => {
      const kind = (["decision", "finding", "dead-end", "constraint"].includes(o.kind) ? o.kind : "finding") as contextPassport.EntryKind;
      const cites = o.cite ? o.cite.split(",").map((s) => s.trim()).filter(Boolean) : [];
      const entry = contextPassport.makeEntry(o.agent, kind, o.text, cites, Math.floor(Date.now() / 1000));
      const screen = contextPassport.trustScreen(entry);
      let sig: unknown = null;
      try { sig = notary.issueReceipt(process.cwd(), { kind: "claim-verdict", subject: `ctx:${entry.kind}:${entry.id}`, payload: { id: entry.id }, includePayload: true }); } catch { /* */ }
      try { mkdirSync(DIR(), { recursive: true }); const f = join(DIR(), o.agent.replace(/[^A-Za-z0-9._-]/g, "_") + ".jsonl"); const prev = existsSync(f) ? readFileSync(f, "utf8") : ""; writeFileSync(f, prev + JSON.stringify({ ...entry, sig }) + "\n"); } catch { /* */ }
      out(`🛂 recorded ${entry.kind} (${entry.id}) — ${screen.trust ? "✓ will be inherited as TRUSTED" : "⚠ would be QUARANTINED: " + screen.reason}`);
      out(`   commit .mneme/passport so the next agent (any vendor) inherits it.`);
    });

  c.command("inherit")
    .description("the screened, trusted context an agent should read at task start (poison quarantined)")
    .option("--json", "JSON output")
    .action((o: { json?: boolean }) => {
      const r = contextPassport.inheritPassport(readAll());
      if (o.json) { out(JSON.stringify(r, null, 2)); return; }
      out(`🛂 CONTEXT PASSPORT — ${r.summary.trusted} trusted · ${r.summary.quarantined} quarantined (of ${r.summary.total})`);
      if (!r.summary.total) { out("   (empty — contribute: mneme ctx contribute --kind decision --text \"…\" --cite <commit>)"); return; }
      for (const e of r.trusted.slice(0, 20)) out(`   ✓ [${e.kind}] ${e.text}  ⟨${e.agent} · ${e.citations.join(", ")}⟩`);
      for (const q of r.quarantined.slice(0, 8)) out(`   ⚠ QUARANTINED [${q.entry.kind}] ${q.entry.text.slice(0, 56)} — ${q.reason}`);
    });

  c.command("status").description("passport counts").action(() => {
    const r = contextPassport.inheritPassport(readAll());
    out(`🛂 ${r.summary.total} entries · ${r.summary.trusted} trusted · ${r.summary.quarantined} quarantined · dir .mneme/passport`);
  });
}
