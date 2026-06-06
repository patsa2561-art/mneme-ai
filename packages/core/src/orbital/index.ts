/**
 * ORBITAL — a sensory nerve to the sky for a space-ops agent.
 *
 * Mneme is local-first and runs at the edge (APHELION); a space-ops agent should KNOW the space
 * environment it operates in — because real spacecraft do. This ingests REAL, free, public, real-time
 * telemetry over a plain internet connection — NOAA Space Weather (geomagnetic / radio-blackout /
 * solar-radiation scales + the planetary Kp index) and live satellite position (ISS / any sub-point)
 * — parses it deterministically, and turns it into (a) a signed CONTEXT the agent can read and (b) an
 * honest OPERATIONAL ADVISORY that can tighten an APHELION charter (a geomagnetic storm degrades GNSS
 * and HF comms, so a disconnected agent should require approval for comms-dependent actions).
 *
 * ★HONEST (DIAKRISIS) — the line this never crosses: space weather is real DATA the agent READS and
 * governs by; it does NOT mystically "change the AI's mood / entropy / cognition" (that claim is
 * theatre). The fetch happens at the edge (CLI/MCP); this core only PARSES + ADVISES deterministically,
 * so it is offline-testable and never invents a number the telemetry didn't carry.
 */

export type Scale = 0 | 1 | 2 | 3 | 4 | 5;
function asScale(v: unknown): Scale { const n = Math.max(0, Math.min(5, Math.round(Number(v) || 0))); return n as Scale; }

export interface SpaceWeather {
  capturedAt: string;
  kpIndex: number | null;
  geomagnetic: { scale: Scale; text: string };   // G-scale (storms)
  radioBlackout: { scale: Scale; text: string };  // R-scale (HF blackout)
  solarRadiation: { scale: Scale; text: string }; // S-scale (radiation)
  condition: "quiet" | "unsettled" | "minor-storm" | "strong-storm" | "severe-storm" | "extreme-storm";
  peak: Scale;
}
/** Parse NOAA SWPC payloads deterministically. `scales` = noaa-scales.json (the "0" key = now);
 *  `kp` = planetary_k_index_1m.json (array; last = current). Both are free + need no API key. */
export function parseSpaceWeather(scales: unknown, kp?: unknown, capturedAt = ""): SpaceWeather {
  const now = (scales && typeof scales === "object" && (scales as Record<string, unknown>)["0"]) as Record<string, { Scale?: unknown; Text?: unknown }> | undefined;
  const g = now?.["G"] ?? {}, r = now?.["R"] ?? {}, s = now?.["S"] ?? {};
  const geo = asScale(g.Scale), rad = asScale(r.Scale), sol = asScale(s.Scale);
  const peak = Math.max(geo, rad, sol) as Scale;
  const kpArr = Array.isArray(kp) ? kp as Array<{ kp_index?: unknown }> : [];
  const kpIndex = kpArr.length ? Number(kpArr[kpArr.length - 1]?.kp_index) : null;
  const condition: SpaceWeather["condition"] = peak === 0 ? (Number(kpIndex) >= 4 ? "unsettled" : "quiet") : peak === 1 ? "minor-storm" : peak === 2 ? "minor-storm" : peak === 3 ? "strong-storm" : peak === 4 ? "severe-storm" : "extreme-storm";
  return {
    capturedAt: String(capturedAt || (now && (scales as Record<string, { DateStamp?: string; TimeStamp?: string }>)["0"]?.DateStamp ? `${(scales as Record<string, { DateStamp?: string; TimeStamp?: string }>)["0"].DateStamp}T${(scales as Record<string, { TimeStamp?: string }>)["0"].TimeStamp ?? ""}` : "")),
    kpIndex: Number.isFinite(kpIndex as number) ? (kpIndex as number) : null,
    geomagnetic: { scale: geo, text: String(g.Text ?? "") },
    radioBlackout: { scale: rad, text: String(r.Text ?? "") },
    solarRadiation: { scale: sol, text: String(s.Text ?? "") },
    condition, peak,
  };
}

export interface OrbitalAdvisory {
  level: "nominal" | "caution" | "warning" | "severe";
  riskFactor: number;            // 0..1, from the peak scale + Kp
  impacts: string[];             // honest operational impacts
  /** a suggested APHELION charter tightening you can apply with `mneme aphelion amend` */
  charterSuggestion: { lowerMaxRiskTo?: number; addForbidden?: string[]; requireApprovalFor?: string[]; reason: string } | null;
  note: string;
}
/** The honest operational read: what this space weather means for an agent + how to govern around it. */
export function spaceWeatherAdvisory(input: SpaceWeather): OrbitalAdvisory {
  const sw: SpaceWeather = input ?? { capturedAt: "", kpIndex: null, geomagnetic: { scale: 0, text: "" }, radioBlackout: { scale: 0, text: "" }, solarRadiation: { scale: 0, text: "" }, condition: "quiet", peak: 0 };
  const peak = sw.peak ?? 0; const kp = Number(sw.kpIndex) || 0;
  const impacts: string[] = [];
  if (sw.geomagnetic.scale >= 1 || kp >= 5) impacts.push("GNSS / GPS positioning accuracy degraded");
  if (sw.geomagnetic.scale >= 2) impacts.push("HF radio propagation + satellite comms intermittent");
  if (sw.geomagnetic.scale >= 4) impacts.push("increased low-Earth-orbit satellite drag (orbit decay)");
  if (sw.radioBlackout.scale >= 2) impacts.push("HF radio blackout on the sunlit side of Earth");
  if (sw.solarRadiation.scale >= 3) impacts.push("elevated radiation — risk to electronics / crew EVA");
  const riskFactor = Math.round(Math.min(1, peak / 5 * 0.8 + Math.min(kp, 9) / 9 * 0.2) * 100) / 100;
  const level: OrbitalAdvisory["level"] = peak >= 4 ? "severe" : peak >= 3 ? "warning" : (peak >= 1 || kp >= 5) ? "caution" : "nominal";
  let charterSuggestion: OrbitalAdvisory["charterSuggestion"] = null;
  if (level === "severe" || level === "warning") {
    charterSuggestion = { lowerMaxRiskTo: level === "severe" ? 0.4 : 0.55, requireApprovalFor: ["comms", "navigation", "deploy"], addForbidden: sw.radioBlackout.scale >= 3 ? ["hf-transmit"] : [], reason: `space weather ${sw.condition} (G${sw.geomagnetic.scale}/R${sw.radioBlackout.scale}/S${sw.solarRadiation.scale}, Kp ${sw.kpIndex ?? "?"}) degrades comms + navigation` };
  }
  return { level, riskFactor, impacts, charterSuggestion, note: "operational telemetry the agent reads + governs by — not a claim that space weather alters the model." };
}

// ── overhead satellite (live sub-point → is it in view of an observer) ──────────────────────────
const R_EARTH = 6371;
/** Great-circle distance (km) between two lat/lon points (haversine, deterministic). */
export function groundDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toR = (d: number) => (Number(d) || 0) * Math.PI / 180;
  const dLat = toR(lat2 - lat1), dLon = toR(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a))) * 10) / 10;
}
export interface OverheadVerdict { overhead: boolean; groundDistanceKm: number; horizonKm: number; note: string }
/** Is a satellite at (satLat,satLon,altKm) above the horizon for an observer at (obsLat,obsLon)?
 *  Coarse + honest: compares ground-track distance to the geometric horizon for that altitude. */
export function isOverhead(satLat: number, satLon: number, altKm: number, obsLat: number, obsLon: number): OverheadVerdict {
  const d = groundDistanceKm(satLat, satLon, obsLat, obsLon);
  const alt = Math.max(1, Number(altKm) || 0);
  const horizonKm = Math.round(R_EARTH * Math.acos(R_EARTH / (R_EARTH + alt)) * 10) / 10;   // max ground range it can be seen
  return { overhead: d <= horizonKm, groundDistanceKm: d, horizonKm, note: d <= horizonKm ? "above the local horizon (in view)" : "below the horizon" };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface OrbitalGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function orbitalGauntlet(): OrbitalGauntlet {
  // a real NOAA quiet payload
  const quiet = parseSpaceWeather({ "0": { DateStamp: "2026-06-06", TimeStamp: "07:02:00", G: { Scale: "0", Text: "none" }, R: { Scale: "0", Text: "none" }, S: { Scale: "0", Text: "none" } } }, [{ kp_index: 3 }]);
  const quietOK = quiet.geomagnetic.scale === 0 && quiet.condition === "quiet" && quiet.kpIndex === 3 && spaceWeatherAdvisory(quiet).level === "nominal" && spaceWeatherAdvisory(quiet).charterSuggestion === null;

  // a severe geomagnetic storm → advisory tightens the charter
  const storm = parseSpaceWeather({ "0": { G: { Scale: "4", Text: "severe" }, R: { Scale: "2", Text: "moderate" }, S: { Scale: "1", Text: "minor" } } }, [{ kp_index: 8 }]);
  const adv = spaceWeatherAdvisory(storm);
  const stormOK = storm.peak === 4 && storm.condition === "severe-storm" && adv.level === "severe" && adv.riskFactor > 0.6
    && adv.impacts.some((i) => i.includes("GNSS")) && adv.charterSuggestion?.lowerMaxRiskTo === 0.4 && (adv.charterSuggestion?.requireApprovalFor ?? []).includes("comms");

  // radio blackout adds an HF-transmit forbid
  const blackout = spaceWeatherAdvisory(parseSpaceWeather({ "0": { G: { Scale: "3" }, R: { Scale: "4" }, S: { Scale: "0" } } }, []));
  const blackoutOK = (blackout.charterSuggestion?.addForbidden ?? []).includes("hf-transmit");

  // overhead geometry: the ISS (~420 km) directly below an observer is overhead; antipodal is not
  const here = isOverhead(13.7, 100.5, 420, 13.7, 100.5);   // ISS sub-point == observer
  const far = isOverhead(13.7, 100.5, 420, -13.7, -79.5);   // opposite side of Earth
  const overheadOK = here.overhead === true && here.groundDistanceKm === 0 && far.overhead === false && here.horizonKm > 2000;

  const total = (() => { try { parseSpaceWeather(null); spaceWeatherAdvisory(null as never); isOverhead(0, 0, 0, 0, 0); groundDistanceKm(0, 0, 0, 0); return true; } catch { return false; } })();

  const checks = [
    { name: "PARSE-QUIET", pass: quietOK, detail: "a real NOAA quiet payload → G0, condition quiet, Kp 3, nominal advisory, no charter change" },
    { name: "STORM-TIGHTENS-CHARTER", pass: stormOK, detail: "a G4/Kp8 storm → severe advisory + a charter suggestion (lower maxRisk, require approval for comms/nav)" },
    { name: "BLACKOUT-FORBIDS-HF", pass: blackoutOK, detail: "an R4 radio blackout adds an hf-transmit forbid to the suggested charter" },
    { name: "OVERHEAD-GEOMETRY", pass: overheadOK, detail: "a satellite at the observer's sub-point is overhead; the antipode is below the horizon (real horizon math)" },
    { name: "TOTAL", pass: total, detail: "never throws on garbage/null" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
