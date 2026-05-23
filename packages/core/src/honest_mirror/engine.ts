/**
 * v2.30.0 — HONEST MIRROR engine.
 *
 * Orchestrates: pull artifacts → DP-scrub → blind-replay through N
 * vendors → compare to accepted answers → emit per-vendor calibration
 * delta + suggested Aletheia weight → HMAC-chain the report.
 *
 * Composes with CONCLAVE: the suggestedAletheiaWeight field is the
 * feedback loop closure — a vendor with bad calibration on the user's
 * own past work gets a lower CONCLAVE vote-weight in future runs.
 * This is the truth-tunes-trust loop.
 */

import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type {
  MirrorReport, CalibrateOptions, ArtifactSource, VendorReplayResult, RealArtifact, AcceptedAnswer, CalibrationDelta,
} from "./types.js";
import { sampleArtifacts as gitSample, gitSourceAvailable } from "./sources/git_commit_source.js";
import { scrub } from "./anonymizer.js";
import { computeDelta, suggestedWeight } from "./calibration.js";

const HMAC_KEY = process.env["MNEME_HONEST_MIRROR_KEY"] ?? "mneme-honest-mirror-v1";
const CHAIN_SEED = "0".repeat(64);

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}
function sha(s: string): string { return createHash("sha256").update(s).digest("hex"); }
function hmacOf(prev: string, payload: string): string {
  return createHmac("sha256", HMAC_KEY).update(prev + "|" + payload).digest("hex");
}

let lastChainLink = CHAIN_SEED;
export function __resetHonestMirrorChainForTest(): void { lastChainLink = CHAIN_SEED; }

/**
 * Pull artifacts from the requested source. Falls back to git_commit
 * when other sources are unavailable.
 */
export function pullArtifacts(
  repoRoot: string,
  source: ArtifactSource,
  count: number,
  seed: number,
): Array<{ artifact: RealArtifact; accepted: AcceptedAnswer }> {
  if (source === "git_commit") {
    if (!gitSourceAvailable(repoRoot)) return [];
    return gitSample(repoRoot, count, seed);
  }
  // v2.30.0 ships git_commit only; replay + lineage sources stub-fall
  // back to git_commit when available so callers always get artifacts.
  if (gitSourceAvailable(repoRoot)) return gitSample(repoRoot, count, seed);
  return [];
}

/**
 * Blind-replay function. The caller supplies a vendor-call function
 * (returns {answer, confidence}) — we don't bake in CONCLAVE here so
 * the engine stays standalone + testable.
 *
 * The eval-anti-detection rule: we pass the artifact AS IS (post-scrub)
 * with no "STANCE:" header, no "BENCHMARK:", no "TEST:". The vendor
 * sees a normal conversational prompt with the original timestamp.
 */
export type BlindReplayFn = (input: {
  vendor: string;
  prompt: string;
  artifactTimestamp: string;
}) => Promise<VendorReplayResult>;

export async function runCalibration(
  repoRoot: string,
  opts: CalibrateOptions,
  replay: BlindReplayFn,
  embed?: (texts: string[]) => Promise<Float32Array[]>,
): Promise<MirrorReport> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const source: ArtifactSource = opts.source ?? "git_commit";
  const count = opts.count ?? 10;
  const seed = opts.seed ?? Date.now();
  const vendors = opts.vendors;

  const pairs = pullArtifacts(repoRoot, source, count, seed);
  // Scrub artifacts before sending to vendor
  const scrubbedPairs = pairs.map((p) => {
    const s = scrub(p.artifact.prompt);
    return {
      ...p,
      artifact: { ...p.artifact, prompt: s.text },
      _redactionCount: s.redactionCount,
    };
  });

  // Per-vendor calibration
  const perVendor = await Promise.all(vendors.map(async (vendor) => {
    const perArtifact: CalibrationDelta[] = [];
    for (const pair of scrubbedPairs) {
      const r = await replay({
        vendor,
        prompt: pair.artifact.prompt,
        artifactTimestamp: pair.artifact.at,
      }).catch((e) => ({
        vendor, answer: "", confidence: 0, dtMs: 0, error: (e as Error).message,
      } satisfies VendorReplayResult));
      if (r.error) continue;
      const delta = await computeDelta(pair.artifact.id, r, pair.accepted, { embed });
      perArtifact.push(delta);
    }
    const meanReportedConfidence = perArtifact.length === 0 ? 0
      : perArtifact.reduce((s, d) => s + d.reportedConfidence, 0) / perArtifact.length;
    const meanMeasuredCorrectness = perArtifact.length === 0 ? 0
      : perArtifact.reduce((s, d) => s + d.measuredCorrectness, 0) / perArtifact.length;
    const meanCalibrationDelta = perArtifact.length === 0 ? 0
      : perArtifact.reduce((s, d) => s + d.calibrationDelta, 0) / perArtifact.length;
    let headline: string;
    if (Math.abs(meanCalibrationDelta) < 0.1) {
      headline = `🟢 ${vendor} — well-calibrated (mean Δ=${(meanCalibrationDelta * 100).toFixed(0)}%, correctness=${Math.round(meanMeasuredCorrectness * 100)}%)`;
    } else if (meanCalibrationDelta > 0) {
      headline = `🟡 ${vendor} — over-confident by ${(meanCalibrationDelta * 100).toFixed(0)}% on user's own past work`;
    } else {
      headline = `🟦 ${vendor} — under-confident by ${(Math.abs(meanCalibrationDelta) * 100).toFixed(0)}% on user's own past work`;
    }
    return {
      vendor,
      meanReportedConfidence: round3(meanReportedConfidence),
      meanMeasuredCorrectness: round3(meanMeasuredCorrectness),
      meanCalibrationDelta: round3(meanCalibrationDelta),
      headline,
      perArtifact,
      suggestedAletheiaWeight: suggestedWeight(perArtifact),
    };
  }));

  const finishedAt = new Date().toISOString();
  const totalMs = Date.now() - t0;
  // Overall verdict.
  // v2.37.0 — mock-vendor filter. Mock vendor adapters return
  // deterministic placeholder text that CAN'T match real commit
  // diffs, so their meanCalibrationDelta is structurally ~60% over-
  // confident by construction. Including them in the traffic-light
  // computation produces a spurious 🔴 RED on every fresh install
  // that only has mock vendors available (no API keys configured).
  // Same filter TRUTH GATE probe.honest_mirror.recent_calibration
  // applies. Mock vendors still appear in perVendor for completeness
  // but don't drive the headline.
  const realVendors = perVendor.filter((v) => !v.vendor.startsWith("mock") && !v.vendor.includes("@mock"));
  const scoringVendors = realVendors.length > 0 ? realVendors : perVendor; // fall back so we always have a verdict
  let trafficLight: MirrorReport["trafficLight"];
  const maxAbsDelta = scoringVendors.reduce((m, v) => Math.max(m, Math.abs(v.meanCalibrationDelta)), 0);
  if (maxAbsDelta < 0.10) trafficLight = "green";
  else if (maxAbsDelta < 0.25) trafficLight = "yellow";
  else trafficLight = "red";
  const mockNote = realVendors.length === 0 && perVendor.length > 0
    ? " (mock-only run — no real vendor signal; production calibration requires API keys)"
    : "";
  const headline = trafficLight === "green"
    ? `🟢 HONEST MIRROR — all ${perVendor.length} vendors well-calibrated against ${pairs.length} natural artifacts${mockNote}`
    : trafficLight === "yellow"
    ? `🟡 HONEST MIRROR — calibration drift up to ${(maxAbsDelta * 100).toFixed(0)}% across ${scoringVendors.length} real vendor(s)${mockNote}`
    : `🔴 HONEST MIRROR — significant calibration miss: max ${(maxAbsDelta * 100).toFixed(0)}% drift${mockNote}`;

  const body = {
    spec: { name: "MNEME-HONEST-MIRROR" as const, version: "1.0" },
    startedAt, finishedAt, totalMs,
    artifactCount: pairs.length,
    source,
    vendors,
    perVendor,
    headline,
    trafficLight,
  };
  const bodyDigest = sha(canon(body));
  lastChainLink = hmacOf(lastChainLink, bodyDigest);
  return { ...body, hmac: lastChainLink, seq: parseInt(lastChainLink.slice(0, 8), 16), bodyDigest };
}

function round3(n: number): number { return Number(n.toFixed(3)); }

// ── Persistence ──────────────────────────────────────────────────────

function dirOf(repoRoot: string): string {
  const d = join(repoRoot, ".mneme", "honest_mirror");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

export function storeReport(repoRoot: string, r: MirrorReport): { path: string; ledger: string } {
  const d = dirOf(repoRoot);
  const stamp = r.finishedAt.replace(/[:.]/g, "-");
  const path = join(d, `${String(r.seq).padStart(10, "0")}-${stamp}.json`);
  writeFileSync(path, JSON.stringify(r, null, 2) + "\n");
  const ledger = join(d, "reports.jsonl");
  const skim = {
    seq: r.seq,
    finishedAt: r.finishedAt,
    artifactCount: r.artifactCount,
    source: r.source,
    trafficLight: r.trafficLight,
    headline: r.headline,
    perVendor: r.perVendor.map((v) => ({ vendor: v.vendor, delta: v.meanCalibrationDelta, weight: v.suggestedAletheiaWeight })),
    hmac: r.hmac, bodyDigest: r.bodyDigest, file: path,
  };
  appendFileSync(ledger, JSON.stringify(skim) + "\n");

  // Side-effect: persist suggested Aletheia weights into a feedback file
  // that the CONCLAVE Aletheia reader picks up next run. Closes the
  // truth-tunes-trust loop.
  try {
    const feedbackPath = join(repoRoot, ".mneme", "aletheia", "honest_mirror_weights.json");
    const feedbackDir = join(repoRoot, ".mneme", "aletheia");
    if (!existsSync(feedbackDir)) mkdirSync(feedbackDir, { recursive: true });
    const merged: Record<string, { trust: number; source: string; at: string }> = {};
    if (existsSync(feedbackPath)) {
      try { Object.assign(merged, JSON.parse(readFileSync(feedbackPath, "utf8")) as typeof merged); }
      catch { /* corrupt → start fresh */ }
    }
    for (const pv of r.perVendor) {
      merged[pv.vendor] = { trust: pv.suggestedAletheiaWeight, source: "honest_mirror", at: r.finishedAt };
    }
    writeFileSync(feedbackPath, JSON.stringify(merged, null, 2));
  } catch { /* best-effort */ }
  return { path, ledger };
}

export function readLatestReport(repoRoot: string): MirrorReport | null {
  const d = dirOf(repoRoot);
  if (!existsSync(d)) return null;
  const files = readdirSync(d).filter((n) => n.endsWith(".json")).sort();
  if (files.length === 0) return null;
  try { return JSON.parse(readFileSync(join(d, files[files.length - 1]!), "utf8")) as MirrorReport; }
  catch { return null; }
}

export interface LedgerEntry {
  seq: number; finishedAt: string; artifactCount: number; source: string;
  trafficLight: string; headline: string;
  perVendor: Array<{ vendor: string; delta: number; weight: number }>;
  hmac: string; bodyDigest: string; file: string;
}

export function listReports(repoRoot: string, limit = 30): LedgerEntry[] {
  const p = join(dirOf(repoRoot), "reports.jsonl");
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
  const out: LedgerEntry[] = [];
  for (const l of lines.slice(-limit)) { try { out.push(JSON.parse(l) as LedgerEntry); } catch { /* skip */ } }
  return out;
}

export function verifyReport(card: MirrorReport, prev: string = CHAIN_SEED): { ok: true } | { ok: false; reason: string } {
  const { hmac, seq: _s, bodyDigest, ...body } = card;
  void _s;
  const recomputed = sha(canon(body));
  if (recomputed !== bodyDigest) return { ok: false, reason: "bodyDigest mismatch" };
  const expected = hmacOf(prev, recomputed);
  if (expected !== hmac) return { ok: false, reason: "hmac mismatch" };
  return { ok: true };
}
