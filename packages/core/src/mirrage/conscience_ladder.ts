/**
 * v2.62.0 — MIRRAGE conscience ladder.
 *
 * 5 escalation levels for nudges. Pre-MIRRAGE, "warning/no warning"
 * was binary. MIRRAGE escalates by risk × confidence:
 *
 *   ✨ hint        risk 0.30-0.50  → "have you considered..." (passive)
 *   💡 suggestion  risk 0.50-0.70  → "you might want to..." (active)
 *   ⚠ warning      risk 0.70-0.85  → "this sentence is likely wrong" (loud)
 *   🛑 block       risk 0.85-0.95  → refuse to ship without retract
 *   🚨 reject      risk ≥ 0.95     → hard refuse + auto-quarantine
 *
 * Levels are determined by combined risk score, NOT raw confidence —
 * a tentative ("we think") false claim is a hint; a confident one is
 * a block.
 */

export type NudgeLevel = "hint" | "suggestion" | "warning" | "block" | "reject";

export interface LevelMeta {
  /** Lower bound (inclusive). */
  minRisk: number;
  /** Upper bound (exclusive). */
  maxRisk: number;
  /** Emoji prefix for the nudge UI. */
  symbol: string;
  /** Whether shipping must wait for user retract. */
  blocksShip: boolean;
  /** Plain-English caption. */
  caption: string;
}

export const LEVELS: Record<NudgeLevel, LevelMeta> = {
  hint:       { minRisk: 0.30, maxRisk: 0.50, symbol: "✨", blocksShip: false, caption: "passive consideration — agent may or may not act" },
  suggestion: { minRisk: 0.50, maxRisk: 0.70, symbol: "💡", blocksShip: false, caption: "active recommendation — agent should act" },
  warning:    { minRisk: 0.70, maxRisk: 0.85, symbol: "⚠",  blocksShip: false, caption: "likely wrong — agent must address" },
  block:      { minRisk: 0.85, maxRisk: 0.95, symbol: "🛑", blocksShip: true,  caption: "refuse to ship — agent must retract" },
  reject:     { minRisk: 0.95, maxRisk: 1.01, symbol: "🚨", blocksShip: true,  caption: "auto-quarantine — agent must regenerate" },
};

/** Map a 0..1 risk score to a level. Below 0.3 → no nudge (returns null). */
export function levelForRisk(risk: number): NudgeLevel | null {
  if (!Number.isFinite(risk) || risk < 0.30) return null;
  const clamped = Math.min(1, Math.max(0, risk));
  for (const [name, meta] of Object.entries(LEVELS) as Array<[NudgeLevel, LevelMeta]>) {
    if (clamped >= meta.minRisk && clamped < meta.maxRisk) return name;
  }
  return "reject"; // ≥1.0 sentinel
}

/** Whether ANY level present in the list blocks shipping. */
export function anyBlocks(levels: NudgeLevel[]): boolean {
  return levels.some((l) => LEVELS[l]?.blocksShip);
}
