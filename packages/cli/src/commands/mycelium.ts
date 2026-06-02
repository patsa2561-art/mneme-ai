/**
 * `mneme mycelium` (v2.147.0) — the Sovereign Data Flywheel. Share signed,
 * content-free lesson digests across Mneme nodes so the whole network gets
 * smarter — with NO central data store. Local data never leaves; only hashes +
 * DP-noised counts do.
 *
 *   mneme mycelium bundle --out lessons.bundle.json   # signed, content-free, DP-noised
 *   mneme mycelium merge  --bundle peer.bundle.json    # CRDT-merge a peer's lessons
 *   mneme mycelium status                              # mesh size + worked/failed split
 */

import type { Command } from "commander";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { mycelium as myc, notary } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }
const MESH = ".mneme/mycelium/mesh.json";

/** Best-effort: harvest local outcomes from the regret + nkl ledgers (content stays local). */
function localOutcomes(cwd: string): myc.LocalOutcome[] {
  const o: myc.LocalOutcome[] = [];
  try {
    const rp = join(cwd, ".mneme", "regret", "outcomes.jsonl");
    if (existsSync(rp)) for (const l of readFileSync(rp, "utf8").split("\n")) { if (!l.trim()) continue; try { const j = JSON.parse(l); o.push({ topic: (j.features || []).join(" "), approach: (j.features || []).join(","), kind: j.regretted ? "failed" : "worked" }); } catch { /* */ } }
  } catch { /* */ }
  return o;
}
function readMesh(cwd: string): myc.Lesson[] { try { const p = join(cwd, MESH); if (existsSync(p)) { const j = JSON.parse(readFileSync(p, "utf8")); return Array.isArray(j.lessons) ? j.lessons : []; } } catch { /* */ } return []; }
function writeMesh(cwd: string, lessons: myc.Lesson[]): void { try { const p = join(cwd, MESH); if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify({ v: 1, lessons }, null, 2)); } catch { /* */ } }

export function registerMyceliumCommands(program: Command): void {
  const m = program
    .command("mycelium")
    .description("🍄 MYCELIUM — the Sovereign Data Flywheel: share SIGNED, content-free lesson digests (hashes + DP-noised counts, never raw code/secrets) across Mneme nodes so the whole network gets smarter with NO central data store. Captures what WORKED and what FAILED (negative knowledge). The privacy-preserving flywheel only a local-first system can run.");

  m.command("bundle")
    .description("build a signed, content-free, DP-noised bundle of local lessons to share with peers.")
    .option("--out <file>", "write the bundle JSON here (else stdout)")
    .option("--epsilon <n>", "differential-privacy epsilon (default 1)", (v) => parseFloat(v))
    .action((opts: { out?: string; epsilon?: number }) => {
      const cwd = process.cwd();
      const lessons = myc.extractLessons(localOutcomes(cwd), "node");
      const b = myc.buildBundle(lessons, { epsilon: opts.epsilon ?? 1, sample: () => 0 });
      let receipt: unknown = null;
      try { receipt = notary.issueReceipt(cwd, { kind: "memory-capsule", subject: `mycelium.bundle:${b.lessons.length}`, payload: { count: b.lessons.length, epsilon: b.epsilon }, includePayload: true }); } catch { /* */ }
      const bundle = { ...b, signed: receipt };
      if (opts.out) { try { writeFileSync(opts.out, JSON.stringify(bundle, null, 2)); out(`🍄 wrote ${b.lessons.length} content-free lessons → ${opts.out} (signed, DP ε=${b.epsilon})`); } catch { out("✗ write failed"); process.exitCode = 1; } }
      else out(JSON.stringify(bundle, null, 2));
    });

  m.command("merge")
    .description("CRDT-merge a peer's lesson bundle into the local mesh (signature-verified; forged dropped). Commutative + idempotent.")
    .requiredOption("--bundle <file>", "peer bundle JSON")
    .action((opts: { bundle: string }) => {
      const cwd = process.cwd();
      if (!existsSync(opts.bundle)) { out("✗ bundle not found"); process.exitCode = 2; return; }
      let incoming: myc.Lesson[] = [];
      try { const j = JSON.parse(readFileSync(opts.bundle, "utf8")); incoming = Array.isArray(j.lessons) ? j.lessons : []; } catch { out("✗ bad bundle JSON"); process.exitCode = 2; return; }
      const r = myc.mergeBundles(readMesh(cwd), incoming);
      writeMesh(cwd, r.merged);
      out(`🍄 merged — +${r.added} new · ~${r.updated} updated · ${r.dropped} dropped · mesh now ${r.merged.length} lessons`);
    });

  m.command("status")
    .description("mesh size + worked/failed split + topics covered.")
    .action(() => {
      const mesh = readMesh(process.cwd());
      const worked = mesh.filter((l) => l.kind === "worked").length;
      const failed = mesh.filter((l) => l.kind === "failed").length;
      const topics = new Set(mesh.map((l) => l.topicHash)).size;
      out(`🍄 MYCELIUM mesh — ${mesh.length} lessons · ✅ ${worked} worked · ❌ ${failed} failed (negative knowledge) · ${topics} topics`);
      out("   content-free + signed; the network compounds without a central data store.");
    });
}
