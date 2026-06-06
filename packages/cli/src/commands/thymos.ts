/**
 * `mneme thymos` (v3.11.0) — the affective core: a memory that feels (measurably).
 *   thymos                          → the heart's status + gauntlet
 *   thymos feel "<text>"            → read the affective valence + intensity (EN+Thai)
 *   thymos resonate --core "<v>" a b c   → the core attracts matching inbound, repels the rest
 */
import type { Command } from "commander";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { thymos, forgetting, notary } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }

interface CortexEntry { id: string; key: string; value: string; at: number }
function loadCortex(cwd: string): CortexEntry[] {
  try { const p = join(cwd, ".mneme", "cortex", "store.json"); if (!existsSync(p)) return []; const j = JSON.parse(readFileSync(p, "utf8")); return Array.isArray(j?.entries) ? j.entries : []; } catch { return []; }
}

export function registerThymosCommands(program: Command): void {
  const k = program.command("thymos").description("💗 THYMOS — Mneme's affective core: memory that forgets the trivial + keeps what bonds (salience decay), and a vision that ATTRACTS matching inbound (resonance). Feeling = a SIGNED, measurable salience/bond score — not claimed sentience.")
    .action(() => {
      const g = thymos.thymosGauntlet();
      out(`💗 THYMOS — the affective core · gauntlet ${g.score}/100`);
      out("   ① salience-decay: every memory carries an affective charge (reuse × feeling × consequence) and fades unless it matters — keep what bonds, forget the noise.");
      out("   ② resonance: the same core ATTRACTS inbound that matches the user's vision + repels what doesn't.");
      out("   measurable: salience 0..1 · valence -1..1 · bond 0..100 · retention curves · footprint saved. Honest: a heart you can audit, not a claim of sentience.");
      out("   try: mneme thymos feel \"this is สำคัญมาก!\"   ·   mneme thymos resonate --core \"<your vision>\" \"item a\" \"item b\"");
    });

  k.command("feel <text>").description("Read the affective valence (-1..1) + intensity (0..1) of a piece of text (EN+Thai sentiment).")
    .action((text: string) => {
      const a = thymos.readAffect(text);
      const mood = a.valence > 0.2 ? "💚 positive" : a.valence < -0.2 ? "❤️ charged-negative" : "🫥 neutral";
      out(`💗 ${mood} · valence ${a.valence} · intensity ${a.intensity}`);
      out(`   → salience if recalled twice + consequential: ${thymos.salience({ recalls: 2, valence: a.valence, consequence: a.intensity * 0.5 })} (drives how long it's remembered)`);
    });

  k.command("resonate <items...>").description("The core attracts: rank inbound items by resonance with your vision; above threshold = pulled in, below = repelled.")
    .requiredOption("--core <vision>", "your core vision / what you care about")
    .action((items: string[], o: { core: string }) => {
      out(`💗 resonance with core: "${o.core}"`);
      for (const a of thymos.attract(o.core, items)) out(`   ${a.pulled ? "🧲 pulled " : "✗ repelled"} · ${a.resonance.toFixed(2)} · ${a.item}`);
    });

  k.command("consolidate").description("💗 Wire the heart to your real shared memory (the cortex): score each fact's salience (affect × age) and decide what fades — keeping what bonds, forgetting the noise. Dry-run by default; --commit actually forgets the faded facts + mints a signed PROOF-OF-FORGETTING.")
    .option("--floor <n>", "strength floor below which a low-salience trace fades", parseFloat)
    .option("--commit", "actually purge the faded facts from the cortex + mint the proof")
    .option("--out <file>", "where to write the signed Proof-of-Forgetting (default .mneme/cortex/forgetting.json)")
    .action((o: { floor?: number; commit?: boolean; out?: string }) => {
      const cwd = process.cwd(); const now = Date.now(); const entries = loadCortex(cwd);
      if (!entries.length) { out("💗 cortex is empty — nothing to consolidate yet."); return; }
      const nodes = entries.map((e) => thymos.imprint(e.id, `${e.key}: ${e.value}`, { nowMs: e.at || now }));
      const con = thymos.consolidate(nodes, now, o.floor ?? 0.18);
      const keptIds = new Set(con.kept.map((n) => n.id));
      const faded = entries.filter((e) => !keptIds.has(e.id));
      out(`💗 THYMOS consolidate — ${entries.length} fact(s): ${con.kept.length} kept · ${faded.length} would fade (low salience, decayed)`);
      for (const n of con.kept.slice(0, 5)) out(`   keep · salience ${thymos.salienceOf(n).toFixed(2)} · ${n.text.slice(0, 56)}`);
      for (const e of faded.slice(0, 5)) out(`   fade · ${e.key}`);
      if (!o.commit) { out("   (dry-run — nothing changed. Pass --commit to forget the faded facts + mint the signed proof.)"); return; }
      // ACTUALLY forget: rewrite the store without the faded entries, then the receipt is TRUE + verifiable
      const remainingEntries = entries.filter((e) => keptIds.has(e.id));
      try { const full = JSON.parse(readFileSync(join(cwd, ".mneme", "cortex", "store.json"), "utf8")); full.entries = full.entries.filter((e: { id: string }) => keptIds.has(e.id)); writeFileSync(join(cwd, ".mneme", "cortex", "store.json"), JSON.stringify(full, null, 2), "utf8"); } catch { /* */ }
      const fItems = faded.map((e) => ({ id: e.id, contentHash: forgetting.contentHash(`${e.key}: ${e.value}`), reason: "low salience, decayed", salience: thymos.salience({ recalls: 0, valence: thymos.readAffect(e.value).valence, consequence: 0 }) }));
      const remaining = remainingEntries.map((e) => ({ id: e.id, contentHash: forgetting.contentHash(`${e.key}: ${e.value}`) }));
      const receipt = forgetting.buildForgettingReceipt(fItems, remaining, now);
      let signed: unknown = receipt;
      try { signed = notary.issueReceipt(cwd, { kind: "claim-verdict", subject: `proof-of-forgetting:${receipt.merkleRoot.slice(0, 12)}`, payload: receipt, includePayload: true, issuedAt: now }); } catch { /* */ }
      const outPath = o.out ?? join(cwd, ".mneme", "cortex", "forgetting.json");
      writeFileSync(outPath, JSON.stringify(signed, null, 2), "utf8");
      out(`   🗑 forgot ${receipt.count} fact(s) + signed Proof-of-Forgetting → ${outPath} (verify offline: mneme forget verify ${outPath})`);
    });

  // top-level: verify a Proof-of-Forgetting against the current cortex store (offline)
  program.command("forget").description("🗑 PROOF-OF-FORGETTING — prove a memory was truly forgotten (GDPR / EU AI Act right-to-erasure). The inverse of provenance: everyone proves they KEPT data; this proves it's GONE.")
    .command("verify <file>").description("Verify OFFLINE that the faded facts are absent from the current shared memory.")
    .action((file: string) => {
      if (!existsSync(file)) { out("receipt not found"); process.exitCode = 2; return; }
      let signed: { payload?: forgetting.ForgettingReceipt } & forgetting.ForgettingReceipt;
      try { signed = JSON.parse(readFileSync(file, "utf8")); } catch { out("✗ invalid receipt JSON"); process.exitCode = 2; return; }
      const receipt = (signed.payload && signed.payload.kind ? signed.payload : signed) as forgetting.ForgettingReceipt;
      const sig = notary.verifyReceipt(signed);
      const cwd = process.cwd();
      const store = loadCortex(cwd).map((e) => ({ id: e.id, contentHash: forgetting.contentHash(`${e.key}: ${e.value}`) }));
      const v = forgetting.verifyForgetting(receipt, store);
      out(sig.valid ? "✓ signature VALID (Ed25519, offline)" : `· unsigned/${sig.reason}`);
      out(v.valid ? `✓ FORGETTING PROVEN — ${v.reasons[0]}` : "✗ NOT proven:");
      if (!v.valid) for (const r of v.reasons) out("   • " + r);
      if (!v.valid) process.exitCode = 2;
    });
}
