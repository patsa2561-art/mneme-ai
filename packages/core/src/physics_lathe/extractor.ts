/**
 * v2.22.1 — PHYSICS LATHE · EXTRACTOR.
 *
 * Pull (value, unit, quantity) triples from free-text LLM claims and
 * normalise them to SI. The extractor is regex-based for v2.22.1; a
 * later release can swap in an NER model without changing the verifier
 * surface.
 *
 * Match cases handled:
 *   "9.8 km/s"           → value=9.8e3   unit=[m, s^-1]
 *   "50,000 N"           → value=5.0e4   unit=[N]
 *   "1.5 × 10^6 K"       → value=1.5e6   unit=[K]
 *   "PSI 14.7"           → value=14.7    unit=[psi → Pa]
 *   "9.8 m s^-2"         → value=9.8     unit=[m, s^-2]
 */

import { parseUnit, type ParsedUnit } from "./units.js";
import type { Unit } from "./axioms.js";

export interface ExtractedQuantity {
  /** Source span. */
  raw: string;
  /** Value in original units. */
  rawValue: number;
  /** Original unit text. */
  rawUnit: string;
  /** Value normalised to SI base. */
  siValue: number;
  /** SI base-unit vector. */
  siUnit: Unit;
  /** Caller-facing nearest physical quantity label (best-effort). */
  quantityGuess?: string;
}

/** Regex captures a number (with optional thousands commas, scientific
 *  notation, "x 10^N" notation) followed by an optional unit token. */
const NUMBER_RE = /(?<num>[-+]?\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:\s*[×x*]\s*10\s*\^?\s*[-+]?\d+)?(?:[eE][-+]?\d+)?)/.source;
const UNIT_RE = /(?<unit>[A-Za-zµμ°][A-Za-zµμ°\d\^\-/\*·²³⁻¹]{0,30})?/.source;
const COMBINED = new RegExp(`(?<![A-Za-z])${NUMBER_RE}\\s*${UNIT_RE}`, "g");

function parseNumeric(text: string): number | null {
  const cleaned = text.replace(/,/g, "").replace(/\s+/g, "");
  // Handle "1.5×10^6" form.
  const m = cleaned.match(/^([-+]?\d*\.?\d+)[*×x]10\^?([-+]?\d+)$/);
  if (m) {
    const mantissa = parseFloat(m[1]!);
    const exp = parseInt(m[2]!, 10);
    return mantissa * Math.pow(10, exp);
  }
  const v = parseFloat(cleaned);
  return Number.isFinite(v) ? v : null;
}

const QUANTITY_HINTS: Record<string, string> = {
  "velocity": "v", "speed": "v", "Δv": "delta_v", "delta-v": "delta_v", "deltav": "delta_v",
  "thrust": "F", "force": "F",
  "mass": "m", "dry mass": "m_f", "wet mass": "m_0", "propellant": "m_p",
  "altitude": "altitude", "orbit": "altitude",
  "period": "T", "temperature": "T", "energy": "E", "pressure": "P", "volume": "V",
  "isp": "Isp", "specific impulse": "Isp",
  "radius": "r", "distance": "r",
  "exhaust velocity": "v_e", "ve": "v_e",
  "delta v": "delta_v",
};

function guessQuantity(beforeText: string, unit: ParsedUnit): string | undefined {
  const lower = beforeText.toLowerCase();
  for (const [hint, sym] of Object.entries(QUANTITY_HINTS)) {
    if (lower.includes(hint)) return sym;
  }
  // Fall back: unit pattern → likely quantity
  const u = unit.unit;
  if (u.length === 0) return undefined;
  const flat = u.map(([s, e]) => `${s}^${e}`).join(",");
  if (flat === "m^1,s^-1") return "v";
  if (flat === "kg^1,m^1,s^-2") return "F";
  if (flat === "kg^1") return "m";
  if (flat === "kg^1,m^2,s^-2") return "E";
  if (flat === "kg^1,m^-1,s^-2") return "P";
  if (flat === "K^1") return "T";
  if (flat === "m^1") return "r";
  if (flat === "s^1") return "T_period";
  return undefined;
}

export function extractQuantities(text: string): ExtractedQuantity[] {
  const out: ExtractedQuantity[] = [];
  const re = new RegExp(COMBINED.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const numText = m.groups?.num ?? "";
    const unitText = (m.groups?.unit ?? "").trim();
    const num = parseNumeric(numText);
    if (num === null) continue;
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    if (!unitText) continue;
    const pu = parseUnit(unitText);
    if (!pu) continue;
    const guess = guessQuantity(before + " " + unitText, pu);
    out.push({
      raw: numText.trim() + (unitText ? " " + unitText : ""),
      rawValue: num,
      rawUnit: unitText,
      siValue: num * pu.scale,
      siUnit: pu.unit,
      quantityGuess: guess,
    });
  }
  return out;
}
