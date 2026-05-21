/**
 * v2.22.2 — DIMENSIONAL ORACLE.
 *
 * Pure unit-algebra check on any LLM claim. Catches the
 * "Mars Climate Orbiter" class of bug: the claim states a quantity
 * is one physical kind (force, energy) but the units it carries are a
 * DIFFERENT kind (pressure, momentum). LLMs do this constantly.
 *
 *   "thrust = 9.8 N/m²"       → N/m² is pressure, not force      → MISMATCH
 *   "burn rate = 12 J·s"      → J·s is action, not power         → MISMATCH
 *   "altitude = 400 km"       → km is length; altitude IS length → MATCH
 *   "torque = 25 J"           → J is energy; torque is N·m       → AMBIGUOUS
 *                                (same SI base vector — formally
 *                                 indistinguishable without context)
 *
 * Composes with:
 *   - physics_lathe/units.ts  (SI parser + base-vector form)
 *   - challenger_librarian    (Mars Climate Orbiter detector calls
 *                              this primitive)
 */

import { parseUnit, formatUnit, unitsEqual } from "../physics_lathe/units.js";
import type { Unit } from "../physics_lathe/axioms.js";

/** Physical-kind classification. Each entry is the canonical SI base
 *  vector for that kind. When a claim's parsed unit matches a
 *  classification, we know the dimension. */
export interface DimensionClass {
  /** Human label. */
  name: string;
  /** Canonical SI base vector. */
  unit: Unit;
  /** Common unit shorthands seen in LLM claims. */
  shorthands: string[];
  /** Plain-English description. */
  description: string;
}

export const DIMENSION_CLASSES: DimensionClass[] = [
  { name: "length",          unit: [["m", 1]], shorthands: ["m", "km", "mm", "cm"], description: "distance / altitude / radius" },
  { name: "time",            unit: [["s", 1]], shorthands: ["s", "ms", "min", "hr", "day"], description: "duration / period" },
  { name: "mass",            unit: [["kg", 1]], shorthands: ["kg", "g", "ton", "lb"], description: "amount of matter" },
  { name: "temperature",     unit: [["K", 1]], shorthands: ["K", "°C", "°F"], description: "thermal energy proxy" },
  { name: "velocity",        unit: [["m", 1], ["s", -1]], shorthands: ["m/s", "km/s", "km/h", "mph"], description: "rate of position change" },
  { name: "acceleration",    unit: [["m", 1], ["s", -2]], shorthands: ["m/s²", "g"], description: "rate of velocity change" },
  { name: "force",           unit: [["kg", 1], ["m", 1], ["s", -2]], shorthands: ["N", "kN", "lbf"], description: "mass × acceleration; e.g. thrust, weight" },
  { name: "pressure",        unit: [["kg", 1], ["m", -1], ["s", -2]], shorthands: ["Pa", "kPa", "MPa", "GPa", "bar", "atm", "psi"], description: "force per unit area" },
  { name: "energy",          unit: [["kg", 1], ["m", 2], ["s", -2]], shorthands: ["J", "kJ", "MJ", "eV", "kWh"], description: "capacity to do work; also torque has same base vector but DIFFERENT physical kind" },
  { name: "power",           unit: [["kg", 1], ["m", 2], ["s", -3]], shorthands: ["W", "kW", "MW", "hp"], description: "energy per unit time" },
  { name: "momentum",        unit: [["kg", 1], ["m", 1], ["s", -1]], shorthands: ["kg·m/s", "N·s"], description: "mass × velocity; specific impulse is related" },
  { name: "action",          unit: [["kg", 1], ["m", 2], ["s", -1]], shorthands: ["J·s", "ℏ"], description: "energy × time; Planck's constant has this dimension" },
  { name: "frequency",       unit: [["s", -1]], shorthands: ["Hz", "kHz", "MHz", "GHz", "rpm"], description: "cycles per unit time" },
  { name: "current",         unit: [["A", 1]], shorthands: ["A", "mA"], description: "electric current" },
  { name: "voltage",         unit: [["kg", 1], ["m", 2], ["s", -3], ["A", -1]], shorthands: ["V", "kV"], description: "electric potential difference" },
  { name: "charge",          unit: [["A", 1], ["s", 1]], shorthands: ["C", "mC", "Ah"], description: "electric charge" },
  { name: "area",            unit: [["m", 2]], shorthands: ["m²", "km²"], description: "extent of surface" },
  { name: "volume",          unit: [["m", 3]], shorthands: ["m³", "L", "mL"], description: "extent of space" },
  { name: "density",         unit: [["kg", 1], ["m", -3]], shorthands: ["kg/m³", "g/cm³"], description: "mass per unit volume" },
  { name: "molar amount",    unit: [["mol", 1]], shorthands: ["mol", "mmol"], description: "amount of substance" },
  { name: "angular velocity",unit: [["s", -1]], shorthands: ["rad/s", "rpm"], description: "rate of angle change (same base as frequency)" },
];

/** Quantity-name → expected dimension. Used when a claim explicitly
 *  names a physical kind ("thrust", "altitude", "specific impulse"). */
export const QUANTITY_DIMENSION: Record<string, string> = {
  thrust: "force",
  force: "force",
  weight: "force",
  drag: "force",
  lift: "force",
  altitude: "length",
  radius: "length",
  distance: "length",
  diameter: "length",
  length: "length",
  width: "length",
  height: "length",
  pressure: "pressure",
  burst: "pressure",
  vacuum: "pressure",
  energy: "energy",
  work: "energy",
  enthalpy: "energy",
  power: "power",
  output: "power",
  velocity: "velocity",
  speed: "velocity",
  "delta-v": "velocity",
  "deltav": "velocity",
  acceleration: "acceleration",
  mass: "mass",
  density: "density",
  temperature: "temperature",
  duration: "time",
  period: "time",
  frequency: "frequency",
  charge: "charge",
  current: "current",
  voltage: "voltage",
  area: "area",
  volume: "volume",
  isp: "velocity",                 // specific impulse expressed in seconds is non-canonical; effective exhaust v is velocity
  "specific impulse": "velocity",
  torque: "energy",                // SI base equals energy; we flag AMBIGUOUS
  rate: "frequency",
};

export type Verdict = "MATCH" | "MISMATCH" | "AMBIGUOUS" | "UNKNOWN_QUANTITY" | "UNKNOWN_UNIT";

export interface DimensionalReport {
  v: 1;
  verdict: Verdict;
  /** The quantity name extracted (if any). */
  quantity?: string;
  /** Expected dimension class label (from QUANTITY_DIMENSION). */
  expected?: string;
  /** Observed dimension class label (from parsed unit). */
  observed?: string;
  /** Suggested corrections (for MISMATCH only). */
  suggestions: string[];
  /** Raw inputs for debug. */
  raw: { unitText: string; siUnit: Unit | null };
  /** Plain-English rationale. */
  rationale: string;
}

function classifyDimension(unit: Unit): string | null {
  for (const dc of DIMENSION_CLASSES) {
    if (unitsEqual(unit, dc.unit)) return dc.name;
  }
  return null;
}

/** Pull (quantity, value, unit) from a claim of the form
 *  "QUANTITY = VALUE UNIT ..." or "QUANTITY is VALUE UNIT ...".
 *  Tolerates trailing prose after the unit.  Quantity is the
 *  substring between the start of the claim and the equals/is verb. */
function extract(claim: string): { quantity?: string; unitText: string } {
  // Match: <quantity> = <number> <unit> <anything>
  const m = claim.match(/^(.+?)\s*(?:=|is|:|equals?|of)\s*[-+]?[\d.,]+(?:[eE][-+]?\d+|\s*[×x]\s*10\^?-?\d+)?\s*([A-Za-zµμ°/²³·\^\-\d]+)\b/);
  if (m) return { quantity: m[1]!.trim().toLowerCase(), unitText: m[2]!.trim() };
  // No verb — try to parse a trailing (number, unit) pair anywhere.
  const mu = claim.match(/[-+]?[\d.,]+(?:[eE][-+]?\d+|\s*[×x]\s*10\^?-?\d+)?\s*([A-Za-zµμ°/²³·\^\-\d]+)\b/);
  if (mu) return { unitText: mu[1]! };
  return { unitText: "" };
}

export function dimensionalCheck(claim: string): DimensionalReport {
  const { quantity, unitText } = extract(claim);
  if (!unitText) {
    return { v: 1, verdict: "UNKNOWN_UNIT", suggestions: [], raw: { unitText, siUnit: null }, rationale: "No unit detected in the claim." };
  }
  const pu = parseUnit(unitText);
  if (!pu) {
    return { v: 1, verdict: "UNKNOWN_UNIT", suggestions: [], raw: { unitText, siUnit: null }, rationale: `Unit '${unitText}' not recognised. Add a prefix or check spelling.` };
  }
  const observed = classifyDimension(pu.unit);
  if (!quantity) {
    return { v: 1, verdict: "UNKNOWN_QUANTITY", observed: observed ?? undefined, suggestions: [], raw: { unitText, siUnit: pu.unit }, rationale: observed
      ? `Quantity name not detected. Unit '${unitText}' is dimension '${observed}'.`
      : `Quantity name not detected; unit '${unitText}' is unrecognised dimensionally.` };
  }
  const expected = QUANTITY_DIMENSION[quantity] ?? Object.entries(QUANTITY_DIMENSION).find(([k]) => quantity.includes(k))?.[1];
  if (!expected) {
    return { v: 1, verdict: "UNKNOWN_QUANTITY", quantity, observed: observed ?? undefined, suggestions: [], raw: { unitText, siUnit: pu.unit }, rationale: `Quantity '${quantity}' not in dimension dictionary; cannot judge.` };
  }
  if (!observed) {
    return { v: 1, verdict: "UNKNOWN_UNIT", quantity, expected, suggestions: [`'${unitText}' did not match any known dimension class`], raw: { unitText, siUnit: pu.unit }, rationale: `Unit '${unitText}' parsed but unclassified.` };
  }
  if (observed === expected) {
    return { v: 1, verdict: "MATCH", quantity, expected, observed, suggestions: [], raw: { unitText, siUnit: pu.unit }, rationale: `'${quantity}' should be dimension '${expected}'; '${unitText}' is dimension '${observed}' ✓.` };
  }
  // Special case: energy + torque share SI base vector — flag AMBIGUOUS.
  if (
    (expected === "energy" && observed === "energy") ||
    (expected === "torque" && observed === "energy") ||
    (expected === "frequency" && observed === "angular velocity") ||
    (expected === "angular velocity" && observed === "frequency")
  ) {
    return { v: 1, verdict: "AMBIGUOUS", quantity, expected, observed, suggestions: [`'${expected}' and '${observed}' share an SI base vector; verify by context.`], raw: { unitText, siUnit: pu.unit }, rationale: `'${quantity}' is dimensionally compatible but physically distinct from the implied unit class.` };
  }
  // MISMATCH — collect suggestions: list shorthands for expected.
  const expectedClass = DIMENSION_CLASSES.find((d) => d.name === expected);
  const suggestions: string[] = [];
  if (expectedClass) suggestions.push(`'${quantity}' is '${expected}'; use one of: ${expectedClass.shorthands.join(", ")}`);
  suggestions.push(`Did you mean a '${observed}' quantity? Common ${observed} terms: ${Object.entries(QUANTITY_DIMENSION).filter(([, d]) => d === observed).map(([k]) => k).slice(0, 4).join(", ")}`);
  return {
    v: 1, verdict: "MISMATCH", quantity, expected, observed, suggestions,
    raw: { unitText, siUnit: pu.unit },
    rationale: `'${quantity}' should be dimension '${expected}', but '${unitText}' parses as '${observed}' — dimensional mismatch.`,
  };
}

export function formatReport(r: DimensionalReport): string {
  const badge = r.verdict === "MATCH" ? "✓" : r.verdict === "MISMATCH" ? "✗" : r.verdict === "AMBIGUOUS" ? "⚠" : "·";
  const lines: string[] = [
    `📐 DIMENSIONAL ORACLE — ${badge} ${r.verdict}`,
    "",
    `  ${r.rationale}`,
  ];
  if (r.quantity || r.expected || r.observed) {
    lines.push("");
    if (r.quantity) lines.push(`  Quantity:  ${r.quantity}`);
    if (r.expected) lines.push(`  Expected:  ${r.expected}`);
    if (r.observed) lines.push(`  Observed:  ${r.observed}`);
    if (r.raw.siUnit) lines.push(`  SI base:   ${formatUnit(r.raw.siUnit)}`);
  }
  if (r.suggestions.length > 0) {
    lines.push("");
    lines.push(`  Suggestions:`);
    for (const s of r.suggestions) lines.push(`    - ${s}`);
  }
  return lines.join("\n");
}

export function listDimensions(): DimensionClass[] { return DIMENSION_CLASSES; }
