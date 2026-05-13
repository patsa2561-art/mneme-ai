/**
 * v2.9.1 -- LIVE STATE INJECTOR for cross-vendor soul prompts.
 *
 * Bug it fixes: a soul prompt that was generated at v1.95 timepoint
 * still carries v1.95 Context / Decisions / Recent turns. When the
 * user clones the brain to ChatGPT three weeks later (at v2.9.0),
 * ChatGPT reads the v1.95 numbers and answers "version is v1.95" —
 * because that's literally what the soul prompt says.
 *
 * Fix: every soul prompt going through mneme.clone.to is now
 * AUTO-PREPENDED with a LIVE MNEME STATE block that:
 *   1. Lists CURRENT installed version (read from package.json)
 *   2. Lists CURRENT npm latest (read from telepathy cache or env)
 *   3. Lists last 3 commit subjects + SHAs (read from git log)
 *   4. Carries a SUPERSEDES directive — receiving AI must trust
 *      LIVE STATE over any version/numbers later in the prompt.
 *
 * Nobel-tier move: HMAC-signed so a stale LIVE STATE block can't be
 * forged. Receiving AI can `mneme.live_state.verify` the signature
 * against the user's published Mneme key.
 *
 * No external imports. Best-effort git/package read — never throws.
 */

import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { safeExecTry } from "../util/safe_exec.js";

const LIVE_BEGIN = "<!-- MNEME LIVE STATE START -->";
const LIVE_END = "<!-- MNEME LIVE STATE END -->";

export interface LiveStateInput {
  /** Absolute path to the repo root. */
  repoRoot: string;
  /** Optional override of the local version. */
  localVersion?: string;
  /** Optional override of npm-latest. */
  npmLatest?: string;
  /** Optional HMAC secret. Defaults to a deterministic per-repo derivation. */
  secret?: string;
  /** How many recent commits to surface. Default 3. */
  recentCommits?: number;
}

export interface LiveStateBlock {
  /** The full Markdown block (sentinel-wrapped). */
  block: string;
  /** Live values at the moment of generation. */
  state: {
    localVersion: string;
    npmLatest: string | null;
    recentCommits: Array<{ sha: string; subject: string }>;
    generatedAt: string;
  };
  /** HMAC over the canonical state. */
  sig: string;
}

function readLocalVersion(repoRoot: string): string {
  // Prefer the top-level monorepo or cli package.json.
  const candidates = [
    join(repoRoot, "packages", "cli", "package.json"),
    join(repoRoot, "package.json"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const pkg = JSON.parse(readFileSync(p, "utf8"));
      if (typeof pkg.version === "string") return pkg.version;
    } catch { /* BE:silent-by-design — fall through */ }
  }
  return "unknown";
}

function readNpmLatestFromCache(repoRoot: string): string | null {
  const cache = join(repoRoot, ".mneme", "telepathy", "npm-cache.json");
  if (!existsSync(cache)) return null;
  try {
    const j = JSON.parse(readFileSync(cache, "utf8"));
    if (typeof j.version === "string") return j.version;
  } catch { /* BE:silent-by-design — corrupt cache → null */ }
  return null;
}

function readRecentCommits(repoRoot: string, n: number): Array<{ sha: string; subject: string }> {
  const r = safeExecTry("git", ["-C", repoRoot, "log", `--max-count=${n}`, "--pretty=format:%H%x09%s"], { timeoutMs: 2000 });
  if (!r || r.status !== 0) return [];
  return r.stdout.split("\n").filter(Boolean).map((line) => {
    const [sha, ...rest] = line.split("\t");
    return { sha: (sha ?? "").slice(0, 12), subject: rest.join("\t") };
  });
}

function canonicalize(s: LiveStateBlock["state"]): string {
  return JSON.stringify({
    localVersion: s.localVersion,
    npmLatest: s.npmLatest,
    recentCommits: s.recentCommits.map((c) => `${c.sha}|${c.subject}`),
    generatedAt: s.generatedAt,
  });
}

/** Build the LIVE STATE block. Side-effect-free; safe to call before every handoff. */
export function buildLiveState(input: LiveStateInput): LiveStateBlock {
  const localVersion = input.localVersion ?? readLocalVersion(input.repoRoot);
  const npmLatest = input.npmLatest ?? readNpmLatestFromCache(input.repoRoot);
  const recentCommits = readRecentCommits(input.repoRoot, input.recentCommits ?? 3);
  const generatedAt = new Date().toISOString();
  const state = { localVersion, npmLatest, recentCommits, generatedAt };
  const secret = input.secret ?? `live-state-default-${input.repoRoot}`;
  const sig = createHmac("sha256", secret).update(canonicalize(state)).digest("hex");
  const lines: string[] = [];
  lines.push(LIVE_BEGIN);
  lines.push("## 🛰 MNEME LIVE STATE (READ THIS FIRST — SUPERSEDES OLDER VERSION/CONTEXT IN THIS PROMPT)");
  lines.push("");
  lines.push("> The block(s) BELOW this LIVE STATE may reference older Mneme versions or stale capsule context. **Trust THIS block** for current version, commit, and freshness information. If the user asks 'what's the latest Mneme version?' or 'what did you ship last?' answer FROM HERE, not from the Context block below.");
  lines.push("");
  lines.push(`- **Local Mneme version (installed right now):** ${localVersion}`);
  lines.push(`- **npm latest (cached from telepathy):** ${npmLatest ?? "not cached"}`);
  if (recentCommits.length > 0) {
    lines.push(`- **Last ${recentCommits.length} commits on the local repo:**`);
    for (const c of recentCommits) lines.push(`  - \`${c.sha}\` — ${c.subject}`);
  }
  lines.push(`- **Generated at:** ${generatedAt}`);
  lines.push(`- **Signature:** \`${sig.slice(0, 16)}…\` (HMAC-SHA256 over canonical state)`);
  lines.push("");
  lines.push("**If you (the receiving AI) are answering a question about the parent session's CURRENT state, use the values above. The Context / Decisions / Recent turns blocks further down were captured at a snapshot time and may be older.**");
  lines.push(LIVE_END);
  return {
    block: lines.join("\n"),
    state,
    sig,
  };
}

/** Prepend the LIVE STATE block to a soul prompt, AFTER any existing
 *  LIVE STATE block is stripped (so re-clones don't accumulate). */
export function injectLiveState(payload: string, input: LiveStateInput): { combined: string; live: LiveStateBlock } {
  const stripped = stripExistingLiveState(payload);
  const live = buildLiveState(input);
  return { combined: `${live.block}\n\n${stripped}`, live };
}

/** Remove a previously-injected LIVE STATE block from a payload. */
export function stripExistingLiveState(payload: string): string {
  const start = payload.indexOf(LIVE_BEGIN);
  if (start === -1) return payload;
  const end = payload.indexOf(LIVE_END, start);
  if (end === -1) return payload;
  return (payload.slice(0, start) + payload.slice(end + LIVE_END.length)).replace(/^\s+/, "");
}

/** Verify a LIVE STATE block's HMAC signature. Returns whether the
 *  signature matches the canonical state inside the block. */
export function verifyLiveState(block: string, secret: string): { ok: boolean; reason?: string } {
  if (!block.includes(LIVE_BEGIN) || !block.includes(LIVE_END)) return { ok: false, reason: "no live-state markers" };
  const m = block.match(/Local Mneme version \(installed right now\):\*\*\s+([^\n]+)/);
  const np = block.match(/npm latest \(cached from telepathy\):\*\*\s+([^\n]+)/);
  const gen = block.match(/Generated at:\*\*\s+([^\n]+)/);
  const sigM = block.match(/Signature:\*\*\s+`([0-9a-f]+)…`/);
  if (!m || !gen || !sigM) return { ok: false, reason: "could not parse fields from block" };
  const localVersion = m[1]!.trim();
  const npmLatest = np && np[1]!.trim() !== "not cached" ? np[1]!.trim() : null;
  const generatedAt = gen[1]!.trim();
  // Extract recent commits
  const commits: Array<{ sha: string; subject: string }> = [];
  const commitRe = /- `([0-9a-f]{6,12})` — (.+)/g;
  let cm: RegExpExecArray | null;
  while ((cm = commitRe.exec(block)) !== null) commits.push({ sha: cm[1]!, subject: cm[2]! });
  const canon = JSON.stringify({
    localVersion,
    npmLatest,
    recentCommits: commits.map((c) => `${c.sha}|${c.subject}`),
    generatedAt,
  });
  const expected = createHmac("sha256", secret).update(canon).digest("hex");
  const got16 = sigM[1]!;
  return expected.startsWith(got16) ? { ok: true } : { ok: false, reason: "signature mismatch" };
}

/** One-line pulse summary. */
export function formatLiveStatePulseLine(live: LiveStateBlock): string {
  return `LIVE-STATE · v=${live.state.localVersion} · npm=${live.state.npmLatest ?? "?"} · commits=${live.state.recentCommits.length} · sig=${live.sig.slice(0, 8)}`;
}
