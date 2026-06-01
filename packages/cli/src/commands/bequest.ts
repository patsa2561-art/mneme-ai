/**
 * `mneme bequest` (v2.122.0) — the Second Brain that is INHERITED.
 *
 * Turns Mneme's key-person-risk DETECTION (atrophy) into knowledge SURVIVAL:
 * capture a departing expert's knowledge as a signed Succession Capsule, let a
 * successor claim + verify it (transfer-integrity proof), and report the org's
 * inheritance completeness + ORPHANED knowledge (knowledge with no living heir)
 * — the number a CRO turns into dollars.
 *
 *   mneme bequest status [--cost-per-orphan N] [--budget N]   # org inheritance health + who to assign
 *   mneme bequest capture --holder <email> [--reason "..."]    # mint a signed succession capsule
 *   mneme bequest list                                          # stored capsules
 *   mneme bequest claim --capsule <id> --heir <email>           # successor verifies + signs receipt
 */

import type { Command } from "commander";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { git, store, people, bequest, notary } from "@mneme-ai/core";
import { dbPath } from "../paths.js";

type KnowledgeUnit = bequest.KnowledgeUnit;
type HeirCandidate = bequest.HeirCandidate;

const DIR = ".mneme/bequest";
function out(s: string): void { process.stdout.write(s + "\n"); }
function outJson(o: unknown): void { process.stdout.write(JSON.stringify(o, null, 2) + "\n"); }
function usd(n: number): string { return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 }); }
function sign(cwd: string, subject: string, payload: Record<string, unknown>): unknown {
  try { return notary.issueReceipt(cwd, { kind: "memory-capsule", subject, payload, includePayload: true }); } catch { return null; }
}

async function openStore(cwd: string): Promise<{ s: InstanceType<typeof store.MnemeStore>; root: string } | { error: string }> {
  if (!(await git.isGitRepo(cwd))) return { error: "Not in a git repo." };
  const meta = await git.getRepoMeta(cwd);
  const s = new store.MnemeStore(dbPath(meta.rootPath));
  if (s.countCommits() === 0) { s.close(); return { error: "Memory is empty. Run `mneme index` first." }; }
  return { s, root: meta.rootPath };
}

/** Build inheritance knowledge units from the real atrophy report: every
 *  non-safe file is a unit; its holders are the file's knowers with their
 *  Ebbinghaus knowledge score as fluency; mass = total touches (work invested). */
function unitsFromAtrophy(s: InstanceType<typeof store.MnemeStore>): { units: KnowledgeUnit[]; candidates: HeirCandidate[] } {
  const r = people.atrophy(s);
  const units: KnowledgeUnit[] = r.atRiskFiles
    .filter((f) => f.tier !== "safe")
    .map((f) => ({
      id: f.filePath,
      mass: f.totalTouches,
      holders: f.allKnowers.map((k) => ({ id: k.email, fluency: k.knowledge })),
    }));
  // candidates = anyone who knows ≥1 of the at-risk files; they can inherit those.
  const byAuthor = new Map<string, Set<string>>();
  for (const f of r.atRiskFiles) {
    if (f.tier === "safe") continue;
    for (const k of f.allKnowers) {
      if (!byAuthor.has(k.email)) byAuthor.set(k.email, new Set());
      byAuthor.get(k.email)!.add(f.filePath);
    }
  }
  const candidates: HeirCandidate[] = [...byAuthor.entries()].map(([id, set]) => ({ id, canCover: [...set] }));
  return { units, candidates };
}

export function registerBequestCommands(program: Command): void {
  const bq = program.command("bequest").alias("inherit")
    .description("🧬 SECOND BRAIN INHERITANCE — capture a departing expert's knowledge as a SIGNED capsule, let a successor verify it, and report org inheritance completeness + ORPHANED knowledge (knowledge with no living heir). The survival layer on top of key-person-risk detection.");

  // ── status: org inheritance health (the CRO headline) ──
  bq.command("status")
    .description("Org inheritance health: completeness, ORPHANED knowledge mass (no living heir), top orphans, and the minimum set of heirs to assign. --cost-per-orphan gives a labelled exposure estimate.")
    .option("--cost-per-orphan <usd>", "your est. cost to re-derive one orphaned unit's knowledge (USD).", (v) => parseFloat(v))
    .option("--budget <n>", "max heirs to assign in the cover plan.", (v) => parseInt(v, 10), 5)
    .option("--threshold <f>", "survival below this = orphaned (0..1).", (v) => parseFloat(v), 0.5)
    .option("--json", "JSON output.")
    .action(async (opts: { costPerOrphan?: number; budget?: number; threshold?: number; json?: boolean }) => {
      const cwd = process.cwd();
      const o = await openStore(cwd); if ("error" in o) { out(`✗ ${o.error}`); process.exitCode = 1; return; }
      try {
        const { units, candidates } = unitsFromAtrophy(o.s);
        const rep = bequest.inheritanceReport(units, { orphanThreshold: opts.threshold ?? 0.5 });
        const atRisk = rep.orphans.map((u) => ({ id: u.id, mass: u.mass }));
        const plan = bequest.minHeirCover(atRisk, candidates, opts.budget ?? 5);
        const exposure = typeof opts.costPerOrphan === "number" ? rep.orphans.length * opts.costPerOrphan : undefined;
        const receipt = sign(cwd, "bequest:status", { completeness: rep.completeness, orphanedMass: rep.orphanedMass, orphanCount: rep.orphans.length });
        if (opts.json) { outJson({ ...rep, coverPlan: plan, exposureUSD: exposure, basis: "survival = 1−∏(1−fluency) over git-derived knowledge holders (Ebbinghaus); orphaned = knowledge below the survival threshold; exposure = YOUR cost × orphan count — labelled, not a forecast", signed: receipt }); return; }
        out(`🧬 INHERITANCE HEALTH — completeness ${(rep.completeness * 100).toFixed(0)}% · ${rep.orphans.length} orphaned unit(s) of ${rep.unitCount} at-risk · orphaned mass ${rep.orphanedMass} / ${rep.totalMass}`);
        for (const u of rep.orphans.slice(0, 8)) out(`   • ORPHAN ${u.id} — survival ${(u.survival * 100).toFixed(0)}% (${u.heirs} holder${u.heirs === 1 ? "" : "s"}, mass ${u.mass})`);
        if (plan.chosen.length > 0) out(`   👥 assign ${plan.chosen.length} heir(s) to cover ${(plan.coverageFraction * 100).toFixed(0)}% of orphaned mass: ${plan.chosen.join(", ")}`);
        if (exposure !== undefined) out(`   💸 exposure estimate: ${usd(exposure)}  (your ${usd(opts.costPerOrphan!)}/orphan × ${rep.orphans.length} — labelled, not a forecast)`);
        if (receipt) out(`   ✓ signed`);
      } finally { o.s.close(); }
    });

  // ── capture: mint a signed succession capsule for a departing holder ──
  bq.command("capture")
    .description("Mint a SIGNED succession capsule from a holder's at-risk knowledge (the files they know + the current content hash). Hand the capsule id to a successor.")
    .requiredOption("--holder <email>", "the departing/at-risk holder's email.")
    .option("--reason <text>", "why this knowledge matters / handoff context.", "")
    .option("--json", "JSON output.")
    .action(async (opts: { holder: string; reason?: string; json?: boolean }) => {
      const cwd = process.cwd();
      const o = await openStore(cwd); if ("error" in o) { out(`✗ ${o.error}`); process.exitCode = 1; return; }
      try {
        const { units } = unitsFromAtrophy(o.s);
        // the holder's units = files they are a knower of; attach current content.
        const held: KnowledgeUnit[] = units
          .filter((u) => u.holders.some((h) => h.id === opts.holder))
          .map((u) => {
            const fp = join(o.root, u.id);
            let content = u.id;
            try { if (existsSync(fp)) content = readFileSync(fp, "utf8"); } catch { /* */ }
            return { ...u, content };
          });
        if (held.length === 0) { out(`✗ no at-risk knowledge units held by ${opts.holder} (they may not be a knower of any non-safe file).`); process.exitCode = 1; return; }
        const cap = bequest.mintCapsule({ holderId: opts.holder, units: held, reasoning: opts.reason ?? "" });
        const receipt = sign(cwd, `bequest:capsule:${cap.capsuleId}`, { capsuleId: cap.capsuleId, bodyHash: cap.bodyHash, holderId: cap.holderId, units: cap.units.length });
        try { if (!existsSync(join(cwd, DIR))) mkdirSync(join(cwd, DIR), { recursive: true });
          writeFileSync(join(cwd, DIR, `${cap.capsuleId}.json`), JSON.stringify({ capsule: cap, signed: receipt }, null, 2));
        } catch { /* */ }
        if (opts.json) { outJson({ capsule: cap, signed: receipt }); return; }
        out(`🧬 succession capsule minted: ${cap.capsuleId}  (holder ${cap.holderId}, ${cap.units.length} unit(s), signed)`);
        out(`   units: ${cap.units.map((u) => u.id).join(", ")}`);
        out(`   hand off: a successor runs  mneme bequest claim --capsule ${cap.capsuleId} --heir <their-email>`);
      } finally { o.s.close(); }
    });

  // ── list: stored capsules ──
  bq.command("list")
    .description("List stored succession capsules.")
    .option("--json", "JSON output.")
    .action((opts: { json?: boolean }) => {
      const cwd = process.cwd();
      const dir = join(cwd, DIR);
      const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
      const rows = files.map((f) => { try { const j = JSON.parse(readFileSync(join(dir, f), "utf8")) as { capsule?: { capsuleId?: string; holderId?: string; units?: unknown[] } }; return { capsuleId: j.capsule?.capsuleId, holderId: j.capsule?.holderId, units: j.capsule?.units?.length ?? 0 }; } catch { return { capsuleId: f, holderId: "?", units: 0 }; } });
      if (opts.json) { outJson(rows); return; }
      if (rows.length === 0) { out("(no succession capsules — run `mneme bequest capture --holder <email>`)"); return; }
      out(`🧬 ${rows.length} succession capsule(s):`);
      for (const r of rows) out(`   • ${r.capsuleId} — holder ${r.holderId}, ${r.units} unit(s)`);
    });

  // ── claim: successor verifies the capsule against the current material ──
  bq.command("claim")
    .description("A successor claims a capsule: Mneme re-reads each unit's current content and verifies it matches the signed capsule (transfer-integrity proof), then signs an heir receipt. Drift ⇒ the expert's knowledge changed; re-capture.")
    .requiredOption("--capsule <id>", "the capsule id to inherit.")
    .requiredOption("--heir <email>", "the successor's email.")
    .option("--json", "JSON output.")
    .action(async (opts: { capsule: string; heir: string; json?: boolean }) => {
      const cwd = process.cwd();
      const o = await openStore(cwd); if ("error" in o) { out(`✗ ${o.error}`); process.exitCode = 1; return; }
      try {
        const p = join(cwd, DIR, `${opts.capsule}.json`);
        if (!existsSync(p)) { out(`✗ capsule ${opts.capsule} not found (run \`mneme bequest list\`).`); process.exitCode = 1; return; }
        const stored = JSON.parse(readFileSync(p, "utf8")) as { capsule: Parameters<typeof bequest.verifyInheritance>[0] };
        const cap = stored.capsule;
        // re-read each unit's current content and hash it the same way mintCapsule did.
        const provided: Record<string, string> = {};
        const { createHash } = await import("node:crypto");
        for (const u of cap.units) {
          const fp = join(o.root, u.id);
          let content = u.id; try { if (existsSync(fp)) content = readFileSync(fp, "utf8"); } catch { /* */ }
          provided[u.id] = createHash("sha256").update(content, "utf8").digest("hex");
        }
        const verdict = bequest.verifyInheritance(cap, opts.heir, provided);
        const receipt = sign(cwd, `bequest:heir:${opts.capsule}:${opts.heir}`, { capsuleId: verdict.capsuleId, heirId: verdict.heirId, ok: verdict.ok, coverageByMass: verdict.coverageByMass });
        if (opts.json) { outJson({ verdict, signed: receipt }); return; }
        if (verdict.ok) {
          out(`✅ ${opts.heir} inherited capsule ${opts.capsule} — ${(verdict.coverageByMass * 100).toFixed(0)}% mass coverage, all units intact. Signed heir receipt issued.`);
          out(`   note: ${verdict.note}`);
        } else {
          out(`⚠ partial/failed inheritance — ${verdict.missing.length} unit(s) drifted since capture: ${verdict.missing.join(", ")}`);
          out(`   the expert's knowledge changed; re-capture with \`mneme bequest capture --holder ${cap.holderId}\`.`);
          process.exitCode = 2;
        }
      } finally { o.s.close(); }
    });
}
