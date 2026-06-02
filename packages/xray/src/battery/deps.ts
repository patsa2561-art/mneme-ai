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
      versions?: Record<string, { deprecated?: string }>;
      maintainers?: unknown[];
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
    return {
      name: pkg,
      latestPublishedAt: latestAt,
      monthsSinceLatest,
      monthsSinceFeatureRelease,
      deprecated,
      maintainerCount: Array.isArray(doc.maintainers) ? doc.maintainers.length : undefined,
    };
  } catch {
    return null;
  }
};

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
  const atRisk: DepsBlock["atRisk"] = [];
  if (names.length === 0) {
    return { total: 0, byBand, atRisk, partial: false, note: "No package.json dependencies found (non-npm repo or no deps)." };
  }

  let partial = false;
  // bounded concurrency to be a polite registry citizen
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
    }
  }
  atRisk.sort((a, b) => b.probability18mo - a.probability18mo);

  const danger = byBand.moribund + byBand.dead;
  return {
    total: names.length,
    byBand,
    atRisk: atRisk.slice(0, 20),
    partial,
    note:
      danger > 0
        ? `${danger} depend<x>${danger === 1 ? "y is" : "ies are"}</x> dying (moribund/dead). Plan replacements.`.replace(/<x>|<\/x>/g, "")
        : partial
        ? "Some packages could not be reached on the npm registry (counted as unknown)."
        : "No dying dependencies detected.",
  };
}
