/**
 * v2.22.1 — PHYSICS LATHE · UNITS.
 *
 * Parse a unit string ("km/s", "m·s⁻²", "N/m²", "GPa") into the
 * canonical SI base-vector form, plus a scaling factor so the
 * extractor can normalise everything before comparison.
 *
 * Handles common unit prefixes (k / M / G / m / μ / n / p / etc.)
 * and the conventional rocketry shorthands ("km/s", "g" for
 * acceleration).
 */

import type { SiBase, Unit } from "./axioms.js";

/** Multiplicative prefix factors. */
const PREFIXES: Record<string, number> = {
  Y: 1e24, Z: 1e21, E: 1e18, P: 1e15, T: 1e12, G: 1e9, M: 1e6, k: 1e3,
  h: 1e2, da: 10,
  d: 1e-1, c: 1e-2, m: 1e-3, "μ": 1e-6, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15, a: 1e-18,
};

interface BaseUnitDef {
  /** SI base vector. */
  unit: Unit;
  /** Scale into base SI. */
  scale: number;
}

/** Recognised base unit symbols + their decomposition. */
const BASE_UNITS: Record<string, BaseUnitDef> = {
  // strict base
  "m": { unit: [["m", 1]], scale: 1 },
  "g": { unit: [["kg", 1]], scale: 1e-3 }, // gram → kg
  "kg": { unit: [["kg", 1]], scale: 1 },
  "s": { unit: [["s", 1]], scale: 1 },
  "A": { unit: [["A", 1]], scale: 1 },
  "K": { unit: [["K", 1]], scale: 1 },
  "mol": { unit: [["mol", 1]], scale: 1 },
  "cd": { unit: [["cd", 1]], scale: 1 },
  // derived
  "N":  { unit: [["kg", 1], ["m", 1], ["s", -2]], scale: 1 },
  "Pa": { unit: [["kg", 1], ["m", -1], ["s", -2]], scale: 1 },
  "J":  { unit: [["kg", 1], ["m", 2], ["s", -2]], scale: 1 },
  "W":  { unit: [["kg", 1], ["m", 2], ["s", -3]], scale: 1 },
  "C":  { unit: [["A", 1], ["s", 1]], scale: 1 },
  "V":  { unit: [["kg", 1], ["m", 2], ["s", -3], ["A", -1]], scale: 1 },
  "Hz": { unit: [["s", -1]], scale: 1 },
  // rocketry shorthand
  "bar":{ unit: [["kg", 1], ["m", -1], ["s", -2]], scale: 1e5 },
  "atm":{ unit: [["kg", 1], ["m", -1], ["s", -2]], scale: 101325 },
  "psi":{ unit: [["kg", 1], ["m", -1], ["s", -2]], scale: 6894.76 },
  "eV": { unit: [["kg", 1], ["m", 2], ["s", -2]], scale: 1.602176634e-19 },
};

/** Time + length shorthands beyond the strict base. */
const COMPOUND: Record<string, { unit: Unit; scale: number }> = {
  "min": { unit: [["s", 1]], scale: 60 },
  "hr":  { unit: [["s", 1]], scale: 3600 },
  "h":   { unit: [["s", 1]], scale: 3600 },
  "day": { unit: [["s", 1]], scale: 86400 },
  "yr":  { unit: [["s", 1]], scale: 365.25 * 86400 },
  "Hz":  { unit: [["s", -1]], scale: 1 },
};

function multiplyUnits(a: Unit, b: Unit, expB = 1): Unit {
  const m = new Map<SiBase, number>();
  for (const [k, v] of a) m.set(k, (m.get(k) ?? 0) + v);
  for (const [k, v] of b) m.set(k, (m.get(k) ?? 0) + v * expB);
  return Array.from(m.entries()).filter(([, v]) => v !== 0).sort((x, y) => x[0].localeCompare(y[0]));
}

/** Strip a prefix from a symbol (e.g. "km" → "m" + factor 1e3). Returns
 *  null when no recognised prefix applies. */
function tryPrefix(token: string): { core: string; scale: number } | null {
  // Try two-character prefixes first (`da`).
  for (const len of [2, 1]) {
    if (token.length <= len) continue;
    const p = token.slice(0, len);
    if (p in PREFIXES) {
      const core = token.slice(len);
      if (core in BASE_UNITS || core in COMPOUND) {
        return { core, scale: PREFIXES[p]! };
      }
    }
  }
  return null;
}

function lookup(token: string): BaseUnitDef | null {
  // exact match
  if (token in BASE_UNITS) return BASE_UNITS[token]!;
  if (token in COMPOUND) return { unit: COMPOUND[token]!.unit, scale: COMPOUND[token]!.scale };
  // prefixed
  const p = tryPrefix(token);
  if (!p) return null;
  const base = (p.core in BASE_UNITS ? BASE_UNITS[p.core] : COMPOUND[p.core]!);
  return { unit: base.unit, scale: base.scale * p.scale };
}

export interface ParsedUnit {
  unit: Unit;
  scale: number;
}

/** Parse a unit string of the form `term/term/term · term² ...`. Returns
 *  null on tokens we cannot recognise — caller should report
 *  OUT_OF_AXIOM_SET. */
export function parseUnit(text: string): ParsedUnit | null {
  if (!text || text.trim().length === 0) return { unit: [], scale: 1 };
  // Normalise separators.
  let t = text.trim()
    .replace(/·/g, "*")
    .replace(/⁻¹/g, "^-1").replace(/⁻²/g, "^-2").replace(/⁻³/g, "^-3").replace(/⁻⁴/g, "^-4")
    .replace(/²/g, "^2").replace(/³/g, "^3").replace(/⁴/g, "^4")
    .replace(/\s+/g, "");
  let unit: Unit = [];
  let scale = 1;
  // Split on "/" first to track division.
  const parts = t.split("/");
  for (let i = 0; i < parts.length; i++) {
    const sign = i === 0 ? 1 : -1;
    for (const factor of parts[i]!.split("*")) {
      if (!factor) continue;
      let exp = 1;
      let token = factor;
      const m = factor.match(/^(.+?)\^?(-?\d+)$/);
      if (m) { token = m[1]!; exp = parseInt(m[2]!, 10); }
      const def = lookup(token);
      if (!def) return null;
      unit = multiplyUnits(unit, def.unit, sign * exp);
      scale *= def.scale ** (sign * exp);
    }
  }
  return { unit, scale };
}

export function unitsEqual(a: Unit, b: Unit): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  for (let i = 0; i < sa.length; i++) {
    if (sa[i]![0] !== sb[i]![0] || sa[i]![1] !== sb[i]![1]) return false;
  }
  return true;
}

export function formatUnit(u: Unit): string {
  if (u.length === 0) return "(dimensionless)";
  return u.map(([s, e]) => e === 1 ? s : `${s}^${e}`).join("·");
}
