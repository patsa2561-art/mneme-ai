/**
 * v2.31.0 — REWIND engine.
 *
 * Pipeline:
 *   1. Read commits in `range` (default HEAD~100..HEAD) — git only.
 *   2. Build intent fingerprint per commit (category × surface ×
 *      sizeBucket × topic-simhash).
 *   3. Either freshly seal a Capsule OR reuse `reuseCapsuleId` so the
 *      SAME prompts get fired at every vendor release (time-capsule).
 *   4. For each (vendor, commit): blind-replay → score reply vs
 *      accepted diff → bucket by intent class.
 *   5. Compare to prior card for same vendor (different vendorVersion)
 *      → emit RegressionVerdict.
 *   6. HMAC-chain the VendorRegressionCard + persist + write feedback
 *      to .mneme/aletheia/honest_mirror_weights.json (composes with
 *      HONEST MIRROR's CONCLAVE feedback loop — REWIND just blends in).
 */

import { spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import {
  existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, appendFileSync,
} from "node:fs";
import { join } from "node:path";

import type {
  Capsule, CapsuleCommit, RewindOptions, RewindReplayFn,
  VendorRegressionCard, IntentClassScore, RegressionVerdict,
} from "./types.js";
import { buildFingerprint, correctnessScore } from "./intent_class.js";
import { scrub } from "../honest_mirror/anonymizer.js";

const HMAC_KEY = process.env["MNEME_REWIND_KEY"] ?? "mneme-rewind-v1";
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
export function __resetRewindChainForTest(): void { lastChainLink = CHAIN_SEED; }

// ── Git helpers (lightweight; no dependency on the runtime git module) ─

function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 20_000, maxBuffer: 8 * 1024 * 1024 });
  if (r.status !== 0) return "";
  return r.stdout ?? "";
}

export function gitAvailable(cwd: string): boolean {
  const r = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd, encoding: "utf8", timeout: 5_000 });
  return r.status === 0 && (r.stdout ?? "").trim() === "true";
}

interface RawCommit { sha: string; at: string; subject: string; body: string; }

function listCommitsInRange(cwd: string, range: string): RawCommit[] {
  const FS = "\x1f"; const RS = "\x1e";
  const fmt = `%H${FS}%aI${FS}%s${FS}%b${RS}`;
  const raw = git(cwd, ["log", range, `--pretty=format:${fmt}`]);
  if (!raw) return [];
  const out: RawCommit[] = [];
  for (const row of raw.split(RS)) {
    const r = row.trim();
    if (!r) continue;
    const parts = r.split(FS);
    if (parts.length < 3) continue;
    out.push({ sha: parts[0]!, at: parts[1]!, subject: parts[2]!, body: parts[3] ?? "" });
  }
  return out
    .filter((c) => !/^(chore\(release\)|Merge |Revert )/i.test(c.subject))
    .filter((c) => c.subject.length >= 12);
}

function getDiffMeta(cwd: string, sha: string): { files: string[]; lines: number; diff: string } {
  const numstat = git(cwd, ["show", "--no-color", "--pretty=", "--numstat", sha]);
  let lines = 0; const files: string[] = [];
  for (const ln of numstat.split("\n")) {
    const parts = ln.trim().split(/\s+/);
    if (parts.length >= 3) {
      const added = parseInt(parts[0]!, 10);
      const removed = parseInt(parts[1]!, 10);
      if (!Number.isNaN(added)) lines += added;
      if (!Number.isNaN(removed)) lines += removed;
      files.push(parts.slice(2).join(" "));
    }
  }
  const diff = git(cwd, ["show", "--no-color", "--stat", "--patch", sha]).slice(0, 8000);
  return { files, lines, diff };
}

// ── Capsule sealing ─────────────────────────────────────────────────────

export function sealCapsule(cwd: string, range: string, count: number, seed: number): Capsule {
  const all = listCommitsInRange(cwd, range);
  if (all.length === 0) {
    const empty: Capsule = {
      id: "empty-" + sha(`${range}|${seed}`).slice(0, 12),
      spec: { name: "MNEME-REWIND-CAPSULE", version: "1.0" },
      sealedAt: new Date().toISOString(),
      range, commitCount: 0,
      intentDistribution: {},
      commits: [],
      hmac: "",
      bodyDigest: "",
    };
    const body = { ...empty, hmac: undefined, bodyDigest: undefined };
    const digest = sha(canon(body));
    empty.bodyDigest = digest;
    empty.hmac = createHmac("sha256", HMAC_KEY).update(digest).digest("hex");
    return empty;
  }
  const take = count <= 0 ? all.length : Math.min(count, all.length);
  // Deterministic sample by seed: rotate + step.
  const step = Math.max(1, Math.floor(all.length / take));
  const start = seed % all.length;
  const picked: RawCommit[] = [];
  for (let i = 0; i < take; i++) {
    const idx = (start + i * step) % all.length;
    picked.push(all[idx]!);
  }

  const commits: CapsuleCommit[] = [];
  const intentDistribution: Record<string, number> = {};
  for (const c of picked) {
    const meta = getDiffMeta(cwd, c.sha);
    const fp = buildFingerprint(c.subject, meta.files, meta.lines);
    const scrubbedSubject = scrub(c.subject).text;
    const scrubbedBody = scrub(c.body).text;
    const scrubbedDiff = scrub(meta.diff).text;
    commits.push({
      sha: c.sha.slice(0, 7),
      at: c.at,
      subject: scrubbedSubject,
      body: scrubbedBody,
      acceptedDiff: scrubbedDiff,
      files: meta.files.slice(0, 32),
      fingerprint: fp,
    });
    intentDistribution[fp.intentClass] = (intentDistribution[fp.intentClass] ?? 0) + 1;
  }

  const stableId = sha(picked.map((c) => c.sha).join(",")).slice(0, 12);
  const cap: Capsule = {
    id: `cap-${stableId}`,
    spec: { name: "MNEME-REWIND-CAPSULE", version: "1.0" },
    sealedAt: new Date().toISOString(),
    range,
    commitCount: commits.length,
    intentDistribution,
    commits,
    hmac: "",
    bodyDigest: "",
  };
  const body = { ...cap, hmac: undefined, bodyDigest: undefined };
  cap.bodyDigest = sha(canon(body));
  cap.hmac = createHmac("sha256", HMAC_KEY).update(cap.bodyDigest).digest("hex");
  return cap;
}

export function verifyCapsule(cap: Capsule): { ok: true } | { ok: false; reason: string } {
  const { hmac, bodyDigest, ...body } = cap;
  const recomputed = sha(canon({ ...body, hmac: undefined, bodyDigest: undefined }));
  if (recomputed !== bodyDigest) return { ok: false, reason: "bodyDigest mismatch" };
  const expected = createHmac("sha256", HMAC_KEY).update(recomputed).digest("hex");
  if (expected !== hmac) return { ok: false, reason: "hmac mismatch" };
  return { ok: true };
}

// ── Persistence ─────────────────────────────────────────────────────────

function dirOf(repoRoot: string, sub: string): string {
  const d = join(repoRoot, ".mneme", "rewind", sub);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

export function storeCapsule(repoRoot: string, cap: Capsule): string {
  const d = dirOf(repoRoot, "capsules");
  const p = join(d, `${cap.id}.json`);
  writeFileSync(p, JSON.stringify(cap, null, 2));
  return p;
}

export function loadCapsule(repoRoot: string, capsuleId: string): Capsule | null {
  const p = join(repoRoot, ".mneme", "rewind", "capsules", `${capsuleId}.json`);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")) as Capsule; } catch { return null; }
}

export function listCapsules(repoRoot: string): string[] {
  const d = join(repoRoot, ".mneme", "rewind", "capsules");
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((n) => n.endsWith(".json")).map((n) => n.replace(/\.json$/, ""));
}

export function storeCard(repoRoot: string, card: VendorRegressionCard): { path: string; ledger: string } {
  const d = dirOf(repoRoot, "cards");
  const stamp = card.runAt.replace(/[:.]/g, "-");
  const safeVendor = card.vendor.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeVersion = card.vendorVersion.replace(/[^a-zA-Z0-9_-]/g, "_");
  const p = join(d, `${String(card.seq).padStart(10, "0")}-${safeVendor}-${safeVersion}-${stamp}.json`);
  writeFileSync(p, JSON.stringify(card, null, 2));
  const ledger = join(dirOf(repoRoot, ""), "cards.jsonl");
  const skim = {
    seq: card.seq, runAt: card.runAt, capsuleId: card.capsuleId,
    vendor: card.vendor, vendorVersion: card.vendorVersion,
    correctness: card.meanCorrectness, confidence: card.meanConfidence,
    delta: card.meanCalibrationDelta, regression: card.regression.status,
    weight: card.suggestedAletheiaWeight, headline: card.headline,
    hmac: card.hmac, bodyDigest: card.bodyDigest, file: p,
  };
  appendFileSync(ledger, JSON.stringify(skim) + "\n");

  // Compose with HONEST MIRROR's CONCLAVE feedback loop: REWIND writes
  // into the SAME honest_mirror_weights.json file with source="rewind"
  // so CONCLAVE Aletheia weights pick up the regression signal without
  // any new wiring.
  try {
    const feedbackDir = join(repoRoot, ".mneme", "aletheia");
    if (!existsSync(feedbackDir)) mkdirSync(feedbackDir, { recursive: true });
    const feedbackPath = join(feedbackDir, "honest_mirror_weights.json");
    const merged: Record<string, { trust: number; source: string; at: string }> = {};
    if (existsSync(feedbackPath)) {
      try { Object.assign(merged, JSON.parse(readFileSync(feedbackPath, "utf8")) as typeof merged); }
      catch { /* corrupt → start fresh */ }
    }
    merged[card.vendor] = {
      trust: card.suggestedAletheiaWeight,
      source: "rewind",
      at: card.runAt,
    };
    writeFileSync(feedbackPath, JSON.stringify(merged, null, 2));
  } catch { /* best-effort */ }

  return { path: p, ledger };
}

export interface CardLedgerEntry {
  seq: number; runAt: string; capsuleId: string;
  vendor: string; vendorVersion: string;
  correctness: number; confidence: number; delta: number;
  regression: string; weight: number; headline: string;
  hmac: string; bodyDigest: string; file: string;
}

export function listCards(repoRoot: string, limit = 50): CardLedgerEntry[] {
  const p = join(repoRoot, ".mneme", "rewind", "cards.jsonl");
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
  const out: CardLedgerEntry[] = [];
  for (const l of lines.slice(-limit)) { try { out.push(JSON.parse(l) as CardLedgerEntry); } catch { /* skip */ } }
  return out;
}

export function priorCardForVendor(
  repoRoot: string,
  vendor: string,
  excludeVersion: string,
): CardLedgerEntry | null {
  const all = listCards(repoRoot, 500);
  for (let i = all.length - 1; i >= 0; i--) {
    const e = all[i]!;
    if (e.vendor === vendor && e.vendorVersion !== excludeVersion) return e;
  }
  return null;
}

export function readCard(repoRoot: string, file: string): VendorRegressionCard | null {
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, "utf8")) as VendorRegressionCard; } catch { return null; }
}

// ── Card verify (HMAC chain) ────────────────────────────────────────────

export function verifyCard(card: VendorRegressionCard, prev: string = CHAIN_SEED): { ok: true } | { ok: false; reason: string } {
  const { hmac, seq: _s, bodyDigest, ...body } = card;
  void _s;
  const recomputed = sha(canon(body));
  if (recomputed !== bodyDigest) return { ok: false, reason: "bodyDigest mismatch" };
  const expected = hmacOf(prev, recomputed);
  if (expected !== hmac) return { ok: false, reason: "hmac mismatch" };
  return { ok: true };
}

// ── runRewind: the orchestrator ─────────────────────────────────────────

export async function runRewind(
  repoRoot: string,
  opts: RewindOptions,
  replay: RewindReplayFn,
  embed?: (texts: string[]) => Promise<Float32Array[]>,
): Promise<{ capsule: Capsule; cards: VendorRegressionCard[] }> {
  const range = opts.range ?? "HEAD~100..HEAD";
  const count = opts.count ?? 20;
  const seed = opts.seed ?? Date.now();

  let capsule = opts.reuseCapsuleId ? loadCapsule(repoRoot, opts.reuseCapsuleId) : null;
  if (!capsule) {
    capsule = sealCapsule(repoRoot, range, count, seed);
    storeCapsule(repoRoot, capsule);
  }

  const cards: VendorRegressionCard[] = [];
  for (const vendor of opts.vendors) {
    const t0 = Date.now();
    let vendorVersion = "unknown";
    const perCommit: Array<{ intentClass: string; correctness: number; confidence: number }> = [];

    for (const c of capsule.commits) {
      const r = await replay({
        vendor,
        prompt: c.subject + (c.body ? "\n\n" + c.body : ""),
        artifactTimestamp: c.at,
      }).catch((e) => ({
        vendor, vendorVersion: "error", answer: "",
        confidence: 0, dtMs: 0, error: (e as Error).message,
      } as Awaited<ReturnType<RewindReplayFn>>));
      if (r.error) continue;
      if (r.vendorVersion && r.vendorVersion !== "unknown") vendorVersion = r.vendorVersion;
      const score = await correctnessScore(r.answer, c.acceptedDiff, embed);
      perCommit.push({
        intentClass: c.fingerprint.intentClass,
        correctness: score,
        confidence: r.confidence,
      });
    }

    // Aggregate per intent class
    const byClass = new Map<string, { sumC: number; sumConf: number; n: number }>();
    for (const e of perCommit) {
      const cur = byClass.get(e.intentClass) ?? { sumC: 0, sumConf: 0, n: 0 };
      cur.sumC += e.correctness; cur.sumConf += e.confidence; cur.n += 1;
      byClass.set(e.intentClass, cur);
    }
    const perIntentClass: IntentClassScore[] = [];
    for (const [k, v] of byClass.entries()) {
      perIntentClass.push({
        intentClass: k, n: v.n,
        meanCorrectness: round3(v.sumC / v.n),
        meanConfidence: round3(v.sumConf / v.n),
      });
    }
    perIntentClass.sort((a, b) => b.n - a.n);

    const meanCorrectness = perCommit.length === 0 ? 0
      : perCommit.reduce((s, e) => s + e.correctness, 0) / perCommit.length;
    const meanConfidence = perCommit.length === 0 ? 0
      : perCommit.reduce((s, e) => s + e.confidence, 0) / perCommit.length;
    const meanCalibrationDelta = meanConfidence - meanCorrectness;

    // Regression detection: prior card for same vendor, different version
    const prior = priorCardForVendor(repoRoot, vendor, vendorVersion);
    let regression: RegressionVerdict;
    if (!prior) {
      regression = { status: "new", deltaCorrectness: 0 };
    } else {
      const deltaC = meanCorrectness - prior.correctness;
      let status: RegressionVerdict["status"];
      if (Math.abs(deltaC) < 0.05) status = "stable";
      else if (deltaC > 0) status = "improvement";
      else status = "regression";

      // Worst + best intent class — compare per-class scores against
      // prior card's per-class scores when we can read them.
      let worst: { intentClass: string; deltaCorrectness: number } | undefined;
      let best: { intentClass: string; deltaCorrectness: number } | undefined;
      const priorCard = readCard(repoRoot, prior.file);
      if (priorCard) {
        const priorByClass = new Map(priorCard.perIntentClass.map((p) => [p.intentClass, p.meanCorrectness] as const));
        for (const cur of perIntentClass) {
          const p = priorByClass.get(cur.intentClass);
          if (p === undefined) continue;
          const d = cur.meanCorrectness - p;
          if (!worst || d < worst.deltaCorrectness) worst = { intentClass: cur.intentClass, deltaCorrectness: round3(d) };
          if (!best || d > best.deltaCorrectness) best = { intentClass: cur.intentClass, deltaCorrectness: round3(d) };
        }
      }
      regression = {
        status,
        deltaCorrectness: round3(deltaC),
        worstIntentClass: worst,
        bestIntentClass: best,
        comparedToSeq: prior.seq,
        comparedToVersion: prior.vendorVersion,
      };
    }

    const suggestedAletheiaWeight = computeWeight(meanCorrectness, meanCalibrationDelta);

    let headline: string;
    if (regression.status === "regression") {
      headline = `🔴 REWIND — ${vendor}@${vendorVersion} regressed by ${(Math.abs(regression.deltaCorrectness) * 100).toFixed(0)}% vs ${regression.comparedToVersion ?? "prior"}`;
    } else if (regression.status === "improvement") {
      headline = `🟢 REWIND — ${vendor}@${vendorVersion} improved ${(regression.deltaCorrectness * 100).toFixed(0)}% vs ${regression.comparedToVersion ?? "prior"}`;
    } else if (regression.status === "stable") {
      headline = `🟡 REWIND — ${vendor}@${vendorVersion} stable (Δ${(regression.deltaCorrectness * 100).toFixed(0)}%) vs ${regression.comparedToVersion ?? "prior"}`;
    } else {
      headline = `🆕 REWIND — first capsule run for ${vendor}@${vendorVersion} (correctness ${Math.round(meanCorrectness * 100)}%)`;
    }

    const runAt = new Date().toISOString();
    const totalMs = Date.now() - t0;
    const body = {
      spec: { name: "MNEME-REWIND-CARD" as const, version: "1.0" },
      capsuleId: capsule.id,
      vendor, vendorVersion, runAt, totalMs,
      meanCorrectness: round3(meanCorrectness),
      meanConfidence: round3(meanConfidence),
      meanCalibrationDelta: round3(meanCalibrationDelta),
      perIntentClass, regression,
      headline,
      suggestedAletheiaWeight,
    };
    const bodyDigest = sha(canon(body));
    lastChainLink = hmacOf(lastChainLink, bodyDigest);
    const card: VendorRegressionCard = {
      ...body,
      hmac: lastChainLink,
      seq: parseInt(lastChainLink.slice(0, 8), 16),
      bodyDigest,
    };
    storeCard(repoRoot, card);
    cards.push(card);
  }

  return { capsule, cards };
}

function round3(n: number): number { return Number(n.toFixed(3)); }

function computeWeight(meanCorrectness: number, meanCalibrationDelta: number): number {
  const raw = 0.5 + 0.5 * meanCorrectness - 0.3 * Math.max(0, meanCalibrationDelta);
  return Math.max(0.1, Math.min(0.95, Number(raw.toFixed(3))));
}

// ── Markdown card (the shareable artifact) ──────────────────────────────

export function renderMarkdownCard(card: VendorRegressionCard): string {
  const lines: string[] = [];
  lines.push(`# 🪄 REWIND — Vendor Regression Card`);
  lines.push(``);
  lines.push(`**Vendor:** ${card.vendor}@${card.vendorVersion}`);
  lines.push(`**Capsule:** ${card.capsuleId}`);
  lines.push(`**Run at:** ${card.runAt}`);
  lines.push(``);
  lines.push(card.headline);
  lines.push(``);
  lines.push(`| metric | value |`);
  lines.push(`|---|---|`);
  lines.push(`| mean correctness | ${(card.meanCorrectness * 100).toFixed(1)}% |`);
  lines.push(`| mean confidence  | ${(card.meanConfidence * 100).toFixed(1)}% |`);
  lines.push(`| calibration Δ    | ${(card.meanCalibrationDelta * 100).toFixed(1)}% |`);
  lines.push(`| regression       | ${card.regression.status} (Δ${(card.regression.deltaCorrectness * 100).toFixed(1)}%) |`);
  if (card.regression.comparedToVersion) {
    lines.push(`| compared to      | ${card.regression.comparedToVersion} (seq ${card.regression.comparedToSeq}) |`);
  }
  lines.push(`| suggested Aletheia weight | ${card.suggestedAletheiaWeight} |`);
  lines.push(``);
  if (card.perIntentClass.length > 0) {
    lines.push(`## per-intent-class`);
    lines.push(``);
    lines.push(`| intentClass | n | correctness | confidence |`);
    lines.push(`|---|---|---|---|`);
    for (const c of card.perIntentClass.slice(0, 20)) {
      lines.push(`| ${c.intentClass} | ${c.n} | ${(c.meanCorrectness * 100).toFixed(0)}% | ${(c.meanConfidence * 100).toFixed(0)}% |`);
    }
    lines.push(``);
  }
  if (card.regression.worstIntentClass) {
    lines.push(`**Worst-hit intent class:** ${card.regression.worstIntentClass.intentClass} (Δ${(card.regression.worstIntentClass.deltaCorrectness * 100).toFixed(1)}%)`);
  }
  if (card.regression.bestIntentClass) {
    lines.push(`**Best-improved intent class:** ${card.regression.bestIntentClass.intentClass} (Δ${(card.regression.bestIntentClass.deltaCorrectness * 100).toFixed(1)}%)`);
  }
  lines.push(``);
  lines.push(`---`);
  lines.push(`HMAC: \`${card.hmac.slice(0, 16)}…\` · seq ${card.seq} · spec ${card.spec.name}/${card.spec.version}`);
  lines.push(`Verify offline: \`mneme rewind verify --file <path>\``);
  return lines.join("\n");
}
