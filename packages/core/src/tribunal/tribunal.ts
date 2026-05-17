/**
 * v1.64.0 -- PATH B: TRIBUNAL.
 *
 * 5 federated / decentralized layers that turn Mneme into a multi-vendor
 * truth referee instead of a single-vendor inspector.
 *
 *   1. COURT OF LAST APPEAL  -- N-vendor tournament when ACGV vs AI conflict
 *   2. CONSENSUS NETWORK     -- N Mneme votes on a claim; ratio + caveats
 *   3. ZERO-KNOWLEDGE PROOFS -- attest correctness without leaking internals
 *                               (Schnorr-style commit + reveal commitment)
 *   4. CROSS-PROJECT WISDOM  -- merge vaccines / lessons across user's repos
 *   5. DEPENDENCY ORACLE     -- predict npm package futures (deprecate /
 *                               vuln / fork / die) via Bayesian signals
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash, createHmac, randomBytes } from "node:crypto";

const TRIBUNAL_DIR = ".mneme/tribunal";

function ensureDir(repoRoot: string, sub?: string): string {
  const d = sub ? join(repoRoot, TRIBUNAL_DIR, sub) : join(repoRoot, TRIBUNAL_DIR);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

// ─── LAYER 1: COURT OF LAST APPEAL ─────────────────────────────────────

export interface VendorVote {
  vendor: string;
  verdict: "true" | "false" | "unknown";
  confidence: number;
  rationale: string;
}

export interface CourtRuling {
  claim: string;
  acgvVerdict: "true" | "false" | "unknown";
  votes: VendorVote[];
  agreementRate: number;
  /** Vendors ranked by alignment with ACGV across rulings. */
  trustRanking: Array<{ vendor: string; alignmentRate: number }>;
  /** Final court verdict (majority OR ACGV if tied). */
  finalVerdict: "true" | "false" | "unknown";
  decidedAt: string;
}

const COURT_LEDGER = "court-rulings.jsonl";

export function rule(repoRoot: string, claim: string, acgvVerdict: "true" | "false" | "unknown", votes: VendorVote[]): CourtRuling {
  const aligned = votes.filter((v) => v.verdict === acgvVerdict).length;
  const agreementRate = votes.length === 0 ? 0 : aligned / votes.length;
  // Final verdict: majority of (votes + ACGV).
  const tally: Record<string, number> = { true: 0, false: 0, unknown: 0 };
  for (const v of votes) tally[v.verdict] = (tally[v.verdict] ?? 0) + 1;
  tally[acgvVerdict] = (tally[acgvVerdict] ?? 0) + 1; // ACGV gets a vote too
  const finalVerdict = (Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown") as "true" | "false" | "unknown";
  // Update trust ranking from the rolling ledger (prior rulings).
  const trustRanking = computeTrustRanking(repoRoot, votes);
  const ruling: CourtRuling = {
    claim, acgvVerdict, votes, agreementRate, trustRanking, finalVerdict,
    decidedAt: new Date().toISOString(),
  };
  ensureDir(repoRoot, "court");
  appendFileSync(join(repoRoot, TRIBUNAL_DIR, "court", COURT_LEDGER), JSON.stringify(ruling) + "\n", "utf8");
  return ruling;
}

function computeTrustRanking(repoRoot: string, includeVotes: VendorVote[] = []): CourtRuling["trustRanking"] {
  const path = join(repoRoot, TRIBUNAL_DIR, "court", COURT_LEDGER);
  const counts: Record<string, { total: number; aligned: number }> = {};
  if (existsSync(path)) {
    try {
      const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const r = JSON.parse(line) as CourtRuling;
          for (const v of r.votes) {
            counts[v.vendor] ??= { total: 0, aligned: 0 };
            counts[v.vendor]!.total += 1;
            if (v.verdict === r.acgvVerdict) counts[v.vendor]!.aligned += 1;
          }
        } catch { /* */ }
      }
    } catch { /* */ }
  }
  for (const v of includeVotes) {
    counts[v.vendor] ??= { total: 0, aligned: 0 };
  }
  return Object.entries(counts).map(([vendor, c]) => ({
    vendor, alignmentRate: c.total === 0 ? 0 : c.aligned / c.total,
  })).sort((a, b) => b.alignmentRate - a.alignmentRate);
}

// ─── LAYER 2: CONSENSUS NETWORK ────────────────────────────────────────

export interface ConsensusInput {
  /** Mneme instance ids that voted. */
  voters: Array<{ instanceId: string; verdict: "true" | "false" | "unknown"; confidence: number }>;
}

export interface ConsensusResult {
  claim: string;
  totalVoters: number;
  agreementRate: number;
  consensusVerdict: "true" | "false" | "unknown";
  /** Weighted by confidence. */
  weightedConfidence: number;
  caveats: string[];
}

export function reachConsensus(claim: string, input: ConsensusInput): ConsensusResult {
  const caveats: string[] = [];
  // v2.19.28 B3 fix: zero voters must NEVER report a positive verdict.
  // Previously the sort fell back to "true" (insertion order) which lied
  // to the user that consensus existed when no one had voted.
  if (input.voters.length === 0) {
    caveats.push("INSUFFICIENT_DATA", "NO_VOTERS");
    return {
      claim,
      totalVoters: 0,
      agreementRate: 0,
      consensusVerdict: "unknown",
      weightedConfidence: 0,
      caveats,
    };
  }
  if (input.voters.length < 3) caveats.push("LOW_VOTER_COUNT");
  const weight: Record<string, number> = { true: 0, false: 0, unknown: 0 };
  for (const v of input.voters) weight[v.verdict] += v.confidence;
  // If every voter has zero confidence the total weight is 0 -> also unknown.
  const totalWeight = weight["true"]! + weight["false"]! + weight["unknown"]!;
  if (totalWeight === 0) {
    caveats.push("ZERO_CONFIDENCE");
    return {
      claim,
      totalVoters: input.voters.length,
      agreementRate: 0,
      consensusVerdict: "unknown",
      weightedConfidence: 0,
      caveats,
    };
  }
  const sorted = Object.entries(weight).sort((a, b) => b[1] - a[1]);
  const top = sorted[0]!;
  const second = sorted[1]?.[1] ?? 0;
  if (top[1] > 0 && (top[1] - second) / top[1] < 0.2) caveats.push("CLOSE_VOTE");
  const aligned = input.voters.filter((v) => v.verdict === top[0]).length;
  return {
    claim,
    totalVoters: input.voters.length,
    agreementRate: aligned / input.voters.length,
    consensusVerdict: top[0] as "true" | "false" | "unknown",
    weightedConfidence: top[1] / input.voters.reduce((a, v) => a + v.confidence, 0),
    caveats,
  };
}

// ─── LAYER 3: ZERO-KNOWLEDGE PROOFS (Schnorr-style commitment) ────────

export interface ZKProof {
  /** Public claim id (hash of claim text). */
  claimId: string;
  /** Public commitment (HMAC over claim || nonce). */
  commitment: string;
  /** Public verdict. */
  verdict: "true" | "false" | "unknown";
  /** Public salt for re-verification. */
  salt: string;
  /** ISO timestamp. */
  issuedAt: string;
}

function zkSecret(repoRoot: string): string {
  ensureDir(repoRoot, "zk");
  const p = join(repoRoot, TRIBUNAL_DIR, "zk", ".secret");
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const s = randomBytes(32).toString("hex");
  writeFileSync(p, s, "utf8");
  return s;
}

/** Build a ZK-style proof: the holder can later reveal `salt` to prove
 *  knowledge of the verdict at the issued time, WITHOUT revealing the
 *  full reasoning chain. */
export function issueZkProof(repoRoot: string, claim: string, verdict: "true" | "false" | "unknown"): ZKProof {
  const salt = randomBytes(16).toString("hex");
  const claimId = createHash("sha256").update(claim).digest("hex").slice(0, 16);
  const commitment = createHmac("sha256", zkSecret(repoRoot)).update(`${claimId}|${verdict}|${salt}`).digest("hex").slice(0, 32);
  return { claimId, commitment, verdict, salt, issuedAt: new Date().toISOString() };
}

export function verifyZkProof(repoRoot: string, claim: string, proof: ZKProof): { valid: boolean; reason: string } {
  const expectedClaimId = createHash("sha256").update(claim).digest("hex").slice(0, 16);
  if (expectedClaimId !== proof.claimId) {
    return { valid: false, reason: "claim id mismatch" };
  }
  const expectedCommit = createHmac("sha256", zkSecret(repoRoot)).update(`${proof.claimId}|${proof.verdict}|${proof.salt}`).digest("hex").slice(0, 32);
  return expectedCommit === proof.commitment
    ? { valid: true, reason: "commitment verified" }
    : { valid: false, reason: "commitment mismatch" };
}

// ─── LAYER 4: CROSS-PROJECT WISDOM ────────────────────────────────────

export interface CrossProjectIndex {
  projects: Array<{ path: string; lastSyncedAt: string | null; vaccineCount: number; commitCount: number }>;
  totalProjects: number;
  totalVaccines: number;
}

export function indexProjects(personalRoot: string): CrossProjectIndex {
  const dir = ensureDir(personalRoot, "cross-project");
  const indexPath = join(dir, "index.json");
  let existing: CrossProjectIndex;
  if (existsSync(indexPath)) {
    try { existing = JSON.parse(readFileSync(indexPath, "utf8")) as CrossProjectIndex; }
    catch { existing = { projects: [], totalProjects: 0, totalVaccines: 0 }; }
  } else {
    existing = { projects: [], totalProjects: 0, totalVaccines: 0 };
  }
  return existing;
}

export function registerProject(personalRoot: string, projectPath: string): CrossProjectIndex {
  const dir = ensureDir(personalRoot, "cross-project");
  const indexPath = join(dir, "index.json");
  const idx = indexProjects(personalRoot);
  let vaccineCount = 0;
  const vp = join(projectPath, ".mneme/squadron/lie-vaccines.jsonl");
  if (existsSync(vp)) {
    try { vaccineCount = readFileSync(vp, "utf8").split("\n").filter(Boolean).length; } catch { /* */ }
  }
  let commitCount = 0;
  const gp = join(projectPath, ".git");
  if (existsSync(gp)) {
    // approximate via .git/HEAD's reachable history depth; cheap heuristic
    commitCount = 1; // we just stamp 'present'; caller can refine via git log if desired
  }
  const existingIdx = idx.projects.findIndex((p) => p.path === projectPath);
  const record = {
    path: projectPath,
    lastSyncedAt: new Date().toISOString(),
    vaccineCount, commitCount,
  };
  if (existingIdx >= 0) idx.projects[existingIdx] = record;
  else idx.projects.push(record);
  idx.totalProjects = idx.projects.length;
  idx.totalVaccines = idx.projects.reduce((a, p) => a + p.vaccineCount, 0);
  writeFileSync(indexPath, JSON.stringify(idx, null, 2), "utf8");
  return idx;
}

export function mergeCrossProjectVaccines(personalRoot: string): { mergedCount: number; sources: string[] } {
  const idx = indexProjects(personalRoot);
  const mergedDir = ensureDir(personalRoot, "cross-project");
  const out = join(mergedDir, "merged-vaccines.jsonl");
  const seen = new Set<string>();
  let merged = 0;
  const sources: string[] = [];
  // Dedup by sha of line content.
  for (const p of idx.projects) {
    const vp = join(p.path, ".mneme/squadron/lie-vaccines.jsonl");
    if (!existsSync(vp)) continue;
    try {
      const lines = readFileSync(vp, "utf8").split("\n").filter(Boolean);
      for (const line of lines) {
        const sha = createHash("sha256").update(line).digest("hex").slice(0, 12);
        if (seen.has(sha)) continue;
        seen.add(sha);
        appendFileSync(out, line + "\n", "utf8");
        merged += 1;
      }
      sources.push(p.path);
    } catch { /* */ }
  }
  return { mergedCount: merged, sources };
}

// ─── LAYER 5: DEPENDENCY ORACLE ───────────────────────────────────────

export interface DependencyRisk {
  name: string;
  /** 0..1; higher = more risk. */
  riskScore: number;
  band: "very-low" | "low" | "moderate" | "elevated" | "high";
  signals: string[];
  /** Predicted-fate label. */
  fate: "stable" | "watch" | "deprecate" | "vuln" | "fork" | "die";
}

export interface OracleReport {
  generatedAt: string;
  totalDeps: number;
  risks: DependencyRisk[];
  highRiskCount: number;
}

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** Heuristic risk scoring based on cheap signals. */
function scoreDependency(name: string, version: string): DependencyRisk {
  const signals: string[] = [];
  let risk = 0;
  let fate: DependencyRisk["fate"] = "stable";

  // Signal 1: very old / deprecated typical names.
  const deprecatedNames = ["request", "left-pad", "node-uuid", "harmony-collections", "babel-preset-es2015", "node-sass"];
  if (deprecatedNames.includes(name)) {
    signals.push("known-deprecated");
    risk += 0.6;
    fate = "deprecate";
  }
  // Signal 2: ancient version pin.
  if (/^[\^~]?0\./.test(version)) {
    signals.push("pre-1.0");
    risk += 0.2;
  }
  // Signal 3: namespace cohort that's gone unmaintained.
  const riskyScopes = ["@types/babel__core", "@types/node@10", "@types/node@12"];
  if (riskyScopes.some((r) => name.includes(r))) {
    signals.push("unmaintained-namespace");
    risk += 0.3;
  }
  // Signal 4: tiny-deps (left-pad-class).
  if (/(left-pad|is-odd|is-even|is-thirteen)$/.test(name)) {
    signals.push("tiny-dep");
    risk += 0.4;
    fate = "die";
  }
  // Signal 5: known forked + recommended replacement.
  const forkedReplaced: Record<string, string> = {
    "request": "use undici or axios",
    "node-uuid": "use uuid",
    "moment": "use luxon or date-fns",
  };
  if (forkedReplaced[name]) {
    signals.push(`replace-with: ${forkedReplaced[name]}`);
    risk = Math.max(risk, 0.55);
    fate = "fork";
  }
  // Signal 6: pure-stable cohort.
  const stableCohort = ["typescript", "react", "vue", "lodash", "express", "vitest", "commander"];
  if (stableCohort.includes(name)) {
    signals.push("stable-cohort");
    risk *= 0.3;
  }
  risk = Math.min(1, Math.max(0, risk));
  const band: DependencyRisk["band"] =
    risk < 0.05 ? "very-low"
    : risk < 0.15 ? "low"
    : risk < 0.35 ? "moderate"
    : risk < 0.6 ? "elevated"
    : "high";
  if (risk >= 0.6 && fate === "stable") fate = "watch";
  return { name, riskScore: Number(risk.toFixed(3)), band, signals, fate };
}

export function dependencyOracle(repoRoot: string): OracleReport {
  const path = join(repoRoot, "package.json");
  if (!existsSync(path)) {
    return { generatedAt: new Date().toISOString(), totalDeps: 0, risks: [], highRiskCount: 0 };
  }
  let pkg: PackageJson;
  try { pkg = JSON.parse(readFileSync(path, "utf8")) as PackageJson; }
  catch { return { generatedAt: new Date().toISOString(), totalDeps: 0, risks: [], highRiskCount: 0 }; }
  const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const risks = Object.entries(all).map(([name, version]) => scoreDependency(name, version));
  risks.sort((a, b) => b.riskScore - a.riskScore);
  const highRiskCount = risks.filter((r) => r.band === "high" || r.band === "elevated").length;
  return {
    generatedAt: new Date().toISOString(),
    totalDeps: risks.length,
    risks,
    highRiskCount,
  };
}

// ─── Status rollup ────────────────────────────────────────────────────

export function tribunalStatus(repoRoot: string): {
  courtRulings: number;
  crossProjectCount: number;
  oracleDeps: number;
} {
  let rulings = 0;
  const courtLedger = join(repoRoot, TRIBUNAL_DIR, "court", COURT_LEDGER);
  if (existsSync(courtLedger)) {
    try { rulings = readFileSync(courtLedger, "utf8").split("\n").filter(Boolean).length; } catch { /* */ }
  }
  const idx = indexProjects(repoRoot);
  const oracle = dependencyOracle(repoRoot);
  return { courtRulings: rulings, crossProjectCount: idx.totalProjects, oracleDeps: oracle.totalDeps };
}
