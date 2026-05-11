/**
 * DEMON STAGE 3.1 — Continuous Shipping Executor (v1.44.0)
 *
 * SCOPE: turn the v1.38 AUTOPHAGY EVALUATOR (which only graded a release
 * candidate) into a real release runner. It runs the operator-supplied
 * gates (`build`, `test`, `lint`), bumps a version per the requested
 * level, writes a release manifest, and STAGES the release. It NEVER
 * runs `git push` or `npm publish` on its own — those are explicit
 * operator actions called from the manifest.
 *
 * SAFETY:
 *   - All gate commands run with a configurable timeout (default 5min)
 *   - Never bumps version when gates fail
 *   - Manifest is written even on failure (so the operator can audit)
 *   - Refuses to ship when working tree is dirty (operator override
 *     via `allowDirty: true`)
 *
 * INNOVATIONS BEYOND SPEC:
 *   - Per-gate metrics (durationMs, exitCode, stdoutTail, stderrTail)
 *   - "Ship-readiness score" = % of gates passed × 100, with optional
 *     weighting per gate so test failures count more than lint failures
 *   - Idempotent dry-run: runs everything except the version bump,
 *     so operators can preview the release
 *   - Manifest carries a deterministic "release fingerprint" =
 *     sha256(versionBefore + versionAfter + sortedGateOutcomes) for
 *     audit trails
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

export type BumpLevel = "patch" | "minor" | "major";

export interface Gate {
  name: string;
  command: string;
  args: string[];
  weight?: number;        // default 1; higher = more impact on readiness score
  timeoutMs?: number;     // default 300_000
  cwd?: string;
}

export interface GateResult {
  name: string;
  passed: boolean;
  durationMs: number;
  exitCode: number | null;
  stdoutTail: string;
  stderrTail: string;
  timedOut: boolean;
}

export interface ShipManifest {
  ranAt: string;
  dryRun: boolean;
  versionBefore: string;
  versionAfter: string;
  bumpLevel: BumpLevel;
  gates: GateResult[];
  readinessScore: number;       // 0..100, weighted
  shipped: boolean;             // true only when all gates passed AND not dryRun
  refusedReason: string | null; // e.g. "dirty-tree", "gate-failed"
  fingerprint: string;
}

export interface ShipOptions {
  bump: BumpLevel;
  gates: Gate[];
  dryRun?: boolean;
  allowDirty?: boolean;
  packageJsonPath?: string;
}

const DEFAULT_GATE_TIMEOUT = 300_000; // 5 min
const TAIL_LINES = 20;

function tail(s: string, n: number): string {
  const lines = s.split("\n");
  return lines.slice(-n).join("\n");
}

function runGate(gate: Gate, defaultCwd: string): GateResult {
  const t0 = Date.now();
  const result = spawnSync(gate.command, gate.args, {
    cwd: gate.cwd ?? defaultCwd,
    timeout: gate.timeoutMs ?? DEFAULT_GATE_TIMEOUT,
    encoding: "utf8",
    shell: false,
  });
  const dur = Date.now() - t0;
  const timedOut = (result as { signal?: string | null }).signal === "SIGTERM" && dur >= (gate.timeoutMs ?? DEFAULT_GATE_TIMEOUT);
  return {
    name: gate.name,
    passed: !timedOut && result.status === 0,
    durationMs: dur,
    exitCode: result.status,
    stdoutTail: tail((result.stdout ?? "").toString(), TAIL_LINES),
    stderrTail: tail((result.stderr ?? "").toString(), TAIL_LINES),
    timedOut,
  };
}

function bumpSemver(v: string, level: BumpLevel): string {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (!m) throw new Error(`unparseable version: ${v}`);
  let [maj, min, pat] = [parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10)];
  if (level === "patch") pat++;
  else if (level === "minor") { min++; pat = 0; }
  else if (level === "major") { maj++; min = 0; pat = 0; }
  return `${maj}.${min}.${pat}`;
}

function isDirtyTree(repoRoot: string): boolean {
  const r = spawnSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" });
  if (r.status !== 0) return false; // not a git repo → not dirty
  return (r.stdout ?? "").trim().length > 0;
}

function readPkgVersion(pkgPath: string): string {
  const p = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
  if (!p.version) throw new Error(`no version in ${pkgPath}`);
  return p.version;
}

function writePkgVersion(pkgPath: string, newVersion: string): void {
  const raw = readFileSync(pkgPath, "utf8");
  // Surgical edit to preserve formatting and other fields' position
  const updated = raw.replace(/("version"\s*:\s*")([^"]+)(")/, `$1${newVersion}$3`);
  if (updated === raw) throw new Error(`could not patch version in ${pkgPath}`);
  writeFileSync(pkgPath, updated);
}

function fingerprint(versionBefore: string, versionAfter: string, gates: GateResult[]): string {
  const sortedSummary = [...gates].sort((a, b) => a.name.localeCompare(b.name)).map((g) => `${g.name}:${g.passed ? "ok" : "fail"}:${g.exitCode ?? "null"}`).join("|");
  return createHash("sha256").update(`${versionBefore}->${versionAfter}::${sortedSummary}`).digest("hex").slice(0, 16);
}

function readinessScore(gates: GateResult[]): number {
  if (gates.length === 0) return 0;
  let totalWeight = 0;
  let earned = 0;
  for (const g of gates) {
    const w = (g as { weight?: number }).weight ?? 1;
    totalWeight += w;
    if (g.passed) earned += w;
  }
  return Math.round((earned / totalWeight) * 100);
}

export function ship(repoRoot: string, opts: ShipOptions): ShipManifest {
  const root = resolve(repoRoot);
  const pkgPath = opts.packageJsonPath ?? join(root, "package.json");
  const versionBefore = readPkgVersion(pkgPath);
  const ranAt = new Date().toISOString();

  const dryRun = !!opts.dryRun;
  const allowDirty = !!opts.allowDirty;

  const gateResults: GateResult[] = [];
  for (const g of opts.gates) {
    // Carry weight onto the result for fair scoring
    const r = runGate(g, root) as GateResult & { weight?: number };
    if (g.weight) r.weight = g.weight;
    gateResults.push(r);
  }
  const score = readinessScore(opts.gates.map((g, i) => ({ ...gateResults[i]!, weight: g.weight ?? 1 })));

  let refusedReason: string | null = null;
  if (!allowDirty && isDirtyTree(root)) refusedReason = "dirty-tree";
  if (!refusedReason && gateResults.some((g) => !g.passed)) refusedReason = "gate-failed";

  let versionAfter = versionBefore;
  let shipped = false;

  if (!refusedReason && !dryRun) {
    versionAfter = bumpSemver(versionBefore, opts.bump);
    writePkgVersion(pkgPath, versionAfter);
    shipped = true;
  } else if (!refusedReason && dryRun) {
    versionAfter = bumpSemver(versionBefore, opts.bump);
  }

  const manifest: ShipManifest = {
    ranAt,
    dryRun,
    versionBefore,
    versionAfter,
    bumpLevel: opts.bump,
    gates: gateResults,
    readinessScore: score,
    shipped,
    refusedReason,
    fingerprint: fingerprint(versionBefore, versionAfter, gateResults),
  };

  // Persist a copy of every manifest for audit, even refused ones
  const manifestDir = join(root, ".mneme", "ship-manifests");
  mkdirSync(manifestDir, { recursive: true });
  const manifestName = `${ranAt.replace(/[:.]/g, "-")}_${manifest.fingerprint}.json`;
  writeFileSync(join(manifestDir, manifestName), JSON.stringify(manifest, null, 2));
  // Append to a flat ledger for quick history scanning
  appendFileSync(join(manifestDir, "ledger.jsonl"), JSON.stringify({ ranAt, versionBefore, versionAfter, shipped, refusedReason, score, fingerprint: manifest.fingerprint }) + "\n");

  return manifest;
}

export function listManifests(repoRoot: string): { ranAt: string; versionBefore: string; versionAfter: string; shipped: boolean; refusedReason: string | null; score: number; fingerprint: string }[] {
  const path = join(repoRoot, ".mneme", "ship-manifests", "ledger.jsonl");
  if (!existsSync(path)) return [];
  const out: { ranAt: string; versionBefore: string; versionAfter: string; shipped: boolean; refusedReason: string | null; score: number; fingerprint: string }[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return out;
}
