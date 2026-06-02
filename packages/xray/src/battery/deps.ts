/**
 * Dependency-mortality signal — wraps the real `depMortality.predictMortality`.
 * Reads the repo's package.json, fetches public npm registry metadata per dep
 * (factual, not an LLM guess), and scores each. Metadata fetch is injectable
 * for deterministic tests; the registry is the source of truth otherwise.
 */
import { depMortality } from "@mneme-ai/core";
import { readText } from "../util.js";
import { join } from "node:path";
import type { DepsBlock } from "../types.js";

type NpmMeta = Parameters<typeof depMortality.predictMortality>[0];
export type MetaFetcher = (pkg: string, now: number) => Promise<NpmMeta | null>;

const MONTH_MS = 1000 * 60 * 60 * 24 * 30.44;

/** Default: fetch the public npm registry document and derive mortality inputs. */
export const defaultFetcher: MetaFetcher = async (pkg, now) => {
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg).replace("%40", "@")}`, {
      headers: { accept: "application/vnd.npm.install-v1+json, application/json" },
    });
    if (!res.ok) return null;
    const doc = (await res.json()) as {
      "dist-tags"?: { latest?: string };
      time?: Record<string, string>;
      versions?: Record<string, { deprecated?: string; license?: string }>;
      maintainers?: unknown[];
      license?: string;
    };
    const latest = doc["dist-tags"]?.latest;
    const time = doc.time ?? {};
    const latestAt = latest ? time[latest] : undefined;
    const monthsSinceLatest = latestAt ? (now - Date.parse(latestAt)) / MONTH_MS : undefined;

    // months since last feature (non-patch) release: walk versions newest→oldest
    const versions = Object.keys(doc.versions ?? {});
    let monthsSinceFeatureRelease: number | undefined;
    if (latest) {
      const [lMaj, lMin] = latest.split(".").map((n) => parseInt(n, 10));
      let bestAt = 0;
      for (const v of versions) {
        const [maj, min, pat] = v.split(".").map((n) => parseInt(n, 10));
        if (pat === 0 && (maj !== lMaj || min !== lMin || v === latest)) {
          const t = Date.parse(time[v] ?? "");
          if (Number.isFinite(t) && t > bestAt) bestAt = t;
        }
      }
      if (bestAt > 0) monthsSinceFeatureRelease = (now - bestAt) / MONTH_MS;
    }
    const deprecated = !!(latest && doc.versions?.[latest]?.deprecated);
    const license = (latest && doc.versions?.[latest]?.license) || doc.license || "";
    return {
      name: pkg,
      latestPublishedAt: latestAt,
      monthsSinceLatest,
      monthsSinceFeatureRelease,
      deprecated,
      maintainerCount: Array.isArray(doc.maintainers) ? doc.maintainers.length : undefined,
      license,
    } as NpmMeta & { license?: string };
  } catch {
    return null;
  }
};

/** Classify an SPDX-ish license string into a commercial-risk band. */
export function licenseClass(lic: string): "permissive" | "weak-copyleft" | "strong-copyleft" | "unknown" {
  const s = (lic || "").toUpperCase();
  if (!s || s === "UNLICENSED" || s === "SEE LICENSE" || s.includes("CUSTOM")) return "unknown";
  if (/\bAGPL|GPL-?[23]|GPLV[23]\b/.test(s) && !s.includes("LGPL")) return "strong-copyleft";
  if (/\bLGPL|MPL|EPL|CDDL|MS-RL\b/.test(s)) return "weak-copyleft";
  if (/\bMIT|ISC|BSD|APACHE|UNLICENSE|0BSD|CC0|WTFPL|ZLIB|PYTHON|BLUEOAK\b/.test(s)) return "permissive";
  return "unknown";
}

function depNames(repoPath: string): string[] {
  const raw = readText(join(repoPath, "package.json"));
  if (!raw) return [];
  try {
    const pkg = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const names = new Set<string>([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
    return [...names];
  } catch {
    return [];
  }
}

export async function analyzeDeps(repoPath: string, now: number, fetcher: MetaFetcher = defaultFetcher): Promise<DepsBlock> {
  const names = depNames(repoPath);
  const byBand: DepsBlock["byBand"] = { thriving: 0, healthy: 0, watch: 0, moribund: 0, dead: 0 };
  const licenses: DepsBlock["licenses"] = { permissive: 0, "weak-copyleft": 0, "strong-copyleft": 0, unknown: 0 };
  const atRisk: DepsBlock["atRisk"] = [];
  const licenseFlags: DepsBlock["licenseFlags"] = [];
  if (names.length === 0) {
    return { total: 0, byBand, atRisk, licenses, licenseFlags, partial: false, note: "No package.json dependencies found (non-npm repo or no deps)." };
  }

  let partial = false;
  const LIMIT = 8;
  for (let i = 0; i < names.length; i += LIMIT) {
    const chunk = names.slice(i, i + LIMIT);
    const metas = await Promise.all(chunk.map((n) => fetcher(n, now).catch(() => null)));
    for (const meta of metas) {
      if (!meta) { partial = true; continue; }
      const r = depMortality.predictMortality(meta);
      byBand[r.band]++;
      if (r.band === "watch" || r.band === "moribund" || r.band === "dead") {
        atRisk.push({ name: r.package, band: r.band, probability18mo: Math.round(r.probability18mo * 100) / 100, successor: meta.knownSubstitute ?? null });
      }
      const lic = (meta as NpmMeta & { license?: string }).license ?? "";
      const cls = licenseClass(lic);
      licenses[cls]++;
      if (cls === "strong-copyleft" || cls === "weak-copyleft") {
        licenseFlags.push({ name: meta.name, license: lic || "?", class: cls });
      }
    }
  }
  atRisk.sort((a, b) => b.probability18mo - a.probability18mo);
  licenseFlags.sort((a, b) => (a.class === "strong-copyleft" ? -1 : 1) - (b.class === "strong-copyleft" ? -1 : 1));

  const danger = byBand.moribund + byBand.dead;
  const copyleft = licenses["strong-copyleft"] + licenses["weak-copyleft"];
  const parts: string[] = [];
  if (danger > 0) parts.push(`${danger} dying (moribund/dead) — plan replacements`);
  if (copyleft > 0) parts.push(`${copyleft} copyleft-licensed (commercial-use review)`);
  return {
    total: names.length,
    byBand,
    atRisk: atRisk.slice(0, 20),
    licenses,
    licenseFlags: licenseFlags.slice(0, 15),
    partial,
    note: parts.length ? parts.join("; ") + "." : partial ? "Some packages could not be reached on the npm registry." : "No dying or copyleft-risk dependencies.",
  };
}
