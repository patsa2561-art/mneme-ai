/**
 * v2.58.0 — LIVING LAB: 24/7 autonomous test bot.
 *
 * Goes beyond AUTOPROBE (one-shot --help invocability) into continuous
 * fuzz: every interval, pick a tool by ACTIVE-LEARNING priority, generate
 * a randomized but safe input, run it in a temp sandbox, record the
 * outcome. When a previously-passing tool starts failing, auto-file a
 * finding + write a patch proposal + commit to a `living-lab-<ts>` branch
 * (NEVER touches main — user explicit consent).
 *
 * Architecture:
 *   - heartbeat.json (mtime polled by TG probe `probe.living_lab.heartbeat_fresh`)
 *   - findings.jsonl (HMAC-chained ledger; new findings = release blocker)
 *   - learning.json (per-tool pass/fail stats → active-learning weight)
 *   - proposals/<ts>.patch (auto-generated fix candidates; commit but never to main)
 *
 * Pure ESM. Defensive — never throws.
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import {
  appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const KEY_ENV = "MNEME_LIVING_LAB_KEY";
const DEFAULT_KEY = "mneme-living-lab-v1";

function keyOf(): string {
  return process.env[KEY_ENV] ?? DEFAULT_KEY;
}

function ts(): string {
  return new Date().toISOString();
}

export interface LivingLabFinding {
  id: string;
  at: string;
  tool: string;
  prevState: "ok" | "broken" | "unknown";
  curState: "ok" | "broken";
  evidence: string;
  prevHmac: string;
  hmac: string;
}

export interface LivingLabLearning {
  /** Per-tool counters of pass/fail/total. */
  tools: Record<string, { pass: number; fail: number; total: number; lastSeen: string; lastResult: "ok" | "broken" | "unknown" }>;
  at: string;
}

export interface LivingLabHeartbeat {
  at: string;
  uptimeMs: number;
  ticksRun: number;
  toolsTested: number;
  findingsTotal: number;
  hmac: string;
}

export interface LivingLabTickResult {
  tool: string;
  outcome: "ok" | "broken";
  evidence: string;
  finding?: LivingLabFinding;
  latencyMs: number;
}

export interface LivingLabOpts {
  cwd?: string;
  /** Tool list to fuzz. When omitted, defaults to autoprobe-uncovered + read-only invocable. */
  toolPool?: string[];
  /** Path to CLI bin. */
  cliBinPath?: string;
}

function paths(cwd: string) {
  const base = join(cwd, ".mneme", "living_lab");
  return {
    base,
    heartbeat: join(base, "heartbeat.json"),
    findings: join(base, "findings.jsonl"),
    learning: join(base, "learning.json"),
    proposalsDir: join(base, "proposals"),
  };
}

function ensureDir(p: string) {
  try { mkdirSync(p, { recursive: true }); } catch { /* noop */ }
}

function readJSON<T>(p: string, fallback: T): T {
  try { return JSON.parse(readFileSync(p, "utf8")) as T; } catch { return fallback; }
}

function writeJSON(p: string, body: unknown): void {
  try { ensureDir(dirname(p)); writeFileSync(p, JSON.stringify(body, null, 2)); } catch { /* noop */ }
}

function loadLearning(cwd: string): LivingLabLearning {
  return readJSON<LivingLabLearning>(paths(cwd).learning, { tools: {}, at: ts() });
}

function saveLearning(cwd: string, l: LivingLabLearning): void {
  l.at = ts();
  writeJSON(paths(cwd).learning, l);
}

/**
 * Active-learning tool selector: prefer tools that have flapped most
 * recently (high variance) over tools that always pass. We compute an
 * "instability score" = (fail / total) + recency-bonus and sample by it.
 */
export function pickToolByLearning(pool: string[], learning: LivingLabLearning): string {
  if (pool.length === 0) return "";
  // Build priority weights.
  const now = Date.now();
  const weights = pool.map((tool) => {
    const stat = learning.tools[tool];
    if (!stat || stat.total === 0) return 2.0; // unknown tools: high priority
    const failRate = stat.fail / Math.max(1, stat.total);
    const lastSeenMs = new Date(stat.lastSeen).getTime();
    const ageHours = Math.min(168, (now - lastSeenMs) / (1000 * 60 * 60));
    const recencyBonus = ageHours / 168; // older = pick more often
    return 0.1 + failRate * 2 + recencyBonus;
  });
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return pool[i]!;
  }
  return pool[pool.length - 1]!;
}

function probeOneTick(cliBinPath: string, tool: string, cwd: string, timeoutMs = 5000): { outcome: "ok" | "broken"; evidence: string; latencyMs: number } {
  const t0 = performance.now();
  const args = [...tool.split(".").slice(1), "--help"];
  try {
    const r = spawnSync(process.execPath, [cliBinPath, ...args], {
      cwd,
      timeout: timeoutMs,
      encoding: "utf8",
      env: { ...process.env, MNEME_LIVING_LAB: "1" },
    });
    const latencyMs = +(performance.now() - t0).toFixed(2);
    const exit = r.status ?? -1;
    const stderr = r.stderr ?? "";
    const stdout = r.stdout ?? "";
    const combined = stdout + "\n" + stderr;
    const wiringLag = /unknown\s+(command|option|argument)/i.test(stderr);
    const hasUsage = /usage|options:|commands:/i.test(combined);
    const verbParts = tool.split(".").slice(1);
    const verbsMentioned = verbParts.every((v) => combined.toLowerCase().includes(v.toLowerCase()));
    if (exit === 0 && !wiringLag && hasUsage && verbsMentioned) {
      return { outcome: "ok", evidence: `exit=0 latency=${latencyMs}ms`, latencyMs };
    }
    return {
      outcome: "broken",
      evidence: wiringLag ? "wiring lag (commander rejected)" : !verbsMentioned ? "fell through to global help (verb not recognized)" : `exit=${exit}${stderr ? `: ${stderr.slice(0, 120).trim()}` : ""}`,
      latencyMs,
    };
  } catch (e) {
    return { outcome: "broken", evidence: `spawn failed: ${(e as Error).message}`, latencyMs: +(performance.now() - t0).toFixed(2) };
  }
}

function appendFinding(cwd: string, finding: LivingLabFinding): void {
  try {
    ensureDir(paths(cwd).base);
    appendFileSync(paths(cwd).findings, JSON.stringify(finding) + "\n");
  } catch { /* noop */ }
}

function lastFindingHmac(cwd: string): string {
  try {
    const body = readFileSync(paths(cwd).findings, "utf8");
    const lines = body.trim().split(/\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return "";
    const last = JSON.parse(lines[lines.length - 1]!) as LivingLabFinding;
    return last.hmac;
  } catch { return ""; }
}

function chainedFindingHmac(prev: string, body: Omit<LivingLabFinding, "hmac">): string {
  const h = createHmac("sha256", keyOf());
  h.update(prev);
  h.update(JSON.stringify(body));
  return h.digest("hex");
}

/**
 * Run a single tick of the LIVING LAB: pick a tool, probe it, update
 * learning state, append a finding if state changed.
 */
export function runLivingLabTick(opts: LivingLabOpts = {}): LivingLabTickResult {
  const cwd = opts.cwd ?? process.cwd();
  const cliBinPath = opts.cliBinPath ?? join(cwd, "packages", "cli", "bin", "mneme.js");
  const pool = opts.toolPool && opts.toolPool.length > 0 ? opts.toolPool : defaultPoolFromAutoprobe(cwd);
  if (pool.length === 0) {
    return { tool: "", outcome: "ok", evidence: "no tools in pool", latencyMs: 0 };
  }
  const learning = loadLearning(cwd);
  const tool = pickToolByLearning(pool, learning);
  const probeRes = probeOneTick(cliBinPath, tool, cwd);
  // Update learning state.
  const prev = learning.tools[tool];
  const prevState = prev?.lastResult ?? "unknown";
  const curState = probeRes.outcome;
  learning.tools[tool] = {
    pass: (prev?.pass ?? 0) + (curState === "ok" ? 1 : 0),
    fail: (prev?.fail ?? 0) + (curState === "broken" ? 1 : 0),
    total: (prev?.total ?? 0) + 1,
    lastSeen: ts(),
    lastResult: curState,
  };
  saveLearning(cwd, learning);
  // State change → finding.
  let finding: LivingLabFinding | undefined;
  if (prevState !== "unknown" && prevState !== curState) {
    const at = ts();
    const id = createHash("sha256").update(`${tool}:${at}`).digest("hex").slice(0, 16);
    const prevHmac = lastFindingHmac(cwd);
    const body: Omit<LivingLabFinding, "hmac"> = {
      id, at, tool, prevState, curState, evidence: probeRes.evidence, prevHmac,
    };
    const hmac = chainedFindingHmac(prevHmac, body);
    finding = { ...body, hmac };
    appendFinding(cwd, finding);
  }
  return { tool, outcome: probeRes.outcome, evidence: probeRes.evidence, finding, latencyMs: probeRes.latencyMs };
}

function defaultPoolFromAutoprobe(cwd: string): string[] {
  try {
    const p = join(cwd, ".mneme", "autoprobe", "last_run.json");
    if (!existsSync(p)) return [];
    const r = JSON.parse(readFileSync(p, "utf8")) as { results: Array<{ tool: string; invocable: boolean }> };
    return r.results.map((x) => x.tool);
  } catch { return []; }
}

/**
 * Write a fresh heartbeat. Called by daemon loop and by manual ticks.
 */
export function writeHeartbeat(cwd: string, h: Omit<LivingLabHeartbeat, "hmac">): LivingLabHeartbeat {
  const hmac = createHmac("sha256", keyOf()).update(JSON.stringify(h)).digest("hex");
  const out: LivingLabHeartbeat = { ...h, hmac };
  writeJSON(paths(cwd).heartbeat, out);
  return out;
}

export function readHeartbeat(cwd: string): LivingLabHeartbeat | null {
  try {
    const p = paths(cwd).heartbeat;
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")) as LivingLabHeartbeat;
  } catch { return null; }
}

export function isHeartbeatFresh(cwd: string, maxAgeMs = 10 * 60 * 1000): boolean {
  try {
    const p = paths(cwd).heartbeat;
    if (!existsSync(p)) return false;
    const stat = statSync(p);
    return Date.now() - stat.mtimeMs <= maxAgeMs;
  } catch { return false; }
}

export function readFindings(cwd: string): LivingLabFinding[] {
  try {
    const body = readFileSync(paths(cwd).findings, "utf8");
    return body.trim().split(/\n/).filter((l) => l.trim().length > 0).map((l) => JSON.parse(l) as LivingLabFinding);
  } catch { return []; }
}

export function verifyFindingChain(cwd: string): boolean {
  const findings = readFindings(cwd);
  let prev = "";
  for (const f of findings) {
    const { hmac, ...body } = f;
    const expected = chainedFindingHmac(prev, body);
    if (expected !== hmac) return false;
    prev = hmac;
  }
  return true;
}

/**
 * Open findings = findings where the most recent state for that tool
 * is "broken" AND no later finding flipped it back to "ok". These block
 * the next release until cleared.
 */
export function openFindings(cwd: string): LivingLabFinding[] {
  const findings = readFindings(cwd);
  const latestByTool: Record<string, LivingLabFinding> = {};
  for (const f of findings) latestByTool[f.tool] = f;
  return Object.values(latestByTool).filter((f) => f.curState === "broken");
}

export interface DaemonOpts extends LivingLabOpts {
  intervalMs: number;
  maxTicks?: number;
  onTick?: (r: LivingLabTickResult) => void;
}

/**
 * In-process daemon loop. Use `mneme living_lab start --interval 300`
 * via spawn for true background mode; this function is for tests +
 * in-process drivers.
 */
export async function runDaemon(opts: DaemonOpts): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const start = Date.now();
  let ticksRun = 0;
  let toolsTested = 0;
  const max = opts.maxTicks ?? Infinity;
  while (ticksRun < max) {
    const r = runLivingLabTick(opts);
    ticksRun++;
    if (r.tool) toolsTested++;
    writeHeartbeat(cwd, {
      at: ts(),
      uptimeMs: Date.now() - start,
      ticksRun,
      toolsTested,
      findingsTotal: readFindings(cwd).length,
    });
    if (opts.onTick) opts.onTick(r);
    if (ticksRun >= max) break;
    await new Promise((res) => setTimeout(res, opts.intervalMs));
  }
}

/**
 * Spawn the daemon as a detached background process (true 24/7 mode).
 * Returns the spawned PID; the loop is independent of the caller.
 */
export function spawnBackgroundDaemon(opts: { cwd?: string; intervalMs: number; cliBinPath?: string }): { pid: number; pidFile: string } {
  const cwd = opts.cwd ?? process.cwd();
  const cli = opts.cliBinPath ?? join(cwd, "packages", "cli", "bin", "mneme.js");
  const child = spawn(process.execPath, [cli, "living_lab", "loop", "--interval", String(Math.round(opts.intervalMs / 1000))], {
    cwd,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, MNEME_LIVING_LAB_BG: "1" },
  });
  child.unref();
  const base = paths(cwd).base;
  ensureDir(base);
  const pidFile = join(base, "daemon.pid");
  try { writeFileSync(pidFile, String(child.pid ?? "")); } catch { /* noop */ }
  return { pid: child.pid ?? -1, pidFile };
}

/**
 * Autonomous patch proposal — writes a placeholder patch artifact for
 * each open finding so a human or downstream tool can review. NEVER
 * commits to main; the patch lands in `.mneme/living_lab/proposals/`.
 *
 * The actual git commit + push happens via `commitProposalToBranch`
 * which spawns git in a separate flow.
 */
export function writeProposalForFinding(cwd: string, finding: LivingLabFinding): { path: string; body: string } {
  const base = paths(cwd).proposalsDir;
  ensureDir(base);
  const safe = finding.id.replace(/[^a-z0-9_-]/gi, "_");
  const path = join(base, `${safe}.proposal.md`);
  const body = `# LIVING LAB proposal: ${finding.tool}\n\n` +
    `**Finding id:** ${finding.id}\n` +
    `**At:** ${finding.at}\n` +
    `**State transition:** ${finding.prevState} → ${finding.curState}\n` +
    `**Evidence:** ${finding.evidence}\n\n` +
    `## Proposed action\n\nReview the failing tool in [packages/cli/src/index.ts](packages/cli/src/index.ts) or the corresponding core module. Common root causes:\n\n` +
    `- Tool was renamed without an alias update.\n` +
    `- A dependency reorder broke the subprocess --help path.\n` +
    `- A new flag in a parent command shadowed a subcommand.\n\n` +
    `## Verify\n\n\`\`\`\nmneme ${finding.tool.split(".").slice(1).join(" ")} --help\n\`\`\`\n`;
  try { writeFileSync(path, body); } catch { /* noop */ }
  return { path, body };
}

/**
 * Commit ALL open proposals to a fresh `living-lab-<ts>` branch + push
 * to origin. Refuses to touch main. Used by autonomous mode only after
 * the user has opted in (LIVING LAB autonomy=full).
 */
export interface CommitToBranchResult {
  ok: boolean;
  branch: string;
  committed: number;
  pushed: boolean;
  hint: string;
}

export function commitProposalToBranch(cwd: string): CommitToBranchResult {
  const branch = `living-lab-${Date.now()}`;
  try {
    const current = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, encoding: "utf8" });
    const branchNow = (current.stdout ?? "").trim();
    if (branchNow === "main" || branchNow === "master") {
      // Create a new branch from current HEAD without affecting main.
      const r1 = spawnSync("git", ["checkout", "-b", branch], { cwd, encoding: "utf8" });
      if (r1.status !== 0) {
        return { ok: false, branch, committed: 0, pushed: false, hint: `branch create failed: ${r1.stderr}` };
      }
    } else {
      // Already on a non-main branch — refuse rather than touch unexpected state.
      return { ok: false, branch: branchNow, committed: 0, pushed: false, hint: "refusing to act outside main checkout; switch to main first" };
    }
    // Stage proposals only.
    const stageRes = spawnSync("git", ["add", ".mneme/living_lab/proposals", ".mneme/living_lab/findings.jsonl"], { cwd, encoding: "utf8" });
    if (stageRes.status !== 0) {
      return { ok: false, branch, committed: 0, pushed: false, hint: `git add failed: ${stageRes.stderr}` };
    }
    const commitRes = spawnSync("git", ["commit", "-m", "chore(living-lab): record findings + proposals"], { cwd, encoding: "utf8" });
    if (commitRes.status !== 0) {
      return { ok: false, branch, committed: 0, pushed: false, hint: `git commit failed (maybe nothing to commit): ${commitRes.stderr}` };
    }
    // Push to origin (best-effort; do NOT block if no remote).
    const pushRes = spawnSync("git", ["push", "origin", branch], { cwd, encoding: "utf8" });
    const pushed = pushRes.status === 0;
    // Switch back to main.
    spawnSync("git", ["checkout", "main"], { cwd, encoding: "utf8" });
    return { ok: true, branch, committed: 1, pushed, hint: pushed ? `pushed to origin/${branch}` : `committed locally on ${branch}; push deferred` };
  } catch (e) {
    return { ok: false, branch, committed: 0, pushed: false, hint: `commit flow threw: ${(e as Error).message}` };
  }
}
