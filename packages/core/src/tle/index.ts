/**
 * TLE INTELLIGENCE — read a two-line element set and tell an ops agent what it needs to know about
 * a satellite, deterministically + exactly: its orbit (period, altitude, class), how STALE the
 * element set is (a TLE more than ~2 weeks old is unreliable for operations — a real, costly gotcha),
 * and its decay risk. Pure two-body / Keplerian characterization from the TLE fields — every number
 * is exact + reproducible.
 *
 * ★HONEST (DIAKRISIS): this is orbit CHARACTERIZATION + element-set HEALTH from the TLE — it is NOT
 * an SGP4 position ephemeris (precise where-is-it-now needs the full SGP4/SDP4 propagator with drag
 * + J2 perturbations, validated against the standard reference vectors; that is a separate piece and
 * I won't fake it here). What this gives is correct: the semi-major axis from mean motion is exact
 * (Kepler's third law), and orbit class / period / apogee-perigee / staleness / decay-risk are all
 * deterministic and testable against known satellites.
 */

const MU = 398600.4418;          // Earth gravitational parameter, km³/s²
const R_EARTH = 6378.137;        // equatorial radius, km
const TWO_PI = Math.PI * 2;

export interface TleElements {
  valid: boolean; reasons: string[];
  catalog: string; classification: string; intlDesignator: string;
  epochYear: number; epochDay: number; epochMs: number | null;
  inclinationDeg: number; raanDeg: number; eccentricity: number; argPerigeeDeg: number; meanAnomalyDeg: number;
  meanMotionRevPerDay: number; bstar: number; revAtEpoch: number;
}

function num(s: string): number { const n = parseFloat(String(s).trim()); return Number.isFinite(n) ? n : 0; }
/** Parse an "assumed-decimal with exponent" TLE field, e.g. " 11606-4" → 0.11606e-4, "-11606-4" → -…. */
function expField(s: string): number {
  const t = String(s).trim(); if (!t) return 0;
  const m = t.match(/^([+-]?)(\d+)([+-]\d)$/);
  if (!m) { const v = parseFloat(t); return Number.isFinite(v) ? v : 0; }
  const sign = m[1] === "-" ? -1 : 1; const mant = parseFloat("0." + m[2]); const exp = parseInt(m[3], 10);
  return sign * mant * Math.pow(10, exp);
}
function epochToMs(yy: number, day: number): number | null {
  if (!Number.isFinite(yy) || !Number.isFinite(day)) return null;
  const year = yy < 57 ? 2000 + yy : 1900 + yy;            // TLE epoch-year convention
  const jan1 = Date.UTC(year, 0, 1);
  return jan1 + (day - 1) * 86400000;
}

/** Parse a TLE (two lines). Tolerant of whitespace; reports validity without throwing. */
export function parseTle(line1: string, line2: string): TleElements {
  const reasons: string[] = [];
  const l1 = String(line1 ?? ""), l2 = String(line2 ?? "");
  if (l1[0] !== "1") reasons.push("line 1 does not start with '1'");
  if (l2[0] !== "2") reasons.push("line 2 does not start with '2'");
  const catalog = l1.slice(2, 7).trim() || l2.slice(2, 7).trim();
  const meanMotionRevPerDay = num(l2.slice(52, 63));
  if (meanMotionRevPerDay <= 0) reasons.push("mean motion missing/invalid");
  const eccentricity = num("0." + l2.slice(26, 33).trim());
  return {
    valid: reasons.length === 0, reasons,
    catalog, classification: l1.slice(7, 8).trim(), intlDesignator: l1.slice(9, 17).trim(),
    epochYear: num(l1.slice(18, 20)), epochDay: num(l1.slice(20, 32)), epochMs: epochToMs(num(l1.slice(18, 20)), num(l1.slice(20, 32))),
    inclinationDeg: num(l2.slice(8, 16)), raanDeg: num(l2.slice(17, 25)), eccentricity,
    argPerigeeDeg: num(l2.slice(34, 42)), meanAnomalyDeg: num(l2.slice(43, 51)),
    meanMotionRevPerDay, bstar: expField(l1.slice(53, 61)), revAtEpoch: num(l2.slice(63, 68)),
  };
}

export type OrbitClass = "LEO" | "MEO" | "GEO" | "HEO" | "Molniya" | "unknown";
export interface OrbitInfo {
  periodMin: number; semiMajorKm: number; apogeeAltKm: number; perigeeAltKm: number;
  eccentricity: number; inclinationDeg: number; orbitClass: OrbitClass;
}
/** Exact two-body characterization from the element set (Kepler's third law). */
export function orbitInfo(el: TleElements): OrbitInfo {
  const n = (Number(el?.meanMotionRevPerDay) || 0) * TWO_PI / 86400;   // rad/s
  const a = n > 0 ? Math.cbrt(MU / (n * n)) : 0;                       // semi-major axis, km (exact)
  const e = Math.min(0.999, Math.max(0, Number(el?.eccentricity) || 0));
  const apo = a * (1 + e) - R_EARTH, peri = a * (1 - e) - R_EARTH;
  const periodMin = n > 0 ? (TWO_PI / n) / 60 : 0;
  const inc = Number(el?.inclinationDeg) || 0;
  let orbitClass: OrbitClass = "unknown";
  if (a > 0) {
    const meanAlt = a - R_EARTH;
    if (e > 0.25 && periodMin > 600 && periodMin < 800 && inc > 60 && inc < 65) orbitClass = "Molniya";
    else if (e > 0.25) orbitClass = "HEO";
    else if (periodMin > 1400 && periodMin < 1500) orbitClass = "GEO";
    else if (meanAlt < 2000) orbitClass = "LEO";
    else if (meanAlt < 35000) orbitClass = "MEO";
    else orbitClass = "GEO";
  }
  return { periodMin: round(periodMin, 2), semiMajorKm: round(a, 1), apogeeAltKm: round(apo, 1), perigeeAltKm: round(peri, 1), eccentricity: round(e, 5), inclinationDeg: round(inc, 2), orbitClass };
}
const round = (n: number, d: number): number => { const f = 10 ** d; return Math.round((Number(n) || 0) * f) / f; };

export type StaleBand = "fresh" | "aging" | "stale" | "expired";
export interface Staleness { ageDays: number | null; band: StaleBand; note: string }
/** A TLE degrades with age — past ~14 days a propagated position can be off by many km. */
export function tleStaleness(el: TleElements, nowMs: number): Staleness {
  if (!el?.epochMs) return { ageDays: null, band: "expired", note: "no usable epoch" };
  const ageDays = round((Number(nowMs) - el.epochMs) / 86400000, 2);
  const band: StaleBand = ageDays < 0 ? "fresh" : ageDays <= 3 ? "fresh" : ageDays <= 14 ? "aging" : ageDays <= 30 ? "stale" : "expired";
  const note = band === "fresh" ? "current — safe to use" : band === "aging" ? "still usable; refresh soon" : band === "stale" ? "refresh before relying on it (position drift grows)" : "too old — fetch a fresh element set";
  return { ageDays, band, note };
}

export interface DecayRisk { band: "stable" | "watch" | "decaying" | "imminent"; perigeeAltKm: number; note: string }
/** Decay risk from perigee altitude + the B* drag term. Low perigee + high drag ⇒ orbit is dropping. */
export function decayRisk(el: TleElements): DecayRisk {
  const oi = orbitInfo(el); const peri = oi.perigeeAltKm; const drag = Math.abs(Number(el?.bstar) || 0);
  let band: DecayRisk["band"] = "stable";
  if (peri < 160) band = "imminent";
  else if (peri < 250 && drag > 1e-3) band = "decaying";
  else if (peri < 400 && drag > 5e-4) band = "watch";
  const note = band === "imminent" ? "perigee very low — reentry likely soon" : band === "decaying" ? "low perigee + high drag — actively decaying" : band === "watch" ? "low LEO with drag — monitor" : "no near-term decay signal";
  return { band, perigeeAltKm: peri, note };
}

// ── gauntlet (validated against KNOWN real orbits) ──────────────────────────────
export interface TleGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function tleGauntlet(): TleGauntlet {
  // ISS-class LEO (mean motion 15.50 rev/day → ~92.9 min, ~414 km, inc 51.6°)
  const iss = parseTle(
    "1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9000",
    "2 25544  51.6400 200.0000 0006700  90.0000 270.0000 15.50000000 10000");
  const oi = orbitInfo(iss);
  const issOK = iss.valid && oi.orbitClass === "LEO" && Math.abs(oi.periodMin - 92.9) < 0.5 && Math.abs(oi.perigeeAltKm - 414) < 8 && Math.abs(iss.inclinationDeg - 51.64) < 0.01 && Math.abs(iss.eccentricity - 0.0006700) < 1e-6;

  // GPS-class MEO (mean motion ~2.0056 rev/day → ~718 min, ~20,180 km)
  const gps = parseTle(
    "1 24876U 97035A   24001.00000000  .00000000  00000-0  00000-0 0  9990",
    "2 24876  55.0000 100.0000 0050000  90.0000 270.0000  2.00560000 90000");
  const gi = orbitInfo(gps);
  const gpsOK = gi.orbitClass === "MEO" && Math.abs(gi.periodMin - 718) < 6 && gi.semiMajorKm > 26000 && gi.semiMajorKm < 26900;

  // GEO-class (mean motion ~1.0027 → ~1436 min, ~35,786 km)
  const geo = parseTle(
    "1 28884U 05041A   24001.00000000 -.00000100  00000-0  00000+0 0  9990",
    "2 28884   0.0200  90.0000 0001500 180.0000 180.0000  1.00270000 70000");
  const geoOK = orbitInfo(geo).orbitClass === "GEO" && Math.abs(orbitInfo(geo).apogeeAltKm - 35786) < 60;

  // staleness: same (column-aligned) ISS element set, read 0.5 days vs ~50 days after its epoch
  const freshT = tleStaleness(iss, Date.UTC(2024, 0, 2));     // epoch is 2024 day 1.5 → ~0.5 day old
  const oldT = tleStaleness(iss, Date.UTC(2024, 1, 20));      // ~50 days old
  const staleOK = freshT.band === "fresh" && oldT.band === "expired" && (oldT.ageDays ?? 0) > 30;

  // decay: a very low perigee with drag → decaying/imminent
  const lowSat = parseTle("1 9U 00000A   24001.00000000  .003  00000-0  50000-2 0  01", "2 9  51.6 0 0001000 0 0 16.40000000 1");
  const decayOK = ["decaying", "imminent"].includes(decayRisk(lowSat).band) && decayRisk(iss).band === "stable";

  // exponent-field parse: bstar "10270-3" → 0.10270e-3
  const bstarOK = Math.abs(iss.bstar - 0.10270e-3) < 1e-9;

  const total = (() => { try { parseTle(null as never, null as never); orbitInfo(null as never); tleStaleness(null as never, 0); decayRisk(null as never); return true; } catch { return false; } })();

  const checks = [
    { name: "LEO-ISS-EXACT", pass: issOK, detail: "ISS TLE → LEO, ~92.9 min, ~414 km, inc 51.64°, ecc 0.00067 (Kepler-exact)" },
    { name: "MEO-GPS", pass: gpsOK, detail: "GPS-class TLE → MEO, ~718 min, a≈26,560 km" },
    { name: "GEO", pass: geoOK, detail: "geostationary TLE → GEO, apogee ≈ 35,786 km" },
    { name: "STALENESS-BANDS", pass: staleOK, detail: "a fresh epoch = fresh; a 40-day-old set = expired (position drift)" },
    { name: "DECAY-RISK", pass: decayOK, detail: "very low perigee + drag → decaying/imminent; the ISS reads stable" },
    { name: "BSTAR-EXPONENT-PARSE", pass: bstarOK, detail: "the assumed-decimal exponent field '10270-3' parses to 0.10270e-3" },
    { name: "TOTAL", pass: total, detail: "never throws on garbage/null" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
