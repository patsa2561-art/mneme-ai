/**
 * v2.27.0 — TRUTH GATE engine.
 *
 * Drives the claim → probe → verdict pipeline + emits an HMAC-signed
 * truth matrix.
 */

import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type {
  Claim, ClaimVerdict, ReconciliationEntry, TruthMatrix, ProbeContext,
} from "./types.js";
import { CLAIM_CATALOG } from "./claims.js";
import { runProbe } from "./probes.js";

const HMAC_KEY = process.env["MNEME_TRUTH_KEY"] ?? "mneme-truth-gate-v1";
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

function compareNumeric(asserted: { value: number; op: string; tolerance?: number }, measured: number): ClaimVerdict {
  const tol = asserted.tolerance ?? 0;
  switch (asserted.op) {
    case "<": return measured < asserted.value ? "pass" : "drift";
    case "<=": return measured <= asserted.value ? "pass" : "drift";
    case ">": return measured > asserted.value ? "pass" : "drift";
    case ">=": return measured >= asserted.value ? "pass" : "drift";
    case "=": return Math.abs(measured - asserted.value) <= tol ? "pass" : "drift";
    case "~=": return Math.abs(measured - asserted.value) <= Math.max(tol, asserted.value * 0.1) ? "pass" : "drift";
    default: return "unmeasured";
  }
}

function compareBoolean(asserted: { value: number; op: string }, measured: boolean): ClaimVerdict {
  const wantTrue = asserted.value === 1;
  if (measured === wantTrue) return "pass";
  return wantTrue ? "refuted" : "drift";
}

let lastChainLink = CHAIN_SEED;

export function __resetTruthChainForTest(): void { lastChainLink = CHAIN_SEED; }

/**
 * Reconcile every claim in the catalog against its probe + emit a
 * tamper-evident truth matrix.
 */
export async function reconcileAll(ctx: ProbeContext): Promise<TruthMatrix> {
  const scannedAt = new Date().toISOString();
  const entries: ReconciliationEntry[] = [];
  for (const claim of CLAIM_CATALOG) {
    const probe = await runProbe(claim.probeId, ctx);
    let verdict: ClaimVerdict;
    let reason: string;
    if (probe.value === null) {
      verdict = "unmeasured";
      reason = `probe ${claim.probeId} returned null: ${probe.evidence}`;
    } else if (claim.kind === "numeric" && claim.asserted) {
      if (typeof probe.value !== "number") {
        verdict = "unmeasured";
        reason = `probe value is not numeric: ${String(probe.value).slice(0, 100)}`;
      } else {
        verdict = compareNumeric(claim.asserted, probe.value);
        reason = `asserted ${claim.asserted.op} ${claim.asserted.value}${claim.asserted.unit ? " " + claim.asserted.unit : ""}; measured ${probe.value}`;
      }
    } else if (claim.kind === "boolean" && claim.asserted) {
      if (typeof probe.value !== "boolean") {
        verdict = "unmeasured";
        reason = `probe value is not boolean: ${String(probe.value).slice(0, 100)}`;
      } else {
        verdict = compareBoolean(claim.asserted, probe.value);
        reason = `asserted ${claim.asserted.value === 1 ? "true" : "false"}; measured ${probe.value}`;
      }
    } else if (claim.kind === "string") {
      // String claims don't enforce a specific value (since the probe
      // returns the live string); they just record what was observed.
      // Verdict = pass when probe returned non-null.
      verdict = probe.value ? "pass" : "unmeasured";
      reason = `live = ${String(probe.value).slice(0, 100)}`;
    } else {
      verdict = "unmeasured";
      reason = "no comparison rule";
    }
    entries.push({ claim, probe, verdict, reason });
  }
  const pass = entries.filter((e) => e.verdict === "pass").length;
  const drift = entries.filter((e) => e.verdict === "drift").length;
  const refuted = entries.filter((e) => e.verdict === "refuted").length;
  const unmeasured = entries.filter((e) => e.verdict === "unmeasured").length;
  const measured = pass + drift + refuted;
  const truthScore = measured > 0 ? Math.round((pass / measured) * 100) : 0;
  let trafficLight: TruthMatrix["trafficLight"];
  let headline: string;
  if (truthScore >= 95 && refuted === 0) { trafficLight = "green"; headline = `🟢 TRUTHFUL — ${pass}/${measured} claims match measured reality (score ${truthScore}/100)`; }
  else if (truthScore >= 70) { trafficLight = "yellow"; headline = `🟡 MIXED — ${drift + refuted} drift/refuted; ${pass} pass (score ${truthScore}/100)`; }
  else { trafficLight = "red"; headline = `🔴 REFUTED — only ${pass}/${measured} claims hold up (score ${truthScore}/100)`; }
  const body = {
    spec: { name: "MNEME-TRUTH-GATE" as const, version: "1.0" },
    scannedAt,
    cwd: ctx.cwd,
    totalClaims: entries.length,
    entries,
    summary: { pass, drift, refuted, unmeasured, truthScore },
    headline,
    trafficLight,
  };
  const bodyDigest = sha(canon(body));
  lastChainLink = hmacOf(lastChainLink, bodyDigest);
  return { ...body, hmac: lastChainLink, seq: parseInt(lastChainLink.slice(0, 8), 16), bodyDigest };
}

// ── Persistence ──────────────────────────────────────────────────────

function dirOf(repoRoot: string): string {
  const d = join(repoRoot, ".mneme", "truth_gate");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

export function storeMatrix(repoRoot: string, m: TruthMatrix): { path: string; ledger: string } {
  const d = dirOf(repoRoot);
  const stamp = m.scannedAt.replace(/[:.]/g, "-");
  const path = join(d, `${String(m.seq).padStart(10, "0")}-${stamp}.json`);
  writeFileSync(path, JSON.stringify(m, null, 2) + "\n");
  const ledger = join(d, "matrix.jsonl");
  const skim = {
    seq: m.seq,
    scannedAt: m.scannedAt,
    truthScore: m.summary.truthScore,
    pass: m.summary.pass,
    drift: m.summary.drift,
    refuted: m.summary.refuted,
    trafficLight: m.trafficLight,
    headline: m.headline,
    hmac: m.hmac,
    bodyDigest: m.bodyDigest,
    file: path,
  };
  appendFileSync(ledger, JSON.stringify(skim) + "\n");
  return { path, ledger };
}

export function readLatestMatrix(repoRoot: string): TruthMatrix | null {
  const d = dirOf(repoRoot);
  if (!existsSync(d)) return null;
  const files = readdirSync(d).filter((n) => n.endsWith(".json")).sort();
  if (files.length === 0) return null;
  try {
    return JSON.parse(readFileSync(join(d, files[files.length - 1]!), "utf8")) as TruthMatrix;
  } catch { return null; }
}

export interface MatrixLedgerEntry {
  seq: number; scannedAt: string; truthScore: number; pass: number; drift: number; refuted: number;
  trafficLight: TruthMatrix["trafficLight"]; headline: string; hmac: string; bodyDigest: string; file: string;
}

export function listMatrices(repoRoot: string, limit = 30): MatrixLedgerEntry[] {
  const p = join(dirOf(repoRoot), "matrix.jsonl");
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
  const out: MatrixLedgerEntry[] = [];
  for (const l of lines.slice(-limit)) { try { out.push(JSON.parse(l) as MatrixLedgerEntry); } catch { /* skip */ } }
  return out;
}

/** Verify a matrix's HMAC against a previous chain link. */
export function verifyMatrix(m: TruthMatrix, prevLink: string = CHAIN_SEED): { ok: true } | { ok: false; reason: string } {
  const { hmac, seq: _s, bodyDigest, ...body } = m;
  void _s;
  const recomputed = sha(canon(body));
  if (recomputed !== bodyDigest) return { ok: false, reason: "bodyDigest mismatch" };
  const expected = hmacOf(prevLink, recomputed);
  if (expected !== hmac) return { ok: false, reason: "hmac mismatch" };
  return { ok: true };
}

/** Render a short text view for terminal. */
export function renderShort(m: TruthMatrix): string[] {
  return [
    m.headline,
    ``,
    `Scanned at: ${m.scannedAt}`,
    `Score:      ${m.summary.truthScore}/100`,
    `Pass:       ${m.summary.pass}/${m.totalClaims}`,
    `Drift:      ${m.summary.drift}`,
    `Refuted:    ${m.summary.refuted}`,
    `Unmeasured: ${m.summary.unmeasured}`,
    ``,
    `Drifted / refuted claims:`,
    ...m.entries
      .filter((e) => e.verdict === "drift" || e.verdict === "refuted")
      .slice(0, 10)
      .map((e) => `  [${e.verdict.toUpperCase().padEnd(7)}] ${e.claim.id} · ${e.reason}`),
    ``,
    `HMAC: ${m.hmac.slice(0, 16)}… (seq ${m.seq})`,
  ];
}
