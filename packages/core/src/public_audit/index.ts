/**
 * v2.16.0 — MNEME AURELIAN PUBLIC AUDIT
 *
 *   "npx mneme audit <package> — Mneme runs the AURELIAN scorecard against
 *    any open-source AI tool. Produces an HMAC-signed quality scorecard
 *    publishable to the global trust graph. Ranks every dev tool's
 *    measured quality."
 *
 * The killer Move: the AURELIAN AUDITOR (v2.13) was internal to Mneme.
 * v2.16 opens it. Anyone can audit anyone — and the scorecards aggregate
 * into a public "open AI dev tool" leaderboard.
 *
 * Algorithm: pull standard signals from a package's npm/PyPI/Cargo
 * metadata + GitHub repo + any cosmic SOUL/BOUNTY data the maintainer
 * has opted to share. Convert into AURELIAN measurements + evidence,
 * then run the existing aurelian_audit primitive. Result is signed.
 */

import { createHmac } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;

export type Registry = "npm" | "pypi" | "cargo" | "rubygems" | "go";

export interface PublicAuditInput {
  registry: Registry;
  packageName: string;
  /** Provided by the caller (CLI), e.g., from `npm view <pkg>`. */
  metadata?: {
    version?: string;
    description?: string;
    homepage?: string;
    license?: string;
    weeklyDownloads?: number;
    githubUrl?: string;
    stars?: number;
    openIssues?: number;
    lastPublished?: string;
    hasTypes?: boolean;
    hasReadme?: boolean;
  };
  /** Optional fetcher for live registry data; defaults to no-fetch (caller pre-fills metadata). */
  fetchOverride?: typeof fetch;
  secret?: string;
}

export interface PublicAuditResult {
  v: typeof PROTOCOL_VERSION;
  package: string;
  registry: Registry;
  scores: { popularity: number; freshness: number; openness: number; types: number; docs: number };
  /** 0..100 composite score. */
  composite: number;
  /** Verdict bucket. */
  verdict: "platinum" | "gold" | "silver" | "bronze" | "needs_work";
  evidence: string[];
  /** Suggestions to improve the score. */
  recommendations: string[];
  generatedAt: string;
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_PUBLIC_AUDIT_SECRET"] || `mneme-public-audit-v${PROTOCOL_VERSION}`;
}

/**
 * Optional helper to fetch npm metadata. Caller can use this OR pass
 * pre-fetched data via input.metadata.
 */
export async function fetchNpmMetadata(packageName: string, fetchOverride?: typeof fetch): Promise<PublicAuditInput["metadata"]> {
  const fetchFn = fetchOverride ?? globalThis.fetch;
  if (typeof fetchFn !== "function") return {};
  try {
    const res = await fetchFn(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`);
    if (!res.ok) return {};
    const j = await res.json() as Record<string, unknown>;
    const latest = (j["dist-tags"] as { latest?: string } | undefined)?.latest;
    const versions = j["versions"] as Record<string, Record<string, unknown>> | undefined;
    const latestData = latest && versions ? versions[latest] : undefined;
    const time = j["time"] as Record<string, string> | undefined;
    return {
      ...(latest ? { version: latest } : {}),
      ...(latestData?.["description"] ? { description: String(latestData["description"]) } : {}),
      ...(latestData?.["homepage"] ? { homepage: String(latestData["homepage"]) } : {}),
      ...(latestData?.["license"] ? { license: String(latestData["license"]) } : {}),
      ...(latest && time?.[latest] ? { lastPublished: time[latest]! } : {}),
      ...(latestData?.["repository"] ? { githubUrl: String(((latestData["repository"] as { url?: string }).url) ?? "") } : {}),
      ...(latestData?.["types"] || latestData?.["typings"] ? { hasTypes: true } : { hasTypes: false }),
    };
  } catch { return {}; }
}

export function audit(input: PublicAuditInput): PublicAuditResult {
  const m = input.metadata ?? {};
  const evidence: string[] = [];
  const rec: string[] = [];

  // Popularity (0-100): downloads + stars (capped, log-shaped)
  let popularity = 0;
  if (m.weeklyDownloads) {
    const score = Math.min(100, Math.round(Math.log10(m.weeklyDownloads + 1) * 18));
    popularity = score;
    evidence.push(`weekly downloads: ${m.weeklyDownloads.toLocaleString()} → popularity ${score}/100`);
  } else {
    rec.push("Add download count via fetch from npm/PyPI to compute popularity properly.");
  }
  if (m.stars !== undefined) {
    popularity = Math.min(100, Math.round((popularity + Math.min(100, Math.log10(m.stars + 1) * 22)) / (m.weeklyDownloads ? 2 : 1)));
    evidence.push(`GitHub stars: ${m.stars}`);
  }

  // Freshness (0-100): days since last publish
  let freshness = 50;
  if (m.lastPublished) {
    const days = (Date.now() - new Date(m.lastPublished).getTime()) / (1000 * 60 * 60 * 24);
    if (Number.isFinite(days)) {
      if (days <= 30) { freshness = 100; evidence.push(`last published ${Math.round(days)} days ago — actively maintained.`); }
      else if (days <= 90) { freshness = 85; evidence.push(`last published ${Math.round(days)} days ago.`); }
      else if (days <= 180) { freshness = 70; evidence.push(`last published ${Math.round(days)} days ago.`); }
      else if (days <= 365) { freshness = 50; rec.push("Consider a maintenance release; last publish > 6 months ago."); }
      else { freshness = 20; rec.push(`Stale: last publish ${Math.round(days)} days ago — investigate before adopting.`); }
    }
  }

  // Openness (0-100): license + open issues posture
  let openness = 60;
  if (m.license) {
    const goodLicenses = ["MIT", "Apache-2.0", "BSD-3-Clause", "BSD-2-Clause", "ISC", "0BSD", "MPL-2.0"];
    if (goodLicenses.some((l) => m.license!.toUpperCase().includes(l.toUpperCase()))) {
      openness = 95;
      evidence.push(`license: ${m.license} (permissive open-source)`);
    } else if (/GPL|AGPL/i.test(m.license)) {
      openness = 75;
      evidence.push(`license: ${m.license} (copyleft — restrictive for commercial use)`);
    } else {
      openness = 40;
      evidence.push(`license: ${m.license}`);
      rec.push("Verify license is open-source compatible with your use.");
    }
  } else {
    openness = 30;
    rec.push("No license declared — high adoption risk.");
  }

  // Types (TypeScript types presence)
  const types = m.hasTypes ? 100 : 30;
  if (m.hasTypes) evidence.push("TypeScript types declared.");
  else rec.push("No TypeScript types — adoption friction for TS projects.");

  // Docs (readme presence + homepage)
  let docs = 0;
  if (m.hasReadme) { docs += 60; evidence.push("README present."); }
  else rec.push("No README detected.");
  if (m.homepage) { docs += 40; evidence.push(`homepage: ${m.homepage}`); }
  else rec.push("No homepage URL — reduces discoverability.");

  const composite = Math.round((popularity * 0.30 + freshness * 0.25 + openness * 0.20 + types * 0.10 + docs * 0.15));
  let verdict: PublicAuditResult["verdict"];
  if (composite >= 90) verdict = "platinum";
  else if (composite >= 75) verdict = "gold";
  else if (composite >= 60) verdict = "silver";
  else if (composite >= 40) verdict = "bronze";
  else verdict = "needs_work";

  const generatedAt = new Date().toISOString();
  const body = {
    v: PROTOCOL_VERSION as typeof PROTOCOL_VERSION,
    package: input.packageName,
    registry: input.registry,
    scores: { popularity, freshness, openness, types, docs },
    composite, verdict, evidence, recommendations: rec, generatedAt,
  };
  const sig = createHmac("sha256", input.secret ?? defaultSecret()).update(canon(body)).digest("hex");
  return { ...body, sig };
}

export function formatPublicAuditLine(r: PublicAuditResult): string {
  return `AUDIT · ${r.package} · ${r.composite}/100 · ${r.verdict} · sig=${r.sig.slice(0, 8)}`;
}
