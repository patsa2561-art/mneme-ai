/**
 * v1.46.0 (#8 fix) — AI HANDSHAKE PROTOCOL.
 *
 * THE FRIEND-WITH-AI PROBLEM (testers' verdict: "Mneme is half-friend"):
 *   - Soul Mirror reads `.mneme/ai-souls/<vendor>.json`
 *   - Soul gets bumped by MCP tool calls (recordObservation in MCP index.ts)
 *   - When AI uses CLI commands (every `mneme ...` invocation an agent runs),
 *     Soul never bumps -- AI is invisible to Mneme.
 *   - Symptom: Soul Mirror = "0 sessions for claude-opus-4-7" even
 *     though Claude has been busy in the repo for hours.
 *
 * THE FIX -- AI HANDSHAKE:
 *   1. AI explicitly declares itself once per session via
 *        `mneme greet --vendor <id> [--model <name>] [--session <hash>]`
 *      The greet writes a per-session record under `.mneme/ai-handshakes/`,
 *      bumps the soul's lifetimeSessions, and refreshes the per-session
 *      "active vendor" hint at `.mneme/active-vendor.json`.
 *   2. Every CLI invocation (in Mneme's CLI bootstrap) records a CLI
 *      activity tick against the active vendor -- so even if AI never
 *      touches MCP, soul.lifetimeSessions stays accurate.
 *   3. New auto-detect heuristics infer the vendor when greet wasn't
 *      called (parent-process sniffing, env vars set by CC / Cursor /
 *      Codex / Continue / Aider / Gemini CLI).
 *
 * SECURITY:
 *   - Vendor field is self-declared -- not a credential. We don't trust
 *     it for authorization, we use it for telemetry / soul tracking only.
 *   - Greet rate-limited to 1 per (vendor, hour) so a runaway loop
 *     doesn't inflate session counts.
 *   - Activity ticks coalesce into per-day buckets to keep the on-disk
 *     state tiny.
 *
 * CONSEQUENCE:
 *   `mneme soul show` will reflect EVERY AI session -- MCP-only,
 *   CLI-only, or mixed. Mneme + AI become real friends.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync, statSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

import { readSoul, startSession } from "./ai_soul.js";
import { deposit as depositPheromone } from "./ai_pheromone.js";

const HANDSHAKE_DIR = ".mneme/ai-handshakes";
const ACTIVE_VENDOR_FILE = ".mneme/active-vendor.json";
const CLI_ACTIVITY_FILE = ".mneme/cli-activity.jsonl";

const GREET_RATE_LIMIT_MS = 60 * 60 * 1000;   // 1 hour
const ACTIVITY_BUCKET_SIZE_MS = 24 * 60 * 60 * 1000; // 1 day

export interface ActiveVendor {
  vendor: string;
  model?: string;
  session?: string;
  greetedAt: string;
  expiresAt: string;       // ISO -- 24h after greet (or another greet replaces)
  source: "greet" | "auto-detect";
}

export interface CliActivityTick {
  at: string;
  vendor: string;
  command: string;        // e.g., "ask", "audit", "teeth.bounty.scan"
}

export interface GreetResult {
  outcome: "greeted" | "rate-limited" | "renewed";
  active: ActiveVendor;
  soul: {
    vendor: string;
    lifetimeSessions: number;
    bornAt: string;
  };
}

/** Detect the AI vendor from environment variables / parent process /
 *  agent-config sentinels in the repo. Returns null if no clue. */
export function autoDetectVendor(repoRoot: string): { vendor: string; reason: string } | null {
  // 1) Explicit env var (preferred — agents set it themselves)
  const explicit = process.env["MNEME_AI_VENDOR"];
  if (explicit && /^[a-z0-9._-]{1,64}$/i.test(explicit)) {
    return { vendor: explicit, reason: "MNEME_AI_VENDOR env var" };
  }
  // 2) Anthropic / Claude Code env signals
  if (process.env["ANTHROPIC_API_KEY"] || process.env["CLAUDE_CODE_SESSION"]) {
    return { vendor: "claude-opus-4-7", reason: "Anthropic env signal" };
  }
  // 3) OpenAI / Codex env signals
  if (process.env["OPENAI_API_KEY"]) {
    return { vendor: "openai-gpt", reason: "OPENAI_API_KEY env" };
  }
  // 4) Cursor / Continue env signals
  if (process.env["CURSOR_TRACE_ID"] || process.env["CURSOR_AGENT"]) {
    return { vendor: "cursor", reason: "Cursor env signal" };
  }
  if (process.env["CONTINUE_DEV"]) return { vendor: "continue", reason: "Continue env signal" };
  // 5) Gemini CLI signal
  if (process.env["GEMINI_API_KEY"] || process.env["GOOGLE_API_KEY"]) {
    return { vendor: "google-gemini", reason: "GEMINI/GOOGLE_API_KEY env" };
  }
  // 5b) Ollama (local LLM runner — used directly OR as a backend for
  //      Continue / Cline / Aider). User explicitly asked: this MUST work
  //      so the demon rampages for self-hosted setups too.
  if (process.env["OLLAMA_HOST"] || process.env["OLLAMA_MODELS"]) {
    return { vendor: "ollama", reason: "OLLAMA_HOST/OLLAMA_MODELS env" };
  }
  // 5c) Aider (uses LITELLM_* / AIDER_* prefixes when running)
  if (process.env["AIDER_MODEL"] || process.env["AIDER_API_KEY"]) {
    return { vendor: "aider", reason: "AIDER_* env signal" };
  }
  // 5d) xAI / Grok
  if (process.env["XAI_API_KEY"] || process.env["GROK_API_KEY"]) {
    return { vendor: "xai-grok", reason: "XAI/GROK_API_KEY env" };
  }
  // 5e) Mistral
  if (process.env["MISTRAL_API_KEY"]) return { vendor: "mistral", reason: "MISTRAL_API_KEY env" };
  // 5f) DeepSeek
  if (process.env["DEEPSEEK_API_KEY"]) return { vendor: "deepseek", reason: "DEEPSEEK_API_KEY env" };
  // 5g) Cline (a popular Claude/Anthropic-based agent in VS Code)
  if (process.env["CLINE_AGENT"] || process.env["CLINE_TASK_ID"]) {
    return { vendor: "cline", reason: "CLINE_* env signal" };
  }
  // 6) Repo-config sentinel — e.g. CLAUDE.md present + nothing else → likely Claude
  if (existsSync(join(repoRoot, "CLAUDE.md"))) {
    return { vendor: "claude-opus-4-7", reason: "CLAUDE.md present in repo" };
  }
  if (existsSync(join(repoRoot, ".cursorrules"))) {
    return { vendor: "cursor", reason: ".cursorrules present in repo" };
  }
  if (existsSync(join(repoRoot, "GEMINI.md"))) {
    return { vendor: "google-gemini", reason: "GEMINI.md present in repo" };
  }
  if (existsSync(join(repoRoot, ".aider.conf.yml"))) {
    return { vendor: "aider", reason: ".aider.conf.yml present in repo" };
  }
  if (existsSync(join(repoRoot, ".continue/config.json"))) {
    return { vendor: "continue", reason: ".continue/config.json present in repo" };
  }
  if (existsSync(join(repoRoot, "AGENTS.md"))) {
    return { vendor: "openai-gpt", reason: "AGENTS.md (Codex convention) present" };
  }
  return null;
}

function ensureDirs(repoRoot: string): void {
  mkdirSync(join(repoRoot, HANDSHAKE_DIR), { recursive: true });
}

function activeVendorPath(repoRoot: string): string { return join(repoRoot, ACTIVE_VENDOR_FILE); }

export function readActiveVendor(repoRoot: string): ActiveVendor | null {
  const p = activeVendorPath(repoRoot);
  if (!existsSync(p)) return null;
  try {
    const v = JSON.parse(readFileSync(p, "utf8")) as ActiveVendor;
    if (Date.parse(v.expiresAt) < Date.now()) return null;
    return v;
  } catch { return null; }
}

function writeActiveVendor(repoRoot: string, v: ActiveVendor): void {
  ensureDirs(repoRoot);
  writeFileSync(activeVendorPath(repoRoot), JSON.stringify(v, null, 2));
}

function recentGreetForVendor(repoRoot: string, vendor: string): { at: number; sessionId: string } | null {
  const dir = join(repoRoot, HANDSHAKE_DIR);
  if (!existsSync(dir)) return null;
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    let best: { at: number; sessionId: string } | null = null;
    for (const f of files) {
      try {
        const r = JSON.parse(readFileSync(join(dir, f), "utf8")) as { vendor: string; greetedAt: string; session?: string };
        if (r.vendor !== vendor) continue;
        const t = Date.parse(r.greetedAt);
        if (!best || t > best.at) best = { at: t, sessionId: r.session ?? f.replace(/\.json$/, "") };
      } catch { /* BE:silent-by-design  skip  */ }
    }
    return best;
  } catch { return null; }
}

/**
 * The handshake. AI calls this once per session to identify itself.
 * Bumps soul.lifetimeSessions when not rate-limited.
 */
export function greet(repoRoot: string, opts: { vendor: string; model?: string; session?: string }): GreetResult {
  const root = resolve(repoRoot);
  const vendor = opts.vendor.trim().toLowerCase();
  if (!/^[a-z0-9._-]{1,64}$/.test(vendor)) {
    throw new Error(`invalid vendor slug: ${opts.vendor} (expected [a-z0-9._-]{1,64})`);
  }
  ensureDirs(root);

  const now = Date.now();
  const recent = recentGreetForVendor(root, vendor);
  const rateLimited = recent !== null && (now - recent.at) < GREET_RATE_LIMIT_MS;
  const sessionId = opts.session ?? createHash("sha256").update(`${vendor}|${now}|${process.pid}`).digest("hex").slice(0, 16);
  const greetedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + 24 * 60 * 60 * 1000).toISOString();

  const active: ActiveVendor = {
    vendor,
    ...(opts.model ? { model: opts.model } : {}),
    session: rateLimited && recent ? recent.sessionId : sessionId,
    greetedAt,
    expiresAt,
    source: "greet",
  };
  writeActiveVendor(root, active);

  // Persist a handshake receipt
  const handshakeFile = join(root, HANDSHAKE_DIR, `${greetedAt.replace(/[:.]/g, "-")}_${vendor}_${active.session!.slice(0, 8)}.json`);
  writeFileSync(handshakeFile, JSON.stringify({ vendor, model: opts.model, session: active.session, greetedAt, pid: process.pid }, null, 2));

  // Bump the soul -- but only when not rate-limited (otherwise spam inflates sessions).
  let lifetimeSessions = 0;
  let bornAt = greetedAt;
  try {
    if (rateLimited) {
      const s = readSoul(root, vendor);
      lifetimeSessions = s.lifetimeSessions;
      bornAt = s.bornAt;
    } else {
      const updated = startSession(root, vendor);
      lifetimeSessions = updated.lifetimeSessions;
      bornAt = updated.bornAt;
    }
  } catch { /* BE:silent-by-design -  Soul module not loadable -- continue, the handshake itself is still recorded. */ }

  return {
    outcome: rateLimited ? "rate-limited" : "greeted",
    active,
    soul: { vendor, lifetimeSessions, bornAt },
  };
}

/**
 * Record one CLI activity tick. Called from the CLI bootstrap on every
 * invocation. Coalesces into per-day buckets so the file stays small.
 */
export function recordCliActivity(repoRoot: string, command: string, vendorHint?: string): void {
  try {
    const root = resolve(repoRoot);
    const active = readActiveVendor(root);
    let vendor = vendorHint ?? active?.vendor ?? null;
    if (!vendor) {
      const detected = autoDetectVendor(root);
      if (detected) vendor = detected.vendor;
    }
    if (!vendor) return;  // unknown — never write a misleading record

    // De-dupe: at most one entry per (vendor, command, day-bucket)
    const path = join(root, CLI_ACTIVITY_FILE);
    const dayKey = Math.floor(Date.now() / ACTIVITY_BUCKET_SIZE_MS);
    let alreadyToday = false;
    if (existsSync(path)) {
      try {
        const txt = readFileSync(path, "utf8");
        const lines = txt.split("\n").filter((l) => l.trim());
        for (const line of lines.slice(-200)) {  // only scan the recent tail
          try {
            const e = JSON.parse(line) as CliActivityTick & { day?: number };
            if (e.vendor === vendor && e.command === command && e.day === dayKey) {
              alreadyToday = true;
              break;
            }
          } catch { /* BE:silent-by-design  skip malformed  */ }
        }
      } catch { /* BE:silent-by-design  fall through  */ }
    }
    if (alreadyToday) return;

    mkdirSync(join(root, ".mneme"), { recursive: true });
    appendFileSync(path, JSON.stringify({ at: new Date().toISOString(), vendor, command, day: dayKey }) + "\n");
    // v1.46.0 (#14 fix) -- mirror the activity into the pheromone trail
    // so trails capture CLI usage too, not just MCP. Best-effort.
    try { depositPheromone(root, vendor, `cli:${command}`, 1); } catch { /* BE:silent-by-design   */ }
  } catch {
    // CLI activity tracking is best-effort. A failure here MUST NOT
    // block the actual CLI command -- the user's request comes first.
  }
}

/** List recorded handshakes for a vendor (most recent first). */
export function listHandshakes(repoRoot: string, vendor?: string): { vendor: string; greetedAt: string; session: string; pid?: number; model?: string }[] {
  const dir = join(resolve(repoRoot), HANDSHAKE_DIR);
  if (!existsSync(dir)) return [];
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    const out: { vendor: string; greetedAt: string; session: string; pid?: number; model?: string }[] = [];
    for (const f of files) {
      try {
        const r = JSON.parse(readFileSync(join(dir, f), "utf8"));
        if (vendor && r.vendor !== vendor) continue;
        out.push(r);
      } catch { /* BE:silent-by-design  skip  */ }
    }
    out.sort((a, b) => (a.greetedAt < b.greetedAt ? 1 : -1));
    return out;
  } catch { return []; }
}

/** List recent CLI activity (for diagnostics + soul-render). */
export function listCliActivity(repoRoot: string, opts: { vendor?: string; sinceMs?: number } = {}): CliActivityTick[] {
  const path = join(resolve(repoRoot), CLI_ACTIVITY_FILE);
  if (!existsSync(path)) return [];
  const sinceMs = opts.sinceMs ?? 0;
  const out: CliActivityTick[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as CliActivityTick;
      if (opts.vendor && e.vendor !== opts.vendor) continue;
      if (Date.parse(e.at) < sinceMs) continue;
      out.push(e);
    } catch { /* BE:silent-by-design  skip  */ }
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** Best-effort age check for stale handshakes (>30 days). */
export function pruneOldHandshakes(repoRoot: string, maxAgeDays = 30): { pruned: number } {
  const dir = join(resolve(repoRoot), HANDSHAKE_DIR);
  if (!existsSync(dir)) return { pruned: 0 };
  let pruned = 0;
  try {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    for (const f of readdirSync(dir)) {
      const full = join(dir, f);
      try {
        if (statSync(full).mtimeMs < cutoff) { unlinkSync(full); pruned++; }
      } catch { /* BE:silent-by-design  skip  */ }
    }
  } catch { /* BE:silent-by-design   */ }
  return { pruned };
}
