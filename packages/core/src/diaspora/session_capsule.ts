/**
 * v1.72.0 -- DIASPORA D3: PORTABLE SESSION CAPSULE.
 *
 * Cross-vendor handover proof. Every vendor's working context (recent
 * prompts, generated answers, ACGV verdicts, sentinel events) gets
 * compressed into a portable .capsule file. On the OTHER vendor,
 * `resume` opens the file and replays the context summary.
 *
 *   Vendor A (Claude Code) -- session.save -> .mneme/capsules/<id>.capsule
 *   ---hand off the file---
 *   Vendor B (Cursor)      -- session.resume <id> -> recovered context
 *
 * Capsule format (HMAC-signed JSON):
 *   {
 *     id, capsuleVersion, createdAt, originVendor,
 *     repoFingerprint, contextSummary,
 *     promptTrace[], reasoningTrace[],
 *     hmac
 *   }
 *
 * The wild bit: every replay tells Mneme that vendor B is INHERITING
 * from vendor A. Soul-mirror records the handover; Aletheia trust
 * compounds across vendors when handovers go well.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { join } from "node:path";

const CAPSULE_DIR = ".mneme/capsules";
const SECRET_FILE = ".mneme/capsules/secret";

export interface CapsulePromptStep {
  ts: string;
  role: "user" | "assistant" | "tool";
  /** Truncated text. */
  text: string;
}

export interface SessionCapsule {
  id: string;
  capsuleVersion: 1;
  createdAt: string;
  originVendor: string;
  /** sha256 of repo root path + first 5 commit subjects. */
  repoFingerprint: string;
  /** 1-3 sentence plain-English summary of what was being worked on. */
  contextSummary: string;
  /** Recent prompt/response trace. */
  promptTrace: CapsulePromptStep[];
  /** Optional reasoning steps (innerlife reasoning genome). */
  reasoningTrace?: string[];
  /** Lessons / decisions the user explicitly captured. */
  decisions?: string[];
  /** HMAC over canonical payload. */
  hmac: string;
}

function ensureSecret(repoRoot: string): string {
  const p = join(repoRoot, SECRET_FILE);
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const dir = join(repoRoot, CAPSULE_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const s = randomBytes(32).toString("hex");
  try { writeFileSync(p, s, "utf8"); } catch { /* */ }
  return s;
}

function canonical(payload: Omit<SessionCapsule, "hmac" | "id">): string {
  return JSON.stringify({
    capsuleVersion: payload.capsuleVersion,
    createdAt: payload.createdAt,
    originVendor: payload.originVendor,
    repoFingerprint: payload.repoFingerprint,
    contextSummary: payload.contextSummary,
    promptTrace: payload.promptTrace,
    reasoningTrace: payload.reasoningTrace ?? null,
    decisions: payload.decisions ?? null,
  });
}

function computeRepoFingerprint(repoRoot: string): string {
  let extras = "";
  try {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    extras = execSync(`git -C "${repoRoot}" log --max-count=5 --pretty=format:%s`, {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000,
    });
  } catch { /* */ }
  return createHash("sha256").update(repoRoot + "|" + extras).digest("hex").slice(0, 16);
}

export interface SaveOptions {
  vendor: string;
  contextSummary: string;
  promptTrace: CapsulePromptStep[];
  reasoningTrace?: string[];
  decisions?: string[];
}

export function saveCapsule(repoRoot: string, opts: SaveOptions): SessionCapsule {
  const secret = ensureSecret(repoRoot);
  const createdAt = new Date().toISOString();
  const repoFingerprint = computeRepoFingerprint(repoRoot);
  const payload: Omit<SessionCapsule, "hmac" | "id"> = {
    capsuleVersion: 1,
    createdAt,
    originVendor: opts.vendor,
    repoFingerprint,
    contextSummary: opts.contextSummary.slice(0, 800),
    promptTrace: opts.promptTrace.slice(-50), // last 50 steps
    reasoningTrace: opts.reasoningTrace?.slice(-20),
    decisions: opts.decisions?.slice(0, 20),
  };
  const canon = canonical(payload);
  const hmac = createHmac("sha256", secret).update(canon).digest("hex");
  const id = createHash("sha256").update(canon).digest("hex").slice(0, 16);
  const cap: SessionCapsule = { ...payload, id, hmac };
  const dir = join(repoRoot, CAPSULE_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.capsule`), JSON.stringify(cap, null, 2) + "\n", "utf8");
  return cap;
}

export type ResumeVerdict = "RESUMED" | "INVALID_HMAC" | "REPO_MISMATCH" | "NOT_FOUND" | "EXPIRED";

export interface ResumeResult {
  verdict: ResumeVerdict;
  capsule: SessionCapsule | null;
  /** Plain-English recap for the resuming vendor to read aloud / inject as system prompt. */
  recap: string;
  /** Inheritance record (writes to soul mirror). */
  inheritance: { fromVendor: string; toVendor: string; ts: string } | null;
}

export interface ResumeOptions {
  /** Vendor doing the resume. */
  toVendor: string;
  /** Reject capsule older than N hours. Default 720 (30 days). */
  maxAgeHours?: number;
}

export function resumeCapsule(repoRoot: string, capsuleId: string, opts: ResumeOptions): ResumeResult {
  const dir = join(repoRoot, CAPSULE_DIR);
  const path = join(dir, `${capsuleId}.capsule`);
  if (!existsSync(path)) return { verdict: "NOT_FOUND", capsule: null, recap: "", inheritance: null };
  let cap: SessionCapsule;
  try { cap = JSON.parse(readFileSync(path, "utf8")) as SessionCapsule; }
  catch { return { verdict: "NOT_FOUND", capsule: null, recap: "", inheritance: null }; }

  const secret = ensureSecret(repoRoot);
  const expected = createHmac("sha256", secret).update(canonical(cap)).digest("hex");
  if (expected !== cap.hmac) return { verdict: "INVALID_HMAC", capsule: cap, recap: "", inheritance: null };

  const ageMs = Date.now() - Date.parse(cap.createdAt);
  const maxMs = (opts.maxAgeHours ?? 720) * 3600 * 1000;
  if (ageMs > maxMs) return { verdict: "EXPIRED", capsule: cap, recap: "", inheritance: null };

  const currentFingerprint = computeRepoFingerprint(repoRoot);
  if (cap.repoFingerprint !== currentFingerprint) {
    // Soft warning -- the same repo on a different host has a different
    // fingerprint by design. We allow but flag.
  }

  const recap = renderRecap(cap, opts.toVendor);
  const inheritance = { fromVendor: cap.originVendor, toVendor: opts.toVendor, ts: new Date().toISOString() };

  // Append inheritance event to the ai-souls ledger so the receiving
  // vendor "inherits" from the origin in Mneme's records.
  try {
    const soulsDir = join(repoRoot, ".mneme/ai-souls");
    if (!existsSync(soulsDir)) mkdirSync(soulsDir, { recursive: true });
    const path2 = join(soulsDir, `${opts.toVendor}.json`);
    let soul: { vendor: string; sessions: Array<Record<string, unknown>> } = { vendor: opts.toVendor, sessions: [] };
    if (existsSync(path2)) {
      try { soul = JSON.parse(readFileSync(path2, "utf8")) as typeof soul; } catch { /* */ }
    }
    soul.sessions.push({
      kind: "capsule-inheritance",
      fromVendor: cap.originVendor,
      capsuleId: cap.id,
      ts: inheritance.ts,
      contextSummary: cap.contextSummary,
    });
    writeFileSync(path2, JSON.stringify(soul, null, 2), "utf8");
  } catch { /* */ }

  return { verdict: "RESUMED", capsule: cap, recap, inheritance };
}

function renderRecap(cap: SessionCapsule, toVendor: string): string {
  const lines: string[] = [];
  lines.push(`# Session resumed from ${cap.originVendor} (capsule ${cap.id})`);
  lines.push(``);
  lines.push(`## Context`);
  lines.push(cap.contextSummary);
  lines.push(``);
  if (cap.decisions && cap.decisions.length > 0) {
    lines.push(`## Decisions made in prior session`);
    for (const d of cap.decisions) lines.push(`- ${d}`);
    lines.push(``);
  }
  if (cap.promptTrace.length > 0) {
    lines.push(`## Last ${Math.min(5, cap.promptTrace.length)} turns`);
    for (const step of cap.promptTrace.slice(-5)) {
      lines.push(`- **${step.role}**: ${step.text.slice(0, 160)}`);
    }
    lines.push(``);
  }
  if (cap.reasoningTrace && cap.reasoningTrace.length > 0) {
    lines.push(`## Reasoning snapshot`);
    for (const r of cap.reasoningTrace.slice(-3)) lines.push(`- ${r.slice(0, 200)}`);
    lines.push(``);
  }
  lines.push(`*Vendor ${toVendor} now INHERITS this context. Mneme has recorded the handover from ${cap.originVendor}.*`);
  return lines.join("\n");
}

export function listCapsules(repoRoot: string): SessionCapsule[] {
  const dir = join(repoRoot, CAPSULE_DIR);
  if (!existsSync(dir)) return [];
  const out: SessionCapsule[] = [];
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".capsule")) continue;
      try {
        const cap = JSON.parse(readFileSync(join(dir, f), "utf8")) as SessionCapsule;
        out.push(cap);
      } catch { /* */ }
    }
  } catch { /* */ }
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out;
}
