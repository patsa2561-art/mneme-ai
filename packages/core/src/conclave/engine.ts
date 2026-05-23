/**
 * v2.29.0 — MNEME CONCLAVE engine.
 *
 * Orchestrates: AEAE variants × N vendor adapters in parallel →
 * VendorAggregate → BFT vote → ConsensusVerdict (HMAC-chained).
 */

import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type {
  ConsensusVerdict, ConclaveRunOptions, VendorAggregate, VendorStance,
} from "./types.js";
import { resolveVendors } from "./vendors/registry.js";
import { generateVariants, awarenessScore } from "./aeae/index.js";
import { aggregate } from "./bft.js";
import { aletheiaWeight } from "./aletheia_weights.js";

const HMAC_KEY = process.env["MNEME_CONCLAVE_KEY"] ?? "mneme-conclave-v1";
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
export function __resetConclaveChainForTest(): void { lastChainLink = CHAIN_SEED; }

function dominant<T>(values: T[], tiebreak: T[]): T {
  // Mode (most-frequent). On tie, prefer the first entry in tiebreak that's in values.
  const c = new Map<T, number>();
  for (const v of values) c.set(v, (c.get(v) ?? 0) + 1);
  let best: T | undefined;
  let bestN = 0;
  for (const [v, n] of c) { if (n > bestN) { best = v; bestN = n; } }
  // Tie detection
  const tied = [...c.entries()].filter(([, n]) => n === bestN).map(([v]) => v);
  if (tied.length > 1) {
    for (const t of tiebreak) if (tied.includes(t)) return t;
  }
  return best as T;
}

export async function runConclave(
  repoRoot: string,
  claim: string,
  opts: ConclaveRunOptions,
): Promise<ConsensusVerdict> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const threshold = opts.bftThreshold ?? 0.66;
  const bftStrict = opts.bftStrict === true;
  const aeae = opts.aeae !== false;
  const weightBy = opts.weightBy ?? "aletheia";

  const variants = aeae
    ? generateVariants(claim, opts.variants ? { include: opts.variants } : {})
    : [{ id: "verbatim", text: claim, strategy: "AEAE disabled — verbatim only" }];

  const adapters = resolveVendors(opts.vendors, { mockOnly: opts.mockOnly === true });

  // Fan-out: for each (vendor, variant) run in parallel.
  const allVerdicts = await Promise.all(
    adapters.flatMap((a) =>
      variants.map((v) =>
        a.run({ claim: v.text, variantId: v.id, timeoutMs: opts.vendorTimeoutMs }).catch((e) => ({
          vendor: a.id, variant: v.id, stance: "uncertain" as VendorStance, confidence: 0,
          reasoning: `adapter threw: ${(e as Error).message}`, dtMs: 0, error: (e as Error).name,
        })),
      ),
    ),
  );

  // Bucket by vendor.
  const perVendor: VendorAggregate[] = adapters.map((a) => {
    const own = allVerdicts.filter((v) => v.vendor === a.id);
    const stances = own.map((v) => v.stance);
    const tiebreak: VendorStance[] = ["refutes", "supports", "uncertain", "refuses"];
    const dom = dominant<VendorStance>(stances, tiebreak);
    const aw = awarenessScore(own.map((v) => ({ id: v.variant, stance: v.stance })));
    const weight = weightBy === "equal" ? 1 : aletheiaWeight(repoRoot, a.id);
    return {
      vendor: a.id,
      weight,
      dominantStance: dom,
      awarenessScore: aw.score,
      perVariant: own,
    };
  });

  // Drop vendors that ALL errored (no signal).
  const respondingVendors = perVendor.filter((v) => v.perVariant.some((p) => !p.error));
  const bft = aggregate(respondingVendors, { threshold, bftStrict });

  const finishedAt = new Date().toISOString();
  const totalMs = Date.now() - t0;

  let headline: string;
  switch (bft.outcome) {
    case "CONSENSUS":
      headline = `🟢 CONSENSUS — ${bft.winningStance} (${Math.round(bft.winningFraction * 100)}% weighted) across ${respondingVendors.length} vendors`;
      break;
    case "DISSENT":
      headline = `⚠ DISSENT — winning stance "${dominantStanceFromBreakdown(bft.dissentBreakdown)}" only ${Math.round(bft.winningFraction * 100)}% (threshold ${Math.round(threshold * 100)}%); see split`;
      break;
    case "AWARENESS_DETECTED":
      headline = `🔍 AWARENESS — vendors agreed on "${bft.winningStance}" but ${bft.awarenessFlags.length} of ${respondingVendors.length} flipped stance across AEAE variants (possible eval-mode behaviour)`;
      break;
    case "INSUFFICIENT_RESPONDERS":
      headline = `❌ INSUFFICIENT — only ${respondingVendors.length} vendors returned a usable verdict`;
      break;
  }

  const body = {
    spec: { name: "MNEME-CONCLAVE" as const, version: "1.0" },
    claim,
    startedAt,
    finishedAt,
    totalMs,
    vendors: opts.vendors,
    variants: variants.map((v) => v.id),
    threshold,
    bftStrict,
    aeaeOn: aeae,
    perVendor,
    weightedTallies: bft.weightedTallies,
    outcome: bft.outcome,
    winningStance: bft.winningStance,
    headline,
    awarenessFlags: bft.awarenessFlags,
    dissentBreakdown: bft.dissentBreakdown,
  };
  const bodyDigest = sha(canon(body));
  lastChainLink = hmacOf(lastChainLink, bodyDigest);
  return { ...body, hmac: lastChainLink, seq: parseInt(lastChainLink.slice(0, 8), 16), bodyDigest };
}

function dominantStanceFromBreakdown(b: ReturnType<typeof aggregate>["dissentBreakdown"]): VendorStance {
  if (!b || b.length === 0) return "uncertain";
  let best = b[0]!;
  for (const row of b) if (row.weight > best.weight) best = row;
  return best.stance;
}

// ── Persistence ──────────────────────────────────────────────────────

function dirOf(repoRoot: string): string {
  const d = join(repoRoot, ".mneme", "conclave");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

export function storeVerdict(repoRoot: string, v: ConsensusVerdict): { path: string; ledger: string } {
  const d = dirOf(repoRoot);
  const stamp = v.finishedAt.replace(/[:.]/g, "-");
  const path = join(d, `${String(v.seq).padStart(10, "0")}-${stamp}.json`);
  writeFileSync(path, JSON.stringify(v, null, 2) + "\n");
  const ledger = join(d, "verdicts.jsonl");
  const skim = {
    seq: v.seq, finishedAt: v.finishedAt,
    outcome: v.outcome, winningStance: v.winningStance,
    claim: v.claim.slice(0, 200),
    headline: v.headline,
    hmac: v.hmac, bodyDigest: v.bodyDigest, file: path,
  };
  appendFileSync(ledger, JSON.stringify(skim) + "\n");

  // If outcome is DISSENT, ALSO append to the federated dissent corpus —
  // this is the seed of the future cross-machine hallucination dataset
  // (Q2 of the research gap matrix).
  if (v.outcome === "DISSENT" && v.dissentBreakdown) {
    const dissentLedger = join(d, "dissent_corpus.jsonl");
    const entry = {
      at: v.finishedAt,
      claim: v.claim,
      split: v.dissentBreakdown,
      hmac: v.hmac,
    };
    appendFileSync(dissentLedger, JSON.stringify(entry) + "\n");
  }
  return { path, ledger };
}

export function readLatestVerdict(repoRoot: string): ConsensusVerdict | null {
  const d = dirOf(repoRoot);
  if (!existsSync(d)) return null;
  const files = readdirSync(d).filter((n) => n.endsWith(".json")).sort();
  if (files.length === 0) return null;
  try {
    return JSON.parse(readFileSync(join(d, files[files.length - 1]!), "utf8")) as ConsensusVerdict;
  } catch { return null; }
}

export interface LedgerEntry {
  seq: number; finishedAt: string; outcome: string; winningStance?: string;
  claim: string; headline: string; hmac: string; bodyDigest: string; file: string;
}

export function listVerdicts(repoRoot: string, limit = 30): LedgerEntry[] {
  const p = join(dirOf(repoRoot), "verdicts.jsonl");
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
  const out: LedgerEntry[] = [];
  for (const l of lines.slice(-limit)) { try { out.push(JSON.parse(l) as LedgerEntry); } catch { /* skip */ } }
  return out;
}

export function readDissentCorpus(repoRoot: string, limit = 100): unknown[] {
  const p = join(dirOf(repoRoot), "dissent_corpus.jsonl");
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
  const out: unknown[] = [];
  for (const l of lines.slice(-limit)) { try { out.push(JSON.parse(l)); } catch { /* skip */ } }
  return out;
}

export function verifyVerdict(card: ConsensusVerdict, prev: string = CHAIN_SEED): { ok: true } | { ok: false; reason: string } {
  const { hmac, seq: _s, bodyDigest, ...body } = card;
  void _s;
  const recomputed = sha(canon(body));
  if (recomputed !== bodyDigest) return { ok: false, reason: "bodyDigest mismatch" };
  const expected = hmacOf(prev, recomputed);
  if (expected !== hmac) return { ok: false, reason: "hmac mismatch" };
  return { ok: true };
}
