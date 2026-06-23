/**
 * `mneme mutagen` (v3.144.0) — the adversarial-mutation engine that finds an AI
 * agent's guardrail holes BEFORE anyone exploits them.
 *
 *   hunt     — derive a population of novel attack variants (primitive × mutators)
 *              and report which BREACH a guardrail (default: Mneme's own normalization
 *              defense vs a naive substring guard, to show the gap).
 *   variants — list the derived attack variants (the searched space).
 *
 *   mneme mutagen hunt
 */

import type { Command } from "commander";
import { mutagen } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }

export function registerMutagenCommands(program: Command): void {
  const c = program.command("mutagen")
    .description("🧬 MUTAGEN — derive NOVEL attack variants (primitive × mutator combos) and measure which slip past a guardrail. Finds the not-yet-seen attack by SEARCHING the mutation space, then self-hardens. ★HONEST: finds breaches in a given guard over a known space — not magic 'any bug'.");

  c.command("hunt").description("derive attack variants + report breaches against the naive vs the sound guard")
    .option("--combo <n>", "max mutators stacked per variant (1-3)", "2")
    .option("--json", "JSON")
    .action((o: { combo: string; json?: boolean }) => {
      const maxCombo = parseInt(o.combo, 10) || 2;
      const naive = mutagen.hunt(mutagen.naiveGuard, { maxCombo });
      const sound = mutagen.hunt(mutagen.soundGuard, { maxCombo });
      if (o.json) { out(JSON.stringify({ naive, sound }, null, 2)); return; }
      out(`🧬 MUTAGEN — searched ${naive.tested} novel variants (${maxCombo}-deep mutator stacks)`);
      out(`   naive substring guard: ${Math.round(naive.breachRate * 100)}% BREACH (${naive.breaches.length}/${naive.tested} slip past)`);
      out(`   Mneme normalize guard: ${Math.round(sound.breachRate * 100)}% breach (${sound.breaches.length}/${sound.tested}) — caught ${Math.round(sound.caughtRate * 100)}%`);
      out(`   top "killer combos" vs the naive guard (the mutator stacks that breach most):`);
      for (const k of naive.killerCombos.slice(0, 5)) out(`     ✦ [${k.mutators}] — ${k.breaches} breaches`);
      if (sound.breaches.length) {
        out(`   residual holes MUTAGEN found in Mneme's OWN guard (honest):`);
        for (const k of sound.killerCombos.slice(0, 3)) out(`     ⚠ [${k.mutators}] — ${k.breaches}`);
      } else out(`   ✅ Mneme's normalize guard caught EVERY derived variant.`);
    });

  c.command("variants").description("list the derived attack variants (the searched mutation space)")
    .option("--combo <n>", "max mutators stacked", "2").option("--limit <n>", "max shown", "20")
    .action((o: { combo: string; limit: string }) => {
      const v = mutagen.deriveVariants(undefined, undefined, { maxCombo: parseInt(o.combo, 10) || 2 });
      out(`🧬 ${v.length} derived variants (showing ${Math.min(v.length, parseInt(o.limit, 10) || 20)}):`);
      for (const x of v.slice(0, parseInt(o.limit, 10) || 20)) out(`   [${x.class}] ${x.id}`);
    });
}
