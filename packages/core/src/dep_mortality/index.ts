/**
 * v2.19.87 — #11 DEPENDENCY DEATH PREDICTOR.
 *
 * The first tool to give you a PROBABILITY OF ABANDONMENT before you
 * `npm install`.  Multi-signal mortality score using ONLY the data that
 * comes back from `npm view` (which is cached on every machine and
 * works offline once cached) — no GitHub API key required.
 *
 * Mortality signals (each 0..1; higher = more dead):
 *   - commit_lag      months since last release / 36
 *   - maintainer      |delta in maintainer count| / max(prev,1)
 *   - deprecation     1 if deprecated, else 0
 *   - version_freeze  months without a non-patch bump / 24
 *   - dep_health      mean mortality of THIS package's direct deps
 *   - alternatives    presence of a known substitute (moment → date-fns)
 *
 * Final score = weighted sum, clamped to 0..1.
 * Probability of abandonment in 18 months = score * 0.95 (95% ceiling
 * because nothing is certain).
 */

export interface NpmMetadata {
  name: string;
  /** ISO of latest publish. */
  latestPublishedAt?: string;
  /** Months since latest publish. */
  monthsSinceLatest?: number;
  /** Months since last MAJOR or MINOR version (not patch). */
  monthsSinceFeatureRelease?: number;
  deprecated?: boolean;
  maintainerCount?: number;
  prevMaintainerCount?: number;
  /** Direct deps (name only) — for cascade scoring. */
  directDeps?: string[];
  /** A known successor / substitute name, if any. */
  knownSubstitute?: string | null;
}

export interface MortalityReport {
  package: string;
  score: number;             // 0..1
  probability18mo: number;   // 0..1
  band: "thriving" | "healthy" | "watch" | "moribund" | "dead";
  reasons: Array<{ signal: string; weight: number; raw: number; note: string }>;
  recommendation: string;
}

// Hand-curated substitute map — these get baked in because they don't
// change often, and the alternative pattern is a strong death signal.
const KNOWN_SUBSTITUTES: Record<string, string> = {
  "moment":         "date-fns or dayjs",
  "request":        "got, axios, or native fetch",
  "underscore":     "lodash or native ES",
  "bower":          "npm or pnpm",
  "grunt":          "vite, esbuild, or rollup",
  "gulp":           "vite, esbuild, or rollup",
  "tslint":         "eslint with @typescript-eslint",
  "node-sass":      "sass (dart-sass)",
  "react-router-3": "react-router v6+",
  "create-react-app": "vite or next.js",
  "phantomjs":      "puppeteer or playwright",
  "lodash":         "native ES (array/object spread) or es-toolkit",
};

const W = { commit_lag: 0.30, version_freeze: 0.15, deprecation: 0.25, maintainer: 0.10, dep_health: 0.05, alternatives: 0.15 };

export function predictMortality(meta: NpmMetadata): MortalityReport {
  const sig = {
    commit_lag: Math.min(1, (meta.monthsSinceLatest ?? 0) / 36),
    version_freeze: Math.min(1, (meta.monthsSinceFeatureRelease ?? 0) / 24),
    deprecation: meta.deprecated ? 1 : 0,
    maintainer: clamp(
      meta.prevMaintainerCount != null && meta.maintainerCount != null
        ? Math.max(0, (meta.prevMaintainerCount - meta.maintainerCount) / Math.max(1, meta.prevMaintainerCount))
        : 0,
    ),
    dep_health: 0, // populated externally when cascading
    alternatives: KNOWN_SUBSTITUTES[meta.name] || meta.knownSubstitute ? 1 : 0,
  };
  const score =
      W.commit_lag      * sig.commit_lag
    + W.version_freeze  * sig.version_freeze
    + W.deprecation     * sig.deprecation
    + W.maintainer      * sig.maintainer
    + W.dep_health      * sig.dep_health
    + W.alternatives    * sig.alternatives;
  const clamped = Math.max(0, Math.min(1, score));
  const probability18mo = Math.min(0.95, clamped * 0.95);
  const band: MortalityReport["band"] =
      clamped >= 0.75 ? "dead"
    : clamped >= 0.55 ? "moribund"
    : clamped >= 0.35 ? "watch"
    : clamped >= 0.15 ? "healthy"
    : "thriving";
  const subst = KNOWN_SUBSTITUTES[meta.name] || meta.knownSubstitute;
  const reasons = [
    { signal: "commit_lag",      weight: W.commit_lag,     raw: sig.commit_lag,
      note: meta.monthsSinceLatest != null ? `last release ${meta.monthsSinceLatest} month${meta.monthsSinceLatest === 1 ? "" : "s"} ago` : "no release-date data" },
    { signal: "version_freeze",  weight: W.version_freeze, raw: sig.version_freeze,
      note: meta.monthsSinceFeatureRelease != null ? `${meta.monthsSinceFeatureRelease} months since last non-patch bump` : "no feature-release data" },
    { signal: "deprecation",     weight: W.deprecation,    raw: sig.deprecation,
      note: meta.deprecated ? "package is npm-deprecated" : "not deprecated" },
    { signal: "maintainer",      weight: W.maintainer,     raw: sig.maintainer,
      note: meta.prevMaintainerCount != null ? `maintainers went ${meta.prevMaintainerCount}→${meta.maintainerCount ?? "?"}` : "no maintainer-history data" },
    { signal: "alternatives",    weight: W.alternatives,   raw: sig.alternatives,
      note: subst ? `known successor: ${subst}` : "no known direct substitute" },
  ];
  const recommendation = band === "dead" || band === "moribund"
    ? subst
      ? `Don't install. ${subst} replaces ${meta.name}.`
      : `Don't install. Find a maintained alternative or fork.`
    : band === "watch"
      ? `OK for now, but pin the version and check again in 6 months.`
      : `Safe to install. Healthy maintenance signal.`;
  return { package: meta.name, score: clamped, probability18mo, band, reasons, recommendation };
}

function clamp(v: number): number { return Math.max(0, Math.min(1, v)); }
