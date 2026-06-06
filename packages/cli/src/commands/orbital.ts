/**
 * `mneme orbital` — a sensory nerve to the sky for a space-ops agent (internal).
 * Pulls REAL, free, public, real-time telemetry over plain internet (no API key) and turns it into a
 * signed context + an honest operational advisory that can tighten an APHELION charter.
 *   orbital weather                          → live NOAA space weather + advisory
 *   orbital track --lat 13.7 --lon 100.5     → is the ISS overhead you right now
 * HONEST: telemetry the agent READS + governs by — not a claim that space weather alters the model.
 */
import type { Command } from "commander";
import { get as httpsGet } from "node:https";
import { get as httpGet } from "node:http";
import { orbital, tle } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }
function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => { const r = httpsGet(url, (x) => { let b = ""; x.on("data", (c) => (b += c)); x.on("end", () => resolve(b)); }); r.on("error", reject); r.setTimeout(9000, () => r.destroy(new Error("timeout"))); });
}
function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? httpsGet : httpGet;
    const req = lib(url, (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } }); });
    req.on("error", reject); req.setTimeout(8000, () => req.destroy(new Error("timeout")));
  });
}

export function registerOrbitalCommands(program: Command): void {
  const k = program.command("orbital").description("🛰 ORBITAL (internal) — a sensory nerve to the sky: ingest REAL free public space-weather (NOAA) + satellite position as signed context + an APHELION charter advisory. Honest: the agent READS the sky, it doesn't 'feel' it.");

  k.command("weather", { isDefault: true }).description("Live NOAA space weather (geomagnetic / radio-blackout / solar + Kp) → an operational advisory.")
    .option("--json", "print the parsed weather + advisory as JSON")
    .action(async (o: { json?: boolean }) => {
      try {
        const [scales, kp] = await Promise.all([
          fetchJson("https://services.swpc.noaa.gov/products/noaa-scales.json"),
          fetchJson("https://services.swpc.noaa.gov/json/planetary_k_index_1m.json").catch(() => []),
        ]);
        const sw = orbital.parseSpaceWeather(scales, kp); const adv = orbital.spaceWeatherAdvisory(sw);
        if (o.json) { out(JSON.stringify({ sw, advisory: adv }, null, 2)); return; }
        const ico = adv.level === "severe" ? "🔴" : adv.level === "warning" ? "🟠" : adv.level === "caution" ? "🟡" : "🟢";
        out(`🛰 SPACE WEATHER · ${ico} ${adv.level.toUpperCase()} · ${sw.condition} · captured ${sw.capturedAt || "now"}`);
        out(`   geomagnetic G${sw.geomagnetic.scale} · radio-blackout R${sw.radioBlackout.scale} · solar S${sw.solarRadiation.scale} · Kp ${sw.kpIndex ?? "?"} · risk ${adv.riskFactor}`);
        for (const i of adv.impacts) out(`   • ${i}`);
        if (adv.charterSuggestion) {
          const c = adv.charterSuggestion;
          out(`   🛡 suggested APHELION charter: maxRisk→${c.lowerMaxRiskTo}${c.requireApprovalFor?.length ? ` · approve: ${c.requireApprovalFor.join("/")}` : ""}${c.addForbidden?.length ? ` · forbid: ${c.addForbidden.join("/")}` : ""}`);
          out(`     → apply: mneme aphelion amend --node <n> --reason "${c.reason}" --max-risk ${c.lowerMaxRiskTo}`);
        } else out("   🟢 nominal — no charter change advised.");
        out("   (real NOAA telemetry the agent reads + governs by — not a mood/entropy claim)");
      } catch (e) { out(`✗ could not reach NOAA (need internet): ${(e as Error).message}`); process.exitCode = 2; }
    });

  k.command("tle <catnr>").description("TLE intelligence — fetch a satellite's element set (CelesTrak) + characterize its orbit, staleness + decay risk. e.g. 25544 = ISS, 48274 = a Starlink.")
    .action(async (catnr: string) => {
      try {
        const txt = await fetchText(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${encodeURIComponent(catnr)}&FORMAT=tle`);
        const L = txt.trim().split("\n").map((s) => s.trim());
        if (L.length < 3) { out(`✗ no element set for ${catnr} (${(L[0] || "").slice(0, 60)})`); process.exitCode = 2; return; }
        const el = tle.parseTle(L[1], L[2]); const oi = tle.orbitInfo(el); const st = tle.tleStaleness(el, Date.now()); const dr = tle.decayRisk(el);
        const sico = st.band === "fresh" ? "🟢" : st.band === "aging" ? "🟡" : "🔴";
        out(`🛰 ${L[0] || catnr} — ${oi.orbitClass} · period ${oi.periodMin} min · alt ${oi.perigeeAltKm}–${oi.apogeeAltKm} km · inc ${el.inclinationDeg}° · ecc ${oi.eccentricity}`);
        out(`   element set: ${sico} ${st.band} (${st.ageDays} days old) — ${st.note}`);
        out(`   decay: ${dr.band === "stable" ? "🟢" : "🟠"} ${dr.band} — ${dr.note}`);
      } catch (e) { out(`✗ could not reach CelesTrak (need internet): ${(e as Error).message}`); process.exitCode = 2; }
    });

  k.command("track").description("Is the ISS overhead you right now? (live position over plain internet).")
    .requiredOption("--lat <n>", "your latitude", parseFloat).requiredOption("--lon <n>", "your longitude", parseFloat)
    .action(async (o: { lat: number; lon: number }) => {
      try {
        const iss = await fetchJson("http://api.open-notify.org/iss-now.json") as { iss_position?: { latitude?: string; longitude?: string } };
        const sLat = Number(iss?.iss_position?.latitude), sLon = Number(iss?.iss_position?.longitude);
        const v = orbital.isOverhead(sLat, sLon, 420, o.lat, o.lon);
        out(`🛰 ISS at ${sLat.toFixed(2)}, ${sLon.toFixed(2)} · ${v.overhead ? "🟢 OVERHEAD (in view)" : "⚪ below horizon"} · ${v.groundDistanceKm} km away (horizon ${v.horizonKm} km)`);
      } catch (e) { out(`✗ could not reach the ISS feed: ${(e as Error).message}`); process.exitCode = 2; }
    });
}
