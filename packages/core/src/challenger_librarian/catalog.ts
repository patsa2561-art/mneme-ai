/**
 * v2.22.2 — CHALLENGER LIBRARIAN · CATALOG.
 *
 * Curated knowledge base of historical aerospace + safety-critical
 * software failures with extracted root-cause patterns. Each entry
 * carries:
 *   - Plain-English summary
 *   - The pattern signature (keywords + structural fingerprint)
 *   - A detector type (delegates to DIMENSIONAL ORACLE / PHYSICS
 *     LATHE / regex when appropriate)
 *   - Citation
 *
 * Coverage is intentionally NOT exhaustive — these are the cases
 * cited every time aerospace AI training data is audited. Adding
 * entries: extend this array + write a test that the pattern fires
 * on a realistic phrasing.
 */

export type DetectorKind =
  | "dimensional"       // delegates to dimensional_oracle.dimensionalCheck
  | "physics-axiom"     // delegates to physics_lathe.physicsCheck
  | "keyword"           // simple substring/regex on the plan text
  | "structural";       // shape match (e.g. retry-without-state-reset)

export interface FailurePattern {
  id: string;
  name: string;
  date: string;          // approximate event date
  /** Plain-English summary of the historical failure. */
  summary: string;
  /** Plain-English root cause. */
  rootCause: string;
  /** The detector type. */
  detector: DetectorKind;
  /** For keyword detectors: regex or substring list (lowercased). */
  triggers?: string[];
  /** For dimensional detectors: pre-canned claim phrasings to test. */
  dimensionalProbes?: string[];
  /** For physics-axiom detectors: phrasings that should be REFUTED if
   *  the plan repeats the historical mistake. */
  physicsProbes?: string[];
  /** Avoidance prescription. */
  avoid: string;
  citation: string;
}

export const FAILURES: FailurePattern[] = [
  {
    id: "mars-climate-orbiter",
    name: "Mars Climate Orbiter",
    date: "1999-09-23",
    summary: "Spacecraft disintegrated on Mars atmospheric entry; lost ~$327M mission.",
    rootCause: "Software computed thruster force in pound-seconds while the spec required Newton-seconds — a unit-conversion bug in the ground-side trajectory model.",
    detector: "dimensional",
    dimensionalProbes: [
      "thrust = ${value} lbf·s",
      "thrust = ${value} N·s",
    ],
    triggers: ["pound", "lbf", "imperial", "mixed units", "non-si"],
    avoid: "All flight + ground systems publish a single canonical unit (SI). Cross-system data passes the dimensional oracle BEFORE write.",
    citation: "NASA MCO Mishap Investigation Board 1999",
  },
  {
    id: "challenger-o-ring",
    name: "Challenger STS-51-L",
    date: "1986-01-28",
    summary: "Space Shuttle Challenger broke apart 73 seconds into flight; 7 crew lost.",
    rootCause: "SRB O-ring lost elasticity below ~12 °C operating range; launched at ~-2 °C. The temperature was OUTSIDE the qualified operating envelope.",
    detector: "physics-axiom",
    physicsProbes: [
      "O-ring qualified down to 12 °C",
      "ambient temperature is -2 °C",
    ],
    triggers: ["o-ring", "cold launch", "below operating", "temperature limit", "qualification range"],
    avoid: "No safety-critical seal operated below its qualified range. Plan-time check: ambient temperature in qualified envelope?",
    citation: "Rogers Commission Report 1986",
  },
  {
    id: "columbia-foam-strike",
    name: "Columbia STS-107",
    date: "2003-02-01",
    summary: "Shuttle Columbia broke apart on re-entry; 7 crew lost.",
    rootCause: "Foam debris struck the left wing's RCC panel during ascent; damage went uninspected; re-entry heating breached the wing.",
    detector: "keyword",
    triggers: ["normalised deviance", "we always do that", "no inspection needed", "previous flights had foam"],
    avoid: "An observed anomaly that hasn't caused harm yet is STILL an anomaly. Plan must include inspection if the failure mode is plausible — not 'previous flights got away with it'.",
    citation: "CAIB Report 2003",
  },
  {
    id: "apollo-1-fire",
    name: "Apollo 1 plugs-out test",
    date: "1967-01-27",
    summary: "Cabin fire during ground test; 3 crew lost.",
    rootCause: "Pure-O₂ atmosphere at 16.7 psi (over-pressure) + flammable Velcro / wiring + spark from worn coolant line. Hatch opened INWARD → trapped crew.",
    detector: "keyword",
    triggers: ["pure oxygen", "100% o2", "16.7 psi", "inward-opening hatch", "ground test pressurised"],
    avoid: "Pure-O₂ atmospheres at over-pressure require non-flammable interior + outward-opening hatch. Plan-time check covers all three.",
    citation: "Apollo 204 Review Board 1967",
  },
  {
    id: "ariane-5-501",
    name: "Ariane 5 Flight 501",
    date: "1996-06-04",
    summary: "Maiden Ariane 5 launch self-destructed 37 seconds after liftoff.",
    rootCause: "Inertial Reference System reused Ariane 4 software; 64-bit floating-point horizontal velocity overflowed when cast to 16-bit signed integer at the higher Ariane 5 velocities.",
    detector: "keyword",
    triggers: ["reuse software", "untested at new range", "16-bit", "overflow", "casting", "ariane 4", "convert without bounds"],
    avoid: "Reused safety-critical code MUST be re-qualified for the new flight envelope. Plan-time check: any integer cast that wasn't bounds-checked for the new range?",
    citation: "Ariane 501 Inquiry Board 1996",
  },
  {
    id: "therac-25",
    name: "Therac-25 radiation overdose",
    date: "1985-1987",
    summary: "Software-driven radiotherapy machine delivered ~100× lethal doses; 3 patients died.",
    rootCause: "Race condition between operator data-entry editor and turntable position controller; concurrent set-up could let high-energy beam fire without the X-ray attenuator in place.",
    detector: "structural",
    triggers: ["race condition", "no hardware interlock", "software-only safety", "concurrent state", "fast operator"],
    avoid: "Software-only safety on a high-energy beam is forbidden. Hardware interlock IS the safety; software is hint, not gate.",
    citation: "Leveson + Turner 1993",
  },
  {
    id: "mariner-1",
    name: "Mariner 1 launch failure",
    date: "1962-07-22",
    summary: "Atlas-Agena B carrying Mariner 1 Venus probe destroyed by Range Safety 5 minutes after launch.",
    rootCause: "Transcription error in guidance equations — a missing overbar in a hand-written specification became wrong code; trajectory diverged.",
    detector: "keyword",
    triggers: ["hand-written spec", "transcription", "missing bar", "missing overbar", "trajectory diverge"],
    avoid: "Hand-transcribed equations require independent re-derivation OR formal source. No 'this is what was on the chalkboard' rocketry.",
    citation: "NASA Mariner 1 PCI Report 1962",
  },
  {
    id: "soyuz-1-parachute",
    name: "Soyuz 1",
    date: "1967-04-24",
    summary: "Soyuz 1 main parachute failed to deploy; capsule impacted at terminal velocity; cosmonaut Komarov lost.",
    rootCause: "Multiple known defects in pre-flight inspection; pressure differential between drogue + main chute container caused jamming.",
    detector: "keyword",
    triggers: ["known defect", "203 components failed", "pressure differential", "drogue jam", "rushed schedule"],
    avoid: "Pre-flight defect list is NEVER ignored. 'Rushed for political deadline' is not engineering input.",
    citation: "Soviet Soyuz 1 Investigation 1967",
  },
];

export function findFailure(id: string): FailurePattern | null {
  return FAILURES.find((f) => f.id === id) ?? null;
}

export function listFailures(): FailurePattern[] { return FAILURES; }
