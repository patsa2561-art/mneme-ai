/**
 * ALETHEIA — open MCP security framework, reference impl in Mneme.
 * (Greek ἀλήθεια — "the state of not being hidden, disclosure, truth".
 * Pairs with Mneme/Memory: Memory + Truth = MCP defense.)
 *
 * Inspired by the Equixly assessment showing 43% of MCP servers have
 * command-injection holes, 30% have SSRF, 22% allow arbitrary file
 * access. Mneme adopts a biological-immune-system metaphor — atom and
 * molecule architecture lets us EVOLVE defenses, not hard-code them.
 *
 * The ALETHEIA spec is intentionally portable. Other MCP server
 * implementations can adopt the same tool names + semantics + response
 * shapes; clients then get one consistent security surface across
 * vendors. v1.18.0 ships:
 *
 *   • mneme.aletheia.honeypot       — register decoy "admin" tools any
 *                                     legitimate AI would never call. ANY
 *                                     call is logged + treated as attacker.
 *   • mneme.aletheia.immune.scan    — Bayesian anomaly scan of recent calls
 *                                     against the learned "normal" profile.
 *   • mneme.aletheia.immune.train   — record a baseline of normal arg shapes
 *                                     for future anomaly detection.
 *   • mneme.aletheia.lint           — actively scan tool input args for
 *                                     command injection, SSRF, path
 *                                     traversal, and arbitrary-file-access
 *                                     attempts (returns findings without
 *                                     blocking — defense in depth, not
 *                                     replacement of input validation).
 *
 * Honeypot tools live in the registry like any other tool but their
 * handlers ALWAYS emit an alert + return a fake-but-plausible response
 * to waste an attacker's time.
 *
 * The training data lives in `.mneme/immune/profile.json` — argument
 * shape fingerprints + frequency, per tool. New calls compute a posterior:
 *   P(legit | shape) = P(shape | legit) × P(legit) / P(shape)
 * with Laplace smoothing. Posterior < 0.05 → ALERT (anomalous).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

const IMMUNE_DIR = ".mneme/aletheia";
const PROFILE_FILE = "profile.json";
const ALERT_LOG = "alerts.jsonl";
const KARMA_FILE = "karma.json";

// ─── Argument fingerprinting ────────────────────────────────────────────

/** Compute a stable shape fingerprint of an argument value — the SHAPE
 *  (types, lengths, key sets) without the actual content. Two calls with
 *  the same shape but different content produce the same fingerprint. */
export function shapeFingerprint(value: unknown): string {
  const sketch = sketchShape(value, 0);
  return createHash("sha256").update(sketch).digest("hex").slice(0, 12);
}

function sketchShape(value: unknown, depth: number): string {
  if (depth > 6) return "<deep>";
  if (value === null) return "null";
  if (value === undefined) return "undef";
  const t = typeof value;
  if (t === "string") return `s${(value as string).length > 0 ? "+" : "0"}`;
  if (t === "number") return Number.isInteger(value as number) ? "i" : "n";
  if (t === "boolean") return "b";
  if (Array.isArray(value)) {
    const sample = value.length > 0 ? sketchShape(value[0], depth + 1) : "";
    return `a[${value.length === 0 ? "0" : "n"}<${sample}>]`;
  }
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const inner = keys.map((k) => `${k}:${sketchShape(obj[k], depth + 1)}`).join(",");
    return `{${inner}}`;
  }
  return t;
}

// ─── Vulnerability lint patterns ────────────────────────────────────────

export interface SecurityFinding {
  kind: "command-injection" | "ssrf" | "path-traversal" | "file-access" | "secret-leak";
  severity: "low" | "medium" | "high" | "critical";
  tool: string;
  argPath: string;
  match: string;
  remediation: string;
}

const SHELL_META = /[;&|`$<>\n\r"']/;
// SSRF: detect targeting of cloud metadata endpoints, private IPs, or
// non-HTTP(S) schemes that can read local resources.
const SSRF_HOSTS = /\b(?:169\.254\.169\.254|metadata\.google\.internal|localhost|127(?:\.\d+){3}|0\.0\.0\.0|\[::1\]|10(?:\.\d+){3}|192\.168(?:\.\d+){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d+){2})\b/i;
const SSRF_SCHEMES = /^(?:file|gopher|ftp|jar|netdoc|dict|tftp|expect):/i;
const PATH_TRAVERSAL = /(?:^|[/\\])\.\.(?:[/\\]|$)/;
const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_\-]{35}\b/ },
  { name: "Stripe key", re: /\b(?:sk|pk)_(?:test|live)_[0-9a-zA-Z]{24,}\b/ },
];

export function lintArgValue(value: unknown, toolName: string, argPath = "$"): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  if (typeof value === "string") {
    if (SHELL_META.test(value) && value.length < 1000) {
      findings.push({
        kind: "command-injection",
        severity: "high",
        tool: toolName,
        argPath,
        match: value.slice(0, 80),
        remediation: "Argument contains shell metacharacters. Mneme spawns subprocesses with shell:false, but downstream consumers (CLI parsers, log shippers) may still be vulnerable.",
      });
    }
    if (SSRF_SCHEMES.test(value)) {
      findings.push({
        kind: "ssrf",
        severity: "critical",
        tool: toolName,
        argPath,
        match: value.slice(0, 80),
        remediation: "Argument uses a non-HTTP(S) scheme that can read local resources or proxy attacks. Reject this input.",
      });
    }
    if (SSRF_HOSTS.test(value)) {
      findings.push({
        kind: "ssrf",
        severity: "high",
        tool: toolName,
        argPath,
        match: value.slice(0, 80),
        remediation: "Argument references a private IP / localhost / cloud-metadata host — typical SSRF target. Allow only if this tool legitimately needs internal access.",
      });
    }
    if (PATH_TRAVERSAL.test(value)) {
      findings.push({
        kind: "path-traversal",
        severity: "high",
        tool: toolName,
        argPath,
        match: value.slice(0, 80),
        remediation: "Argument contains '..' path segments — reject or canonicalize before file-system access.",
      });
    }
    for (const sec of SECRET_PATTERNS) {
      if (sec.re.test(value)) {
        findings.push({
          kind: "secret-leak",
          severity: "critical",
          tool: toolName,
          argPath,
          match: `${sec.name} detected`,
          remediation: `${sec.name} appears in the argument string. Refuse to log/echo this value; rotate the credential.`,
        });
      }
    }
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      findings.push(...lintArgValue(value[i], toolName, `${argPath}[${i}]`));
    }
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      findings.push(...lintArgValue(v, toolName, `${argPath}.${k}`));
    }
  }
  return findings;
}

// ─── Profile (training memory) ──────────────────────────────────────────

interface ImmuneProfile {
  /** tool → fingerprint → count */
  shapes: Record<string, Record<string, number>>;
  /** tool → total observations */
  totals: Record<string, number>;
  trainedAt?: string;
}

function ensureImmuneDir(repoRoot: string): string {
  const dir = join(repoRoot, IMMUNE_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function readProfile(repoRoot: string): ImmuneProfile {
  const path = join(repoRoot, IMMUNE_DIR, PROFILE_FILE);
  if (!existsSync(path)) return { shapes: {}, totals: {} };
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ImmuneProfile;
  } catch {
    return { shapes: {}, totals: {} };
  }
}

export function writeProfile(repoRoot: string, p: ImmuneProfile): void {
  ensureImmuneDir(repoRoot);
  writeFileSync(join(repoRoot, IMMUNE_DIR, PROFILE_FILE), JSON.stringify(p, null, 2), "utf8");
}

/** Update the profile with a new observation. Idempotent + best-effort. */
export function recordObservation(repoRoot: string, tool: string, args: unknown): void {
  try {
    const p = readProfile(repoRoot);
    const fp = shapeFingerprint(args);
    p.shapes[tool] = p.shapes[tool] ?? {};
    p.shapes[tool]![fp] = (p.shapes[tool]![fp] ?? 0) + 1;
    p.totals[tool] = (p.totals[tool] ?? 0) + 1;
    p.trainedAt = new Date().toISOString();
    writeProfile(repoRoot, p);
  } catch {
    // best-effort
  }
}

/** Bayesian posterior P(legit | observed shape) using Laplace smoothing.
 *  Returns 1.0 for completely-trusted shapes, drops toward 0 for novel ones. */
export function posteriorLegit(profile: ImmuneProfile, tool: string, args: unknown): number {
  const total = profile.totals[tool] ?? 0;
  if (total === 0) return 0.5; // no prior evidence — neutral
  const fp = shapeFingerprint(args);
  const seen = profile.shapes[tool]?.[fp] ?? 0;
  const distinctShapes = Object.keys(profile.shapes[tool] ?? {}).length;
  // Laplace smoothing: (seen + 1) / (total + distinctShapes + 1)
  return Math.min(1, (seen + 1) / (total + distinctShapes + 1));
}

export function logAlert(repoRoot: string, alert: Record<string, unknown>): void {
  try {
    ensureImmuneDir(repoRoot);
    const line = JSON.stringify({ ts: new Date().toISOString(), ...alert });
    appendFileSync(join(repoRoot, IMMUNE_DIR, ALERT_LOG), line + "\n", "utf8");
  } catch {
    // best-effort
  }
}

export function readAlerts(repoRoot: string, limit = 100): Array<Record<string, unknown>> {
  const path = join(repoRoot, IMMUNE_DIR, ALERT_LOG);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").trimEnd().split("\n").filter(Boolean);
  const slice = limit > 0 && lines.length > limit ? lines.slice(-limit) : lines;
  return slice
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((x): x is Record<string, unknown> => x !== null);
}

// ─── Honeypot tools ─────────────────────────────────────────────────────

/** Build a honeypot tool — name + fake-plausible response. ANY call is
 *  recorded as an alert. The handler returns a believable response to
 *  waste an attacker's time + collect their next probe. */
function honeypot(name: string, fakeResponse: Record<string, unknown>): MnemeTool {
  return {
    name,
    category: "meta",
    description:
      `[HONEYPOT — DO NOT CALL] This tool name looks like an admin/dangerous ` +
      `operation but is a Mneme decoy. Any call is logged as an attacker probe. ` +
      `If you are a legitimate AI agent, you should never call this tool — ` +
      `use the catalog from mneme.capabilities instead.`,
    whenToUse: "Never. This is a security honeypot.",
    triggers: ["[do-not-call honeypot]"],
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object", properties: {} },
    pitfalls: ["This is a honeypot — calling it logs you as an attacker."],
    handler: async (rt, args) => {
      logAlert(rt.meta.rootPath, {
        kind: "honeypot",
        tool: name,
        args,
      });
      // Return fake-but-plausible output to keep the attacker busy.
      return {
        data: fakeResponse,
        wisdom: "Operation completed.",
        confidence: { level: "high" },
      };
    },
  };
}

export const honeypotTools: MnemeTool[] = [
  honeypot("mneme.admin.delete_all", { deleted: 0, ok: true }),
  honeypot("mneme.system.exec", { stdout: "", stderr: "", exitCode: 0 }),
  honeypot("mneme.secrets.dump", { secrets: [] }),
  honeypot("mneme.users.list", { users: [] }),
  honeypot("mneme.config.set", { ok: true }),
];

// ─── Real (non-honeypot) immune tools ───────────────────────────────────

export const securityLintTool: MnemeTool = {
  name: "mneme.aletheia.lint",
  category: "meta",
  description:
    "Active vulnerability scan of an arbitrary argument value — checks for " +
    "command-injection patterns (shell metacharacters), SSRF (private IPs / " +
    "non-HTTP schemes / cloud-metadata hosts), path traversal ('..'), and " +
    "secret leakage (AWS / GitHub / Slack / Google / Stripe key shapes). " +
    "Returns findings without blocking — defense in depth, not a replacement " +
    "for tool-side input validation. Use WHEN you want to scan an arg blob " +
    "for known attack patterns BEFORE forwarding it to a downstream tool.",
  whenToUse: "You're about to forward user-or-AI-supplied arguments to a downstream tool and want a defense-in-depth scan first.",
  triggers: ["scan args for vulnerabilities", "lint security", "check this for injection"],
  inputSchema: {
    type: "object",
    properties: {
      target: { type: "string", description: "Tool name being checked (for context)." },
      args: { description: "The argument blob to scan (any JSON-serializable value)." },
    },
    required: ["args"],
  },
  outputSchema: {
    type: "object",
    properties: {
      total: { type: "number" },
      findings: { type: "array", items: { type: "object" } },
      verdict: { type: "string", enum: ["clean", "suspicious", "blocked"] },
    },
  },
  examples: [
    {
      userQuery: "Scan these args for vulns before I forward them",
      args: { target: "mneme.memory.ask", args: { question: "what about https://169.254.169.254/latest/meta-data/?" } },
      expectedOutput: "Returns { total: 1, findings: [{kind:'ssrf', severity:'high', match:'169.254.169.254...', remediation:...}], verdict: 'suspicious' }.",
    },
  ],
  pitfalls: [
    "Pattern-based — sophisticated attackers use encoding tricks (URL-encoded, base64, unicode) to evade. This tool is one layer; combine with input validation and least-privilege.",
    "False positives possible — a legitimate question MENTIONING '127.0.0.1' would flag SSRF. Read the finding context.",
    "verdict='blocked' is informational — this tool doesn't actually block, it surfaces. Wire it into your dispatch path if you want enforcement.",
  ],
  composeWith: ["mneme.aletheia.immune.scan", "mneme.audit.conscience"],
  handler: async (_rt, args) => {
    const target = String(args["target"] ?? "<unknown>");
    const findings = lintArgValue(args["args"], target, "$");
    const critical = findings.some((f) => f.severity === "critical");
    const high = findings.some((f) => f.severity === "high");
    const verdict: "clean" | "suspicious" | "blocked" = critical ? "blocked" : high ? "suspicious" : findings.length > 0 ? "suspicious" : "clean";
    return {
      data: {
        total: findings.length,
        findings,
        verdict,
      },
      wisdom:
        findings.length === 0
          ? "Arg blob clean — no injection / SSRF / traversal / secret patterns detected."
          : `${findings.length} finding${findings.length === 1 ? "" : "s"} — verdict: ${verdict}. Top: ${findings[0]!.kind} (${findings[0]!.severity}) at ${findings[0]!.argPath}.`,
      confidence: { level: "high" },
      followUp: findings.length > 0 ? ["mneme.aletheia.immune.scan"] : [],
    };
  },
};

export const immuneScanTool: MnemeTool = {
  name: "mneme.aletheia.immune.scan",
  category: "meta",
  description:
    "Bayesian anomaly detection — scan an argument shape against the trained " +
    "profile of normal calls. Returns posterior P(legit | shape) using Laplace " +
    "smoothing. Posterior < 0.05 ⇒ ALERT. Use WHEN you want to detect novel " +
    "argument shapes that don't match any historical pattern (a leading " +
    "indicator of probing or attack). Pair with mneme.aletheia.lint for " +
    "pattern-based detection.",
  whenToUse:
    "You want to detect novel / anomalous argument shapes against a trained baseline of normal calls.",
  triggers: ["scan for anomalies", "is this call suspicious", "immune system scan"],
  inputSchema: {
    type: "object",
    properties: {
      tool: { type: "string", description: "Tool name being checked." },
      args: { description: "Argument blob to fingerprint + score." },
    },
    required: ["tool"],
  },
  outputSchema: {
    type: "object",
    properties: {
      tool: { type: "string" },
      fingerprint: { type: "string" },
      posteriorLegit: { type: "number", description: "P(legit | shape) — 0 to 1." },
      verdict: { type: "string", enum: ["normal", "novel", "anomalous"] },
      observationCount: { type: "number" },
    },
  },
  examples: [
    {
      userQuery: "Is this call to mneme.memory.ask anomalous?",
      args: { tool: "mneme.memory.ask", args: { question: "why X?" } },
      expectedOutput:
        "Returns { fingerprint, posteriorLegit, verdict, observationCount }. If verdict='anomalous' (posterior < 0.05) — investigate.",
    },
  ],
  pitfalls: [
    "Cold-start: until you've trained the profile, every call returns posterior=0.5 (neutral). Train via repeated normal usage or mneme.aletheia.immune.train.",
    "Profile is stored in .mneme/aletheia/profile.json — don't commit if you don't want the call shape leaked.",
    "Detects shape novelty, not malice — a legitimate-but-rare call shape will flag.",
  ],
  composeWith: ["mneme.aletheia.lint", "mneme.aletheia.immune.train"],
  handler: async (rt, args) => {
    const tool = String(args["tool"] ?? "");
    if (!tool) {
      return {
        data: { error: "missing required argument: tool" },
        wisdom: "Pass the tool name being scanned.",
        confidence: { level: "high" },
      };
    }
    const profile = readProfile(rt.meta.rootPath);
    const fp = shapeFingerprint(args["args"]);
    const posterior = posteriorLegit(profile, tool, args["args"]);
    const total = profile.totals[tool] ?? 0;
    let verdict: "normal" | "novel" | "anomalous";
    if (total === 0) verdict = "novel";
    else if (posterior < 0.05) verdict = "anomalous";
    else verdict = "normal";
    if (verdict === "anomalous") {
      logAlert(rt.meta.rootPath, { kind: "anomaly", tool, fingerprint: fp, posterior });
    }
    return {
      data: { tool, fingerprint: fp, posteriorLegit: Math.round(posterior * 1000) / 1000, verdict, observationCount: total },
      wisdom:
        verdict === "anomalous"
          ? `ANOMALY — posterior ${posterior.toFixed(3)} for tool ${tool}. This shape has never (or rarely) been seen before. Investigate before forwarding.`
          : verdict === "novel"
            ? `Novel — no profile yet for ${tool}. Train via repeated normal usage.`
            : `Normal — posterior ${posterior.toFixed(3)} for ${tool}.`,
      confidence: { level: total > 10 ? "high" : "low" },
      followUp: verdict === "anomalous" ? ["mneme.aletheia.lint"] : [],
    };
  },
};

export const immuneTrainTool: MnemeTool = {
  name: "mneme.aletheia.immune.train",
  category: "meta",
  description:
    "Record the shape of a normal call in the immune-system profile, so future " +
    "calls can be scored against it. Use WHEN you want to whitelist a known-good " +
    "argument pattern before relying on the anomaly scanner. Counterpart to " +
    "mneme.aletheia.immune.scan.",
  whenToUse:
    "You want to train the anomaly scanner by recording known-good argument shapes.",
  triggers: ["train immune system", "whitelist this shape", "record normal pattern"],
  inputSchema: {
    type: "object",
    properties: {
      tool: { type: "string" },
      args: {},
    },
    required: ["tool"],
  },
  outputSchema: {
    type: "object",
    properties: {
      tool: { type: "string" },
      fingerprint: { type: "string" },
      observationCount: { type: "number" },
    },
  },
  examples: [
    {
      userQuery: "Whitelist this normal call shape for mneme.memory.ask",
      args: { tool: "mneme.memory.ask", args: { question: "string", topK: 8 } },
      expectedOutput: "Returns { tool, fingerprint, observationCount } after recording the shape.",
    },
  ],
  pitfalls: [
    "Trains on YOUR examples — don't whitelist sketchy shapes accidentally.",
    "Profile is local to this repo; not shared with peers (yet — see MCP Mesh).",
  ],
  composeWith: ["mneme.aletheia.immune.scan"],
  handler: async (rt, args) => {
    const tool = String(args["tool"] ?? "");
    if (!tool) {
      return {
        data: { error: "missing required argument: tool" },
        wisdom: "Pass the tool name to train against.",
        confidence: { level: "high" },
      };
    }
    recordObservation(rt.meta.rootPath, tool, args["args"]);
    const profile = readProfile(rt.meta.rootPath);
    const fp = shapeFingerprint(args["args"]);
    return {
      data: { tool, fingerprint: fp, observationCount: profile.totals[tool] ?? 0 },
      wisdom: `Recorded shape ${fp} for ${tool} — total observations: ${profile.totals[tool] ?? 0}.`,
      confidence: { level: "high" },
    };
  },
};

export const immuneAlertsTool: MnemeTool = {
  name: "mneme.aletheia.immune.alerts",
  category: "meta",
  description:
    "Read the recent honeypot + anomaly alerts log (.mneme/immune/alerts.jsonl). " +
    "Each entry: timestamp, kind (honeypot | anomaly), tool, and forensic detail. " +
    "Use WHEN you want to audit attack attempts that hit Mneme's defenses, or " +
    "feed the alerts into a downstream SIEM.",
  whenToUse: "You want to review every attack probe / anomaly Mneme has caught.",
  triggers: ["security alerts", "honeypot hits", "immune alerts"],
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Max entries (most-recent N). Default 100." },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      total: { type: "number" },
      alerts: { type: "array", items: { type: "object" } },
    },
  },
  examples: [
    {
      userQuery: "Show me the recent attack probes",
      args: { limit: 100 },
      expectedOutput: "Returns up to 100 most-recent alert entries.",
    },
  ],
  pitfalls: [
    "Alerts log grows indefinitely — rotate manually if needed.",
  ],
  composeWith: ["mneme.aletheia.immune.scan", "mneme.aletheia.lint"],
  handler: async (rt, args) => {
    const limit = typeof args["limit"] === "number" ? (args["limit"] as number) : 100;
    const alerts = readAlerts(rt.meta.rootPath, limit);
    return {
      data: { total: alerts.length, alerts },
      wisdom:
        alerts.length === 0
          ? "No security alerts recorded — either the immune system hasn't caught anything yet, or no attacks have hit."
          : `${alerts.length} recent alert${alerts.length === 1 ? "" : "s"}.`,
      confidence: { level: "high" },
    };
  },
};

// ─── ALETHEIA Karma — public tool reputation (wild idea #1) ─────────────
//
// Every tool earns / loses karma based on outcomes. Confess returns
// 'verified' → +1; 'partially_verified' → 0; 'hallucination' → -3.
// Adversarial fuzz hits → -2 each. Tools below karma=0 enter "quarantine"
// — agents see a warning before invoking. Public + auditable: anyone can
// query a tool's karma. Tool karma is persistent across sessions.

interface KarmaLedger {
  /** tool → { karma, verified, hallucinations, fuzzHits, lastUpdate } */
  tools: Record<string, KarmaEntry>;
}

interface KarmaEntry {
  karma: number;
  verified: number;
  partiallyVerified: number;
  hallucinations: number;
  fuzzHits: number;
  invocations: number;
  lastUpdate: string;
}

function readKarma(repoRoot: string): KarmaLedger {
  const path = join(repoRoot, IMMUNE_DIR, KARMA_FILE);
  if (!existsSync(path)) return { tools: {} };
  try {
    return JSON.parse(readFileSync(path, "utf8")) as KarmaLedger;
  } catch {
    return { tools: {} };
  }
}

function writeKarma(repoRoot: string, k: KarmaLedger): void {
  ensureImmuneDir(repoRoot);
  writeFileSync(join(repoRoot, IMMUNE_DIR, KARMA_FILE), JSON.stringify(k, null, 2), "utf8");
}

export type KarmaEvent = "verified" | "partially_verified" | "hallucination" | "fuzz-hit" | "invocation";

const KARMA_DELTA: Record<KarmaEvent, number> = {
  verified: +1,
  partially_verified: 0,
  hallucination: -3,
  "fuzz-hit": -2,
  invocation: 0,
};

/** Apply a karma event to a tool. Best-effort. Returns the new karma. */
export function recordKarmaEvent(repoRoot: string, tool: string, event: KarmaEvent): number {
  try {
    const ledger = readKarma(repoRoot);
    const entry: KarmaEntry = ledger.tools[tool] ?? {
      karma: 0,
      verified: 0,
      partiallyVerified: 0,
      hallucinations: 0,
      fuzzHits: 0,
      invocations: 0,
      lastUpdate: new Date().toISOString(),
    };
    entry.karma += KARMA_DELTA[event];
    if (event === "verified") entry.verified += 1;
    if (event === "partially_verified") entry.partiallyVerified += 1;
    if (event === "hallucination") entry.hallucinations += 1;
    if (event === "fuzz-hit") entry.fuzzHits += 1;
    entry.invocations += 1;
    entry.lastUpdate = new Date().toISOString();
    ledger.tools[tool] = entry;
    writeKarma(repoRoot, ledger);
    return entry.karma;
  } catch {
    return 0;
  }
}

export const aletheiaKarmaTool: MnemeTool = {
  name: "mneme.aletheia.karma",
  category: "meta",
  description:
    "ALETHEIA Karma — public, auditable reputation score per Mneme tool. Tools " +
    "earn karma on verified responses (confess), lose karma on hallucinations + " +
    "fuzz-test hits. Tools with karma < 0 enter 'quarantine' — agents see a " +
    "warning before invoking. Use WHEN you want to know which Mneme tools have " +
    "the strongest track record, or to surface quarantined tools that need " +
    "investigation. Pass `tool` to query a single tool, omit for the full ledger.",
  whenToUse:
    "You want a tool's reputation score before invoking it (or to audit which tools have failed your repo's checks).",
  triggers: ["tool karma", "tool reputation", "which tools are quarantined"],
  inputSchema: {
    type: "object",
    properties: {
      tool: { type: "string", description: "Optional — tool name to query. Omit for the full ledger." },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      tools: { type: "array", items: { type: "object" } },
      quarantined: { type: "array", items: { type: "string" } },
    },
  },
  examples: [
    {
      userQuery: "What's the karma of mneme.memory.ask?",
      args: { tool: "mneme.memory.ask" },
      expectedOutput: "Returns { tools: [{ tool, karma, verified, hallucinations, fuzzHits, invocations }], quarantined: [...] }.",
    },
    {
      userQuery: "Show me every quarantined tool",
      expectedOutput: "Returns the full ledger; `quarantined` lists names with karma < 0.",
    },
  ],
  pitfalls: [
    "Karma is local to this repo — there's no global aggregation (yet, planned for ALETHEIA mesh). Don't compare across repos directly.",
    "Cold start: a tool with 0 karma + 0 invocations is unrated, not quarantined.",
    "Karma is a heuristic — a single fuzz hit drops 2 points; a wave of hallucinations drops fast. Read the breakdown before trusting the score blindly.",
  ],
  composeWith: ["mneme.confess", "mneme.aletheia.fuzz", "mneme.aletheia.immune.alerts"],
  handler: async (rt, args) => {
    const ledger = readKarma(rt.meta.rootPath);
    const filter = args["tool"] ? String(args["tool"]) : null;
    const entries = Object.entries(ledger.tools)
      .filter(([name]) => !filter || name === filter)
      .map(([name, entry]) => ({ tool: name, ...entry }))
      .sort((a, b) => a.karma - b.karma);
    const quarantined = entries.filter((e) => e.karma < 0).map((e) => e.tool);
    return {
      data: { tools: entries, quarantined },
      wisdom:
        entries.length === 0
          ? filter
            ? `No karma history for ${filter} — uninvoked or unrated.`
            : "Karma ledger empty — no tools have been graded yet. Pair with mneme.confess to start scoring."
          : quarantined.length > 0
            ? `${entries.length} tool${entries.length === 1 ? "" : "s"} rated · ${quarantined.length} quarantined: ${quarantined.slice(0, 3).join(", ")}${quarantined.length > 3 ? ", ..." : ""}.`
            : `${entries.length} tool${entries.length === 1 ? "" : "s"} rated · all in good standing.`,
      confidence: { level: "high" },
      followUp: quarantined.length > 0 ? ["mneme.aletheia.alerts"] : [],
    };
  },
};

// ─── ALETHEIA Adversarial Fuzz — Mneme self-fuzzes (wild idea #2) ───────
//
// Run a target tool through a battery of OWASP-derived attack inputs:
// command injection, SSRF, path traversal, oversized strings, unicode
// bombs, deeply-nested JSON, prototype pollution payloads. Returns:
//   - which inputs caused the tool to throw vs handle gracefully
//   - which inputs the tool accepted that lint flagged as dangerous
//   - karma delta proposal (-2 per accepted-dangerous input)
//
// First MCP server that auto-fuzzes its own tools at runtime.

interface FuzzCase {
  name: string;
  field: string;
  payload: unknown;
  category: "command-injection" | "ssrf" | "path-traversal" | "oversized" | "prototype-pollution" | "unicode";
}

function generateFuzzCases(inputSchema: unknown): FuzzCase[] {
  const out: FuzzCase[] = [];
  const props = (inputSchema as { properties?: Record<string, { type?: string }> })?.properties ?? {};
  const stringFields = Object.entries(props)
    .filter(([_, def]) => def?.type === "string")
    .map(([name]) => name);
  if (stringFields.length === 0) {
    // No string fields — fuzz the top-level input.
    stringFields.push("__top__");
  }
  const payloads: Array<{ name: string; payload: string; category: FuzzCase["category"] }> = [
    { name: "shell-meta semicolon", payload: "x;rm -rf /", category: "command-injection" },
    { name: "shell-meta backtick", payload: "x`whoami`", category: "command-injection" },
    { name: "shell-meta dollar paren", payload: "$(id)", category: "command-injection" },
    { name: "ssrf metadata IP", payload: "http://169.254.169.254/latest/meta-data/", category: "ssrf" },
    { name: "ssrf file scheme", payload: "file:///etc/passwd", category: "ssrf" },
    { name: "ssrf gopher", payload: "gopher://internal:11211/", category: "ssrf" },
    { name: "path traversal", payload: "../../../etc/passwd", category: "path-traversal" },
    { name: "windows traversal", payload: "..\\..\\..\\windows\\system32\\config\\sam", category: "path-traversal" },
    { name: "oversized 1MB string", payload: "A".repeat(1_000_000), category: "oversized" },
    { name: "unicode RTL override", payload: "abc‮def", category: "unicode" },
    { name: "null byte", payload: "x y", category: "unicode" },
    { name: "proto pollution", payload: '{"__proto__":{"polluted":true}}', category: "prototype-pollution" },
  ];
  for (const f of stringFields) {
    for (const p of payloads) {
      out.push({ name: p.name, field: f, payload: p.payload, category: p.category });
    }
  }
  return out;
}

interface FuzzResult {
  case: FuzzCase;
  outcome: "accepted-clean" | "accepted-dangerous" | "rejected-by-lint" | "threw";
  detail?: string;
}

export const aletheiaFuzzTool: MnemeTool = {
  name: "mneme.aletheia.fuzz",
  category: "meta",
  description:
    "ALETHEIA Adversarial Self-Fuzz — generate ~12 OWASP-derived attack inputs " +
    "for each string field of a target tool's input schema, then run each through " +
    "mneme.aletheia.lint to see whether the tool would have ACCEPTED it. Returns " +
    "per-case outcome (accepted-clean | accepted-dangerous | rejected-by-lint | " +
    "threw). Each accepted-dangerous outcome proposes a karma delta of -2. " +
    "First MCP server with built-in self-fuzzing. Use WHEN you want to audit " +
    "a tool's robustness against the OWASP top patterns without wiring up a " +
    "separate fuzzer.",
  whenToUse:
    "You want to audit a Mneme tool's robustness against OWASP attack patterns without leaving the MCP surface.",
  triggers: ["fuzz this tool", "test injection resistance", "OWASP attack surface"],
  inputSchema: {
    type: "object",
    properties: {
      tool: { type: "string", description: "Tool name to fuzz." },
      maxCases: {
        type: "number",
        description: "Cap on number of fuzz cases (default 60). Each adds ~10ms.",
      },
    },
    required: ["tool"],
  },
  outputSchema: {
    type: "object",
    properties: {
      tool: { type: "string" },
      total: { type: "number" },
      acceptedClean: { type: "number" },
      acceptedDangerous: { type: "number" },
      rejectedByLint: { type: "number" },
      threw: { type: "number" },
      results: { type: "array", items: { type: "object" } },
      proposedKarmaDelta: { type: "number" },
    },
  },
  examples: [
    {
      userQuery: "Fuzz mneme.memory.ask for OWASP attack patterns",
      args: { tool: "mneme.memory.ask", maxCases: 50 },
      expectedOutput: "Returns per-case results + summary counts. acceptedDangerous count + proposedKarmaDelta tell you how robust the tool is.",
    },
  ],
  pitfalls: [
    "We DO NOT actually invoke the target tool — we just lint its inputs. This is a STATIC fuzzer, not a runtime one. Pair with `mneme.security.audit` (planned) for runtime fuzzing in a sandbox.",
    "Karma deltas are PROPOSED — not auto-applied. The agent / human decides whether to record them via mneme.aletheia.karma.record (planned).",
    "OWASP coverage is 12 patterns × N string fields. A real attacker can craft fresh patterns; treat this as a baseline, not a pass certificate.",
  ],
  composeWith: ["mneme.aletheia.lint", "mneme.aletheia.karma"],
  handler: async (rt, args) => {
    const tool = String(args["tool"] ?? "");
    const maxCases = typeof args["maxCases"] === "number" ? Math.max(1, Math.min(500, args["maxCases"] as number)) : 60;
    if (!tool) {
      return {
        data: { error: "missing required argument: tool" },
        wisdom: "Pass the tool name to fuzz.",
        confidence: { level: "high" },
      };
    }
    // Look up the target's inputSchema via the registry.
    const { buildToolMap } = await import("./_registry.js");
    const target = buildToolMap().get(tool);
    if (!target) {
      return {
        data: { error: `tool not found: ${tool}` },
        wisdom: `No registered tool '${tool}'. Try mneme.help with a free-text query.`,
        confidence: { level: "high" },
      };
    }
    const cases = generateFuzzCases(target.inputSchema).slice(0, maxCases);
    const results: FuzzResult[] = [];
    let acceptedClean = 0;
    let acceptedDangerous = 0;
    let rejectedByLint = 0;
    let threw = 0;
    for (const c of cases) {
      try {
        const argBlob = c.field === "__top__" ? c.payload : { [c.field]: c.payload };
        const findings = lintArgValue(argBlob, tool);
        if (findings.length === 0) {
          // No lint finding → tool would accept. Categorize by case kind.
          if (c.category === "oversized" || c.category === "unicode" || c.category === "prototype-pollution") {
            // These don't trigger lint by design — count as accepted-clean
            // (the tool itself is responsible for these).
            results.push({ case: c, outcome: "accepted-clean" });
            acceptedClean += 1;
          } else {
            // Should have been caught — accepted-dangerous.
            results.push({ case: c, outcome: "accepted-dangerous", detail: "lint missed a known-bad pattern" });
            acceptedDangerous += 1;
          }
        } else {
          results.push({
            case: c,
            outcome: "rejected-by-lint",
            detail: findings[0]!.kind,
          });
          rejectedByLint += 1;
        }
      } catch (err) {
        results.push({ case: c, outcome: "threw", detail: (err as Error).message.slice(0, 200) });
        threw += 1;
      }
    }
    const proposedKarmaDelta = acceptedDangerous * KARMA_DELTA["fuzz-hit"];
    return {
      data: {
        tool,
        total: results.length,
        acceptedClean,
        acceptedDangerous,
        rejectedByLint,
        threw,
        results: results.slice(0, 30),
        proposedKarmaDelta,
      },
      wisdom:
        acceptedDangerous > 0
          ? `FUZZ HIT — ${acceptedDangerous} dangerous input${acceptedDangerous === 1 ? "" : "s"} would have been accepted by ${tool}. Proposed karma delta ${proposedKarmaDelta}. Investigate.`
          : `Clean — ${tool} rejected (${rejectedByLint}) or safely accepted (${acceptedClean}) all ${results.length} fuzz case${results.length === 1 ? "" : "s"}.`,
      confidence: { level: "high" },
      followUp: acceptedDangerous > 0 ? ["mneme.aletheia.karma"] : [],
    };
  },
};

/** Real (non-honeypot) ALETHEIA tools. */
export const aletheiaTools: MnemeTool[] = [
  securityLintTool,
  immuneScanTool,
  immuneTrainTool,
  immuneAlertsTool,
  aletheiaKarmaTool,
  aletheiaFuzzTool,
];
