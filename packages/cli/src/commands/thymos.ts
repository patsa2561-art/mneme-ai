/**
 * `mneme thymos` (v3.11.0) — the affective core: a memory that feels (measurably).
 *   thymos                          → the heart's status + gauntlet
 *   thymos feel "<text>"            → read the affective valence + intensity (EN+Thai)
 *   thymos resonate --core "<v>" a b c   → the core attracts matching inbound, repels the rest
 */
import type { Command } from "commander";
import { thymos } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }

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
}
