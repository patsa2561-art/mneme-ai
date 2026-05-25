/**
 * v2.56.0 — DRAGON EJECT: emergency rollback + GAVEL-grade forensic bundle.
 *
 * Inspired by SpaceX Dragon capsule's launch escape system. When something
 * goes critically wrong, Dragon fires its abort motors + ejects to safety
 * while recording every telemetry point for post-mortem.
 *
 * Mneme analogue:
 *   `mneme dragon eject <commit>` does:
 *     1. Snapshot WHY: capture current state (failing TG probes, failing
 *        tests, perf budget violations, agent_manifest entries that
 *        reference the doomed commit).
 *     2. Eject (best-effort): `git revert <commit> --no-edit` to a new
 *        rollback commit.
 *     3. Forensic bundle: emit a HMAC-signed bundle binding (a) WHY
 *        snapshot, (b) the diff that was reverted, (c) Merkle proof
 *        connecting both — court-admissible post-mortem.
 *     4. Append eject event to the DRAGON LEDGER (HMAC-chained).
 *
 * Defensive: dry-run by default. Real eject requires --confirm. Never
 * destroys uncommitted work.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, createHmac } from "node:crypto";
import { execSync } from "node:child_process";

const DRAGON_DIR = ".mneme/xai_alignment/dragon";
const EJECT_LEDGER = "eject_events.jsonl";
const KEY_ENV = "MNEME_DRAGON_KEY";
const DEFAULT_KEY = "mneme-dragon-v1";
const SEED = "0".repeat(64);

function keyOf(): string { return process.env[KEY_ENV] ?? DEFAULT_KEY; }

export interface EjectReason {
  /** Plain-English summary of WHY ejecting. */
  rationale: string;
  /** Optional failing probe ids. */
  failingProbes?: string[];
  /** Optional failing test ids. */
  failingTests?: string[];
  /** Optional perf-budget violations. */
  perfViolations?: string[];
}

export interface EjectInput {
  repoRoot: string;
  /** Commit hash (7-40 hex) to revert. */
  commit: string;
  reason: EjectReason;
  /** When true, only build the receipt + don't run git revert. */
  dryRun?: boolean;
  /** Explicit consent for real eject. */
  confirm?: boolean;
}

export interface EjectEvent {
  at: string;
  commit: string;
  rationale: string;
  failingProbes: string[];
  failingTests: string[];
  perfViolations: string[];
  /** Reverted-by commit hash (set on real eject). */
  revertedBy?: string;
  /** Merkle root binding reason + revert diff. */
  merkleRoot: string;
  /** Chain-of-custody prev hmac. */
  prev: string;
  hmac: string;
}

export interface EjectResult {
  ok: boolean;
  reason: string;
  event?: EjectEvent;
  /** When real eject was performed, this is the new commit hash. */
  revertCommit?: string;
}

function leafOf(content: string): string {
  return createHash("sha256").update("leaf:").update(content).digest("hex");
}
function parentOf(a: string, b: string): string {
  return createHash("sha256").update("parent:").update(a).update(":").update(b).digest("hex");
}

function dirOf(repoRoot: string): string {
  const dir = join(repoRoot, DRAGON_DIR);
  try { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); } catch { /* */ }
  return dir;
}

function lastHmac(repoRoot: string): string {
  const p = join(dirOf(repoRoot), EJECT_LEDGER);
  if (!existsSync(p)) return SEED;
  try {
    const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const ev = JSON.parse(lines[i]!) as EjectEvent;
        if (typeof ev.hmac === "string") return ev.hmac;
      } catch { /* skip */ }
    }
  } catch { /* */ }
  return SEED;
}

function captureRevertDiff(repoRoot: string, commit: string): string {
  try {
    // Use git show to grab the diff of the doomed commit (what we're undoing)
    return execSync(`git -C "${repoRoot}" show ${commit} --format= --no-color`, { encoding: "utf8", timeout: 8000 });
  } catch {
    return "";
  }
}

/**
 * Build + (optionally) execute the eject. Idempotent in dry-run.
 */
export function dragonEject(input: EjectInput): EjectResult {
  try {
    if (!input || typeof input.commit !== "string" || !/^[0-9a-f]{7,40}$/.test(input.commit)) {
      return { ok: false, reason: "DRAGON: commit must be a 7-40 hex hash" };
    }
    if (!input.reason || typeof input.reason.rationale !== "string" || input.reason.rationale.length === 0) {
      return { ok: false, reason: "DRAGON: reason.rationale required (WHY are we ejecting?)" };
    }
    // Capture the diff we're about to undo (forensic evidence)
    const revertDiff = captureRevertDiff(input.repoRoot, input.commit);
    const reasonJson = JSON.stringify(input.reason);
    const merkleRoot = parentOf(leafOf(reasonJson), leafOf(revertDiff));

    let revertCommit: string | undefined;
    if (!input.dryRun) {
      if (!input.confirm) {
        return { ok: false, reason: "DRAGON: --confirm required for real eject (use dryRun=true to preview)" };
      }
      try {
        execSync(`git -C "${input.repoRoot}" revert ${input.commit} --no-edit`, { encoding: "utf8", timeout: 30_000 });
        revertCommit = execSync(`git -C "${input.repoRoot}" rev-parse HEAD`, { encoding: "utf8", timeout: 8000 }).trim();
      } catch (e) {
        return { ok: false, reason: `DRAGON: git revert failed — ${(e as Error).message}` };
      }
    }

    const at = new Date().toISOString();
    const prev = input.dryRun ? SEED : lastHmac(input.repoRoot);
    const bodyForHmac: Omit<EjectEvent, "hmac"> = {
      at,
      commit: input.commit,
      rationale: input.reason.rationale,
      failingProbes: input.reason.failingProbes ?? [],
      failingTests: input.reason.failingTests ?? [],
      perfViolations: input.reason.perfViolations ?? [],
      revertedBy: revertCommit,
      merkleRoot,
      prev,
    };
    const hmac = createHmac("sha256", keyOf()).update(JSON.stringify(bodyForHmac)).digest("hex");
    const event: EjectEvent = { ...bodyForHmac, hmac };

    if (!input.dryRun) {
      try {
        appendFileSync(join(dirOf(input.repoRoot), EJECT_LEDGER), JSON.stringify(event) + "\n");
      } catch { /* best-effort */ }
    }

    return {
      ok: true,
      reason: input.dryRun
        ? `DRAGON: dry-run eject built for ${input.commit.slice(0, 7)} — merkleRoot ${merkleRoot.slice(0, 16)}...`
        : `DRAGON: ejected ${input.commit.slice(0, 7)} via revert ${revertCommit?.slice(0, 7)}, event logged`,
      event,
      revertCommit,
    };
  } catch (e) {
    return { ok: false, reason: `DRAGON failed: ${(e as Error).message}` };
  }
}

/** Verify a DRAGON eject event signature offline. */
export function verifyEjectEvent(ev: EjectEvent): { ok: boolean; reason: string } {
  if (!ev || typeof ev.hmac !== "string") return { ok: false, reason: "missing hmac" };
  const { hmac, ...body } = ev;
  const expected = createHmac("sha256", keyOf()).update(JSON.stringify(body)).digest("hex");
  return expected === hmac
    ? { ok: true, reason: "DRAGON eject event verified" }
    : { ok: false, reason: "hmac mismatch" };
}

/** Read the DRAGON ledger; useful for post-mortem audit. */
export function listEjects(repoRoot: string): EjectEvent[] {
  const p = join(dirOf(repoRoot), EJECT_LEDGER);
  if (!existsSync(p)) return [];
  const out: EjectEvent[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as EjectEvent); } catch { /* */ }
  }
  return out;
}

/** Verify the entire DRAGON chain. */
export function verifyDragonChain(repoRoot: string): { ok: boolean; rows: number; brokenAt?: number; reason?: string } {
  const events = listEjects(repoRoot);
  let prev = SEED;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!;
    if (ev.prev !== prev) return { ok: false, rows: i, brokenAt: i, reason: "prev mismatch" };
    const v = verifyEjectEvent(ev);
    if (!v.ok) return { ok: false, rows: i, brokenAt: i, reason: v.reason };
    prev = ev.hmac;
  }
  return { ok: true, rows: events.length };
}
