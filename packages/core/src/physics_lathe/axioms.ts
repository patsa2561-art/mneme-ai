/**
 * v2.22.1 — PHYSICS LATHE · AXIOMS.
 *
 * Hardcoded SI-unit physics axioms (constants + equations) used to
 * verify LLM claims that involve physical quantities. Each axiom
 * carries the variables it relates, their SI units, an optional
 * canonical numeric value, and tolerance for the dimensional check.
 *
 * Coverage is intentionally rocket-/orbital-/thermo-leaning — the
 * domains where LLM hallucinations are most expensive (wrong delta-v,
 * wrong heat budget, wrong orbital altitude).
 *
 * For a claim "X needs N <unit> of <quantity> to do Y", the verifier
 * picks the axiom(s) whose variable set matches the units in the
 * claim, substitutes the supplied values, and checks consistency.
 */

export type SiBase =
  | "m" | "kg" | "s" | "A" | "K" | "mol" | "cd"
  | "rad" | "Hz" | "N" | "Pa" | "J" | "W" | "V" | "Ω" | "T" | "C" | "F" | "H";

/** A unit can be a list of (base, exponent) pairs, e.g. acceleration =
 *  [["m", 1], ["s", -2]]. We canonicalise to base SI for comparison. */
export type Unit = Array<[SiBase, number]>;

export interface Constant {
  symbol: string;
  /** Plain-English label. */
  name: string;
  /** Canonical SI value. */
  value: number;
  /** SI units. */
  unit: Unit;
  /** Source citation. */
  citation: string;
}

export const CONSTANTS: Constant[] = [
  { symbol: "c", name: "speed of light in vacuum", value: 2.99792458e8, unit: [["m", 1], ["s", -1]], citation: "CODATA 2018 (exact)" },
  { symbol: "G", name: "Newtonian gravitational constant", value: 6.67430e-11, unit: [["m", 3], ["kg", -1], ["s", -2]], citation: "CODATA 2018" },
  { symbol: "g₀", name: "standard surface gravity (Earth)", value: 9.80665, unit: [["m", 1], ["s", -2]], citation: "BIPM (defined)" },
  { symbol: "k_B", name: "Boltzmann constant", value: 1.380649e-23, unit: [["J", 1], ["K", -1]], citation: "SI 2019 (exact)" },
  { symbol: "h", name: "Planck constant", value: 6.62607015e-34, unit: [["J", 1], ["s", 1]], citation: "SI 2019 (exact)" },
  { symbol: "N_A", name: "Avogadro number", value: 6.02214076e23, unit: [["mol", -1]], citation: "SI 2019 (exact)" },
  { symbol: "R", name: "molar gas constant", value: 8.314462618, unit: [["J", 1], ["mol", -1], ["K", -1]], citation: "CODATA" },
  { symbol: "σ", name: "Stefan-Boltzmann constant", value: 5.670374419e-8, unit: [["W", 1], ["m", -2], ["K", -4]], citation: "CODATA" },
  { symbol: "M_E", name: "Earth mass", value: 5.9722e24, unit: [["kg", 1]], citation: "IAU" },
  { symbol: "R_E", name: "Earth radius (mean)", value: 6.371e6, unit: [["m", 1]], citation: "IUGG" },
  { symbol: "M_M", name: "Moon mass", value: 7.342e22, unit: [["kg", 1]], citation: "NASA" },
  { symbol: "M_Mars", name: "Mars mass", value: 6.4171e23, unit: [["kg", 1]], citation: "NASA" },
  { symbol: "R_Mars", name: "Mars radius (equatorial)", value: 3.3895e6, unit: [["m", 1]], citation: "NASA" },
  { symbol: "AU", name: "astronomical unit", value: 1.495978707e11, unit: [["m", 1]], citation: "IAU 2012 (exact)" },
  { symbol: "M_sun", name: "solar mass", value: 1.98892e30, unit: [["kg", 1]], citation: "IAU" },
];

export interface KnownValue {
  /** Human-friendly label for the LLM claim to match. */
  label: string;
  /** Plain-English description. */
  description: string;
  /** Canonical value in SI. */
  value: number;
  unit: Unit;
  /** Acceptable relative error (e.g. 0.05 = within ±5%). */
  tolerance: number;
  citation: string;
}

/** Well-known physical numbers (LEO velocity, ISS altitude, Mars
 *  escape velocity, etc.). The verifier matches a claim's
 *  (quantity, unit) tuple against this list before falling back to
 *  axiom-based derivation. */
export const KNOWN_VALUES: KnownValue[] = [
  { label: "LEO orbital velocity",     description: "Circular orbital velocity at ~400 km altitude (e.g. ISS).", value: 7.66e3, unit: [["m", 1], ["s", -1]], tolerance: 0.05, citation: "Compute from v=√(GM/r) at r=R_E+400km" },
  { label: "Earth escape velocity",    description: "Escape velocity from Earth's surface.",                       value: 1.118e4, unit: [["m", 1], ["s", -1]], tolerance: 0.03, citation: "v_esc = √(2GM/R)" },
  { label: "Mars escape velocity",     description: "Escape velocity from Mars surface.",                          value: 5.03e3, unit: [["m", 1], ["s", -1]], tolerance: 0.05, citation: "v_esc = √(2GM/R) for Mars" },
  { label: "Moon escape velocity",     description: "Escape velocity from Moon surface.",                          value: 2.38e3, unit: [["m", 1], ["s", -1]], tolerance: 0.05, citation: "v_esc = √(2GM/R) for Moon" },
  { label: "ISS altitude",             description: "Nominal ISS orbital altitude above Earth's surface.",         value: 4.0e5, unit: [["m", 1]], tolerance: 0.10, citation: "NASA ISS Trajectory Operations" },
  { label: "GEO altitude",             description: "Geostationary altitude above Earth's surface.",               value: 3.5786e7, unit: [["m", 1]], tolerance: 0.01, citation: "ITU Radio Regulations" },
  { label: "LEO altitude range max",   description: "Upper limit of low Earth orbit.",                             value: 2.0e6, unit: [["m", 1]], tolerance: 0.05, citation: "NASA convention" },
  { label: "Delta-v to LEO from Earth",description: "Total delta-v from Earth's surface to a stable LEO.",         value: 9.4e3, unit: [["m", 1], ["s", -1]], tolerance: 0.10, citation: "Includes gravity + drag losses; typical 9.3-9.5 km/s" },
  { label: "Delta-v Earth-to-Moon",    description: "Single Hohmann delta-v from LEO to lunar transfer.",          value: 3.1e3, unit: [["m", 1], ["s", -1]], tolerance: 0.05, citation: "NASA mission design" },
  { label: "Delta-v Earth-to-Mars",    description: "Hohmann delta-v from LEO to Mars transfer.",                  value: 3.6e3, unit: [["m", 1], ["s", -1]], tolerance: 0.05, citation: "NASA mission design" },
];

export interface Axiom {
  /** Stable id; used in proof tree. */
  id: string;
  name: string;
  /** Plain-English formula. */
  formulaText: string;
  /** Variable symbols + their SI units. */
  variables: Array<{ symbol: string; description: string; unit: Unit }>;
  /** Apply the axiom: given variable values, compute the LHS or
   *  the bound. Implementations return either a single value (when
   *  the equation determines one variable from the rest) or null
   *  if not enough vars supplied. */
  apply: (vars: Record<string, number>) => { value: number; computed: string } | null;
  /** Tolerance (relative). */
  tolerance: number;
  citation: string;
}

const G = CONSTANTS.find((c) => c.symbol === "G")!.value;
const M_E = CONSTANTS.find((c) => c.symbol === "M_E")!.value;
const R_E = CONSTANTS.find((c) => c.symbol === "R_E")!.value;
const g0 = CONSTANTS.find((c) => c.symbol === "g₀")!.value;
const c_light = CONSTANTS.find((c) => c.symbol === "c")!.value;
const sigma = CONSTANTS.find((c) => c.symbol === "σ")!.value;
const k_B = CONSTANTS.find((c) => c.symbol === "k_B")!.value;
const R_gas = CONSTANTS.find((c) => c.symbol === "R")!.value;

export const AXIOMS: Axiom[] = [
  {
    id: "tsiolkovsky",
    name: "Tsiolkovsky rocket equation",
    formulaText: "Δv = v_e · ln(m_0 / m_f)",
    variables: [
      { symbol: "delta_v", description: "change in velocity", unit: [["m", 1], ["s", -1]] },
      { symbol: "v_e",     description: "effective exhaust velocity", unit: [["m", 1], ["s", -1]] },
      { symbol: "m_0",     description: "wet mass (initial)", unit: [["kg", 1]] },
      { symbol: "m_f",     description: "dry mass (final)", unit: [["kg", 1]] },
    ],
    apply: (v) => {
      if (v.v_e === undefined || v.m_0 === undefined || v.m_f === undefined) return null;
      if (v.m_f <= 0 || v.m_0 <= v.m_f) return null;
      const dv = v.v_e * Math.log(v.m_0 / v.m_f);
      return { value: dv, computed: `${v.v_e} * ln(${v.m_0}/${v.m_f}) = ${dv.toFixed(2)} m/s` };
    },
    tolerance: 0.02,
    citation: "Tsiolkovsky 1903",
  },
  {
    id: "newton-2nd",
    name: "Newton's second law",
    formulaText: "F = m · a",
    variables: [
      { symbol: "F", description: "force", unit: [["N", 1]] },
      { symbol: "m", description: "mass", unit: [["kg", 1]] },
      { symbol: "a", description: "acceleration", unit: [["m", 1], ["s", -2]] },
    ],
    apply: (v) => {
      if (v.m === undefined || v.a === undefined) return null;
      return { value: v.m * v.a, computed: `${v.m} * ${v.a} = ${(v.m * v.a).toFixed(2)} N` };
    },
    tolerance: 0.01,
    citation: "Newton Principia 1687",
  },
  {
    id: "kinetic-energy",
    name: "Classical kinetic energy",
    formulaText: "KE = (1/2) · m · v²",
    variables: [
      { symbol: "KE", description: "kinetic energy", unit: [["J", 1]] },
      { symbol: "m",  description: "mass", unit: [["kg", 1]] },
      { symbol: "v",  description: "speed", unit: [["m", 1], ["s", -1]] },
    ],
    apply: (v) => {
      if (v.m === undefined || v.v === undefined) return null;
      const ke = 0.5 * v.m * v.v * v.v;
      return { value: ke, computed: `0.5 * ${v.m} * ${v.v}² = ${ke.toFixed(2)} J` };
    },
    tolerance: 0.01,
    citation: "Standard mechanics",
  },
  {
    id: "circular-orbital-v",
    name: "Circular orbital velocity",
    formulaText: "v = √(GM / r)",
    variables: [
      { symbol: "v", description: "orbital velocity", unit: [["m", 1], ["s", -1]] },
      { symbol: "M", description: "central body mass", unit: [["kg", 1]] },
      { symbol: "r", description: "orbital radius from center of mass", unit: [["m", 1]] },
    ],
    apply: (v) => {
      if (v.M === undefined || v.r === undefined || v.r <= 0) return null;
      const vel = Math.sqrt(G * v.M / v.r);
      return { value: vel, computed: `√(G·${v.M}/${v.r}) = ${vel.toFixed(2)} m/s` };
    },
    tolerance: 0.02,
    citation: "Newtonian gravity",
  },
  {
    id: "escape-velocity",
    name: "Escape velocity from a spherical body",
    formulaText: "v_esc = √(2GM / r)",
    variables: [
      { symbol: "v_esc", description: "escape velocity", unit: [["m", 1], ["s", -1]] },
      { symbol: "M",     description: "body mass", unit: [["kg", 1]] },
      { symbol: "r",     description: "distance from center", unit: [["m", 1]] },
    ],
    apply: (v) => {
      if (v.M === undefined || v.r === undefined || v.r <= 0) return null;
      const vesc = Math.sqrt(2 * G * v.M / v.r);
      return { value: vesc, computed: `√(2G·${v.M}/${v.r}) = ${vesc.toFixed(2)} m/s` };
    },
    tolerance: 0.02,
    citation: "Standard celestial mechanics",
  },
  {
    id: "kepler-3rd",
    name: "Kepler's third law (Newtonian form)",
    formulaText: "T² = (4π² / GM) · a³",
    variables: [
      { symbol: "T", description: "orbital period", unit: [["s", 1]] },
      { symbol: "a", description: "semi-major axis", unit: [["m", 1]] },
      { symbol: "M", description: "central body mass", unit: [["kg", 1]] },
    ],
    apply: (v) => {
      if (v.M === undefined || v.a === undefined) return null;
      const T = Math.sqrt((4 * Math.PI ** 2 * v.a ** 3) / (G * v.M));
      return { value: T, computed: `√(4π²·${v.a}³ / G·${v.M}) = ${T.toFixed(2)} s` };
    },
    tolerance: 0.02,
    citation: "Kepler 1619 / Newton 1687",
  },
  {
    id: "ideal-gas",
    name: "Ideal gas law",
    formulaText: "PV = nRT",
    variables: [
      { symbol: "P", description: "pressure", unit: [["Pa", 1]] },
      { symbol: "V", description: "volume", unit: [["m", 3]] },
      { symbol: "n", description: "amount of substance", unit: [["mol", 1]] },
      { symbol: "T", description: "absolute temperature", unit: [["K", 1]] },
    ],
    apply: (v) => {
      if (v.n === undefined || v.T === undefined) return null;
      // Solve for PV given n,T; user can compare with their P·V.
      const pv = v.n * R_gas * v.T;
      return { value: pv, computed: `${v.n} · R · ${v.T} = ${pv.toFixed(2)} Pa·m³` };
    },
    tolerance: 0.02,
    citation: "Standard thermodynamics",
  },
  {
    id: "stefan-boltzmann",
    name: "Stefan-Boltzmann (blackbody radiation)",
    formulaText: "P = ε · σ · A · T⁴",
    variables: [
      { symbol: "P", description: "radiated power", unit: [["W", 1]] },
      { symbol: "A", description: "surface area", unit: [["m", 2]] },
      { symbol: "T", description: "absolute temperature", unit: [["K", 1]] },
      { symbol: "ε", description: "emissivity (0-1)", unit: [] }, // dimensionless
    ],
    apply: (v) => {
      if (v.A === undefined || v.T === undefined) return null;
      const eps = v.ε ?? 1;
      const P = eps * sigma * v.A * v.T ** 4;
      return { value: P, computed: `${eps} · σ · ${v.A} · ${v.T}⁴ = ${P.toFixed(2)} W` };
    },
    tolerance: 0.05,
    citation: "Stefan-Boltzmann 1879",
  },
  {
    id: "mass-energy",
    name: "Mass-energy equivalence",
    formulaText: "E = m · c²",
    variables: [
      { symbol: "E", description: "rest energy", unit: [["J", 1]] },
      { symbol: "m", description: "rest mass", unit: [["kg", 1]] },
    ],
    apply: (v) => {
      if (v.m === undefined) return null;
      const E = v.m * c_light ** 2;
      return { value: E, computed: `${v.m} · c² = ${E.toExponential(3)} J` };
    },
    tolerance: 0.01,
    citation: "Einstein 1905",
  },
  {
    id: "boltzmann-thermal-energy",
    name: "Boltzmann thermal energy",
    formulaText: "E ≈ (3/2) · k_B · T",
    variables: [
      { symbol: "E", description: "average particle thermal energy", unit: [["J", 1]] },
      { symbol: "T", description: "absolute temperature", unit: [["K", 1]] },
    ],
    apply: (v) => {
      if (v.T === undefined) return null;
      const E = 1.5 * k_B * v.T;
      return { value: E, computed: `1.5 · k_B · ${v.T} = ${E.toExponential(3)} J` };
    },
    tolerance: 0.02,
    citation: "Equipartition theorem",
  },
];

/** Combined view used by the verifier. */
export function allAxioms(): Axiom[] { return AXIOMS; }
export function allConstants(): Constant[] { return CONSTANTS; }
export function allKnownValues(): KnownValue[] { return KNOWN_VALUES; }
