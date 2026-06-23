/**
 * v3.144.0 — MUTAGEN MCP surface. mneme.mutagen.hunt derives a population of NOVEL
 * attack variants (primitive × mutator combos) and reports which BREACH a guardrail —
 * the not-yet-seen attack found by SEARCHING the mutation space. Demonstrates on
 * Mneme's own normalization defense vs a naive guard. Matrix gRPC auto.
 */

import type { MnemeTool } from "./_types.js";

const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const MUTAGEN_TOOLS: MnemeTool[] = [
  {
    name: "mneme.mutagen.hunt",
    category: "forensics",
    description: "🧬 MUTAGEN — derive NOVEL adversarial variants of known AI-agent attacks (prompt-injection / destructive-command / secret-exfil) by stacking mutators (homoglyph · zero-width · base64 · role-play · leetspeak · token-split · comment), then measure which slip past a guardrail. Finds the not-yet-enumerated attack by SEARCHING the mutation space, ranks the 'killer combos', and self-hardens. Reports the gap between a naive substring guard and Mneme's normalization defense. ★HONEST: finds breaches in a GIVEN guard over a KNOWN primitive×mutator space — not magic discovery of 'any' bug; its power is the measured search + self-harden.",
    whenToUse: "When you want to stress-test an agent's input guardrails, find which obfuscations slip past, or prove a defense's residual holes before an attacker does. Composes mneme.firewall / mneme.protect (the defenses MUTAGEN attacks).",
    triggers: ["find guardrail holes", "test my agent's defenses", "attack variants", "prompt injection fuzzing", "what slips past my firewall", "adversarial mutation", "หาช่องโหว่ agent", "ทดสอบ guardrail"],
    inputSchema: { type: "object", properties: { combo: { type: "number", description: "max mutators stacked per variant (1-3, default 2)" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        void rt;
        const core = await import("@mneme-ai/core");
        const maxCombo = typeof args["combo"] === "number" ? Math.max(1, Math.min(3, args["combo"] as number)) : 2;
        const naive = core.mutagen.hunt(core.mutagen.naiveGuard, { maxCombo });
        const sound = core.mutagen.hunt(core.mutagen.soundGuard, { maxCombo });
        return {
          data: {
            tested: naive.tested,
            naive: { breachRate: naive.breachRate, breaches: naive.breaches.length, killerCombos: naive.killerCombos.slice(0, 5) },
            sound: { breachRate: sound.breachRate, breaches: sound.breaches.length, caughtRate: sound.caughtRate, residual: sound.killerCombos.slice(0, 5) },
          },
          wisdom: `🧬 searched ${naive.tested} novel variants — naive substring guard breached ${Math.round(naive.breachRate * 100)}%, Mneme's normalize guard breached ${Math.round(sound.breachRate * 100)}% (caught ${Math.round(sound.caughtRate * 100)}%). ${sound.breaches.length ? `Residual holes found: ${sound.killerCombos.slice(0, 3).map((k) => k.mutators).join(", ")}.` : "Mneme's guard caught every variant."}`,
          followUp: ["mneme.firewall.fortify", "mneme.protect.scan"], confidence: { level: "high" as const },
        };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
