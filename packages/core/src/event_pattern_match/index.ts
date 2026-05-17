/**
 * v2.19.24 — MNEME EVENT PATTERN MATCH (extends v2.19.23 SPINAL REFLEX)
 *
 *   "user commit 'fix: token leak in auth.ts' → reflex detect 'fix:' +
 *    'token leak' + 'auth' → pre-execute bug_prophet + forensics.vulns +
 *    apoptosis.detect in 200ms → AI ตอนถามจริงได้ผลใน 0ms"
 *                                          — user audit, 2026-05-17
 *
 *   Diagnosis: v2.19.23 SPINAL REFLEX ships 8 BUILTIN_RULES that match
 *   on `eventKind + contextPredicate`. The predicates are coarse: they
 *   match TYPE OF EVENT, not SEMANTIC CONTENT. A commit message
 *   "fix: token leak" gets the same predictions as "feat: add dark mode"
 *   because both are git_commit events.
 *
 *   Fix: SEMANTIC PATTERN MATCHER inspects event content (commit text,
 *   file path, clipboard text, shell command) against a regex pattern
 *   library. Each pattern proposes specific follow-up tools with
 *   confidence. Multi-pattern hits are MERGED via max-confidence
 *   (most-confident-rule-wins per tool name).
 *
 *   Built-in patterns (15+) cover:
 *     - Commit-message intent (fix / feat / chore / docs / security)
 *     - Security keywords (token leak / cve / vuln / exploit / xss / sql)
 *     - File-type hints (.ts → bug_prophet; .test.* → coverage; .md → docs)
 *     - Clipboard handoff signals ("check this with claude" → handoff.universal)
 *     - Shell command intent ("npm install" → deps.oracle; "git push" → premortem)
 *
 *   Composes onto:
 *     - v2.19.23 SPINAL REFLEX (Prediction interface; blendPredictions consumer)
 *     - v2.19.22 REFLEX (eventCacheKey; cache surface)
 *     - v2.19.10 REVERSE-WRAPPER BUILTIN_RULES pattern (proven)
 *
 * Honest scope:
 *   - PURE FUNCTION matcher; deterministic; HMAC-signed report.
 *   - Patterns are REGEX, not NLP. False positives expected on noisy
 *     commit messages; caller can ignore matches with confidence < 0.5.
 *   - Caller hooks the actual event sources (git post-commit hook /
 *     fs.watch / clipboard observer); this module is the SEMANTIC
 *     classifier only.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;

export type SemanticEventKind = "git_commit" | "file_save" | "clipboard" | "terminal_command" | "user_chat";

export interface SemanticEvent {
  v: typeof PROTOCOL_VERSION;
  kind: SemanticEventKind;
  /** Full text content of the event (commit msg, file path, clipboard text, etc). */
  text: string;
  /** Optional structured context (e.g., { filePath, sha, args }). */
  context?: Record<string, unknown>;
  ts: number;
}

export interface SemanticPattern {
  id: string;
  eventKinds: SemanticEventKind[];
  regex: RegExp;
  /** Tools this pattern suggests when matched, each with prior confidence. */
  tools: Array<{ toolName: string; argsTemplate: Record<string, unknown>; confidence: number }>;
  reason: string;
}

export interface SemanticPrediction {
  toolName: string;
  argsTemplate: Record<string, unknown>;
  confidence: number;
  matchedPatterns: string[];
}

/**
 * 18 built-in semantic patterns covering the most common AI-agent
 * workflows on a code repo. Each pattern is one regex over event.text
 * + optional eventKind filter + a list of suggested tools.
 */
export const BUILTIN_PATTERNS: readonly SemanticPattern[] = [
  // ─── commit-message intent ──────────────────────────────────────────
  {
    id: "commit_fix_prefix",
    eventKinds: ["git_commit"],
    regex: /^fix(\(\w+\))?:/,
    tools: [
      { toolName: "mneme.bug_prophet.prophesy", argsTemplate: {}, confidence: 0.7 },
      { toolName: "mneme.premortem", argsTemplate: { change: "fix commit" }, confidence: 0.6 },
    ],
    reason: "fix: prefix → bug-prophet checks regression patterns; premortem flags risk",
  },
  {
    id: "commit_feat_prefix",
    eventKinds: ["git_commit"],
    regex: /^feat(\(\w+\))?:/,
    tools: [
      { toolName: "mneme.consequence.record", argsTemplate: { cmd: "feat commit" }, confidence: 0.6 },
      { toolName: "mneme.atrophy", argsTemplate: {}, confidence: 0.45 },
    ],
    reason: "feat: prefix → record consequence + check who-loses-knowledge from new code",
  },
  {
    id: "commit_chore_or_docs",
    eventKinds: ["git_commit"],
    regex: /^(chore|docs|style|refactor)(\(\w+\))?:/,
    tools: [
      { toolName: "mneme.consequence.record", argsTemplate: { cmd: "low-risk commit" }, confidence: 0.4 },
    ],
    reason: "low-risk commit type → just record consequence; no deep checks needed",
  },

  // ─── security keywords ──────────────────────────────────────────────
  {
    id: "security_token_leak",
    eventKinds: ["git_commit", "file_save"],
    regex: /\b(token leak|secret leak|api[\s_-]?key|password|credential)\b/i,
    tools: [
      { toolName: "mneme.forensics.vulns", argsTemplate: {}, confidence: 0.85 },
      { toolName: "mneme.apoptosis.detect", argsTemplate: {}, confidence: 0.75 },
      { toolName: "mneme.antivirus.scan", argsTemplate: {}, confidence: 0.7 },
    ],
    reason: "secret/credential keyword → vulns + apoptosis + antivirus scan immediately",
  },
  {
    id: "security_cve_vuln",
    eventKinds: ["git_commit", "file_save", "terminal_command"],
    regex: /\b(cve-\d+|vulnerabilit|exploit|xss|sql injection|csrf|rce)\b/i,
    tools: [
      { toolName: "mneme.forensics.vulns", argsTemplate: {}, confidence: 0.9 },
      { toolName: "mneme.deps.oracle", argsTemplate: {}, confidence: 0.7 },
    ],
    reason: "CVE / vuln class keyword → forensics.vulns + dep-oracle",
  },
  {
    id: "security_auth_file",
    eventKinds: ["file_save", "git_commit"],
    regex: /(^|\/)(auth|login|session|crypto|password)\w*\.(ts|tsx|js|py|go|rs|java)/i,
    tools: [
      { toolName: "mneme.forensics.vulns", argsTemplate: {}, confidence: 0.7 },
      { toolName: "mneme.premortem", argsTemplate: { change: "edited auth-adjacent file" }, confidence: 0.55 },
    ],
    reason: "auth-adjacent file edit → run vulns + premortem (high-blast-radius area)",
  },

  // ─── file-type hints ────────────────────────────────────────────────
  {
    id: "file_test_save",
    eventKinds: ["file_save"],
    regex: /\.(test|spec)\.(ts|tsx|js|jsx|py|go)$/,
    tools: [
      { toolName: "mneme.ask", argsTemplate: { question: "is this test coverage complete" }, confidence: 0.5 },
    ],
    reason: "test-file save → check coverage gap",
  },
  {
    id: "file_md_save",
    eventKinds: ["file_save"],
    regex: /\.(md|mdx|rst|txt)$/i,
    tools: [
      { toolName: "mneme.antivirus.scan", argsTemplate: {}, confidence: 0.45 },
    ],
    reason: "markdown/docs save → run antivirus to catch hallucinated tool names + phantom files",
  },
  {
    id: "file_config_save",
    eventKinds: ["file_save"],
    regex: /(package\.json|tsconfig\.json|\.env|docker[Ff]ile|\.yml|\.yaml)$/,
    tools: [
      { toolName: "mneme.deps.oracle", argsTemplate: {}, confidence: 0.6 },
      { toolName: "mneme.premortem", argsTemplate: { change: "config file changed" }, confidence: 0.6 },
    ],
    reason: "config file save → dep-oracle + premortem (config drift is high-blast-radius)",
  },

  // ─── clipboard handoff signals ─────────────────────────────────────
  {
    id: "clipboard_handoff_claude",
    eventKinds: ["clipboard"],
    regex: /\b(check this with|send to|paste in|ask) (claude|claude code|claude\.ai|chatgpt|gpt|cursor|copilot)\b/i,
    tools: [
      { toolName: "mneme.handoff.universal", argsTemplate: {}, confidence: 0.95 },
    ],
    reason: "clipboard handoff intent → auto-fire handoff.universal so paste is 1-step not 10-step",
  },
  {
    id: "clipboard_authenticity_image",
    eventKinds: ["clipboard", "user_chat"],
    // No \b word boundary — Thai isn't ASCII word-boundary friendly; we want
    // these terms to match as substrings inside longer chat utterances.
    regex: /(authentic|real or fake|ของแท้|ตรวจของแท้|ของจริง|fake check)/i,
    tools: [
      { toolName: "mneme.caption.sever", argsTemplate: {}, confidence: 0.9 },
      { toolName: "mneme.provenance.evaluate", argsTemplate: {}, confidence: 0.7 },
    ],
    reason: "authenticity query (multilingual EN+TH) → CAPTION SEVERANCE PROTOCOL + provenance check",
  },
  {
    id: "shell_dangerous_destructive",
    eventKinds: ["terminal_command"],
    regex: /\b(rm\s+-rf|git\s+reset\s+--hard|drop\s+(table|database)|truncate\s+table)\b/i,
    tools: [
      { toolName: "mneme.premortem", argsTemplate: { change: "destructive shell command" }, confidence: 0.95 },
      { toolName: "mneme.consequence.record", argsTemplate: { cmd: "destructive" }, confidence: 0.7 },
    ],
    reason: "destructive shell command → premortem MUST run first; consequence record for audit",
  },

  // ─── shell command intent ──────────────────────────────────────────
  {
    id: "shell_npm_install",
    eventKinds: ["terminal_command"],
    regex: /^\s*(npm|pnpm|yarn)\s+(i|install|add)\b/i,
    tools: [
      { toolName: "mneme.deps.oracle", argsTemplate: {}, confidence: 0.85 },
      { toolName: "mneme.antivirus.scan", argsTemplate: {}, confidence: 0.55 },
    ],
    reason: "package install → predict dep fate + antivirus the lock-file diff",
  },
  {
    id: "shell_git_push",
    eventKinds: ["terminal_command"],
    regex: /^\s*git\s+push\b/i,
    tools: [
      { toolName: "mneme.premortem", argsTemplate: { change: "git push" }, confidence: 0.7 },
      { toolName: "mneme.guard", argsTemplate: {}, confidence: 0.65 },
    ],
    reason: "git push → premortem the push + run guard on the staged diff",
  },
  {
    id: "shell_test_run",
    eventKinds: ["terminal_command"],
    regex: /\b(npm\s+test|vitest|jest|pytest|go\s+test|cargo\s+test)\b/i,
    tools: [
      { toolName: "mneme.consequence.record", argsTemplate: { cmd: "test run" }, confidence: 0.5 },
    ],
    reason: "test run → record consequence so we can correlate green/red with later regressions",
  },

  // ─── user-chat intent (Thai + English) ────────────────────────────
  {
    id: "chat_what_changed",
    eventKinds: ["user_chat"],
    regex: /\b(what changed|what's new|มีอะไรใหม่|มีอะไรเปลี่ยน|recent change)\b/i,
    tools: [
      { toolName: "mneme.whats_new", argsTemplate: {}, confidence: 0.85 },
      { toolName: "mneme.status", argsTemplate: {}, confidence: 0.6 },
    ],
    reason: "what-changed query → whats_new + status (multilingual EN+TH)",
  },
  {
    id: "chat_why_does_this_exist",
    eventKinds: ["user_chat"],
    regex: /\b(why does (this|it) exist|why was this added|ทำไมต้องมี|ทำไมเขียนแบบนี้)\b/i,
    tools: [
      { toolName: "mneme.why", argsTemplate: {}, confidence: 0.9 },
      { toolName: "mneme.lineage", argsTemplate: {}, confidence: 0.6 },
    ],
    reason: "why-does-this-exist query → why + lineage (multilingual EN+TH)",
  },
  {
    id: "chat_who_knows",
    eventKinds: ["user_chat"],
    regex: /\b(who knows|who wrote|who can review|ใครรู้เรื่อง|ใครเขียน)\b/i,
    tools: [
      { toolName: "mneme.who_knows", argsTemplate: {}, confidence: 0.9 },
      { toolName: "mneme.atrophy", argsTemplate: {}, confidence: 0.5 },
    ],
    reason: "who-knows query → who_knows + atrophy (multilingual EN+TH)",
  },
];

/** Match an event against ALL patterns; return ranked predictions. */
export function matchEventPatterns(input: {
  event: SemanticEvent;
  patterns?: readonly SemanticPattern[];
  topN?: number;
}): SemanticPrediction[] {
  const patterns = input.patterns ?? BUILTIN_PATTERNS;
  const topN = input.topN ?? 5;
  const byTool = new Map<string, SemanticPrediction>();
  for (const p of patterns) {
    if (!p.eventKinds.includes(input.event.kind)) continue;
    if (!p.regex.test(input.event.text)) continue;
    for (const t of p.tools) {
      const prev = byTool.get(t.toolName);
      if (prev) {
        // Multi-pattern hit: max-confidence wins; accumulate matched IDs.
        if (t.confidence > prev.confidence) {
          prev.confidence = t.confidence;
          prev.argsTemplate = t.argsTemplate;
        }
        if (!prev.matchedPatterns.includes(p.id)) prev.matchedPatterns.push(p.id);
      } else {
        byTool.set(t.toolName, {
          toolName: t.toolName,
          argsTemplate: t.argsTemplate,
          confidence: t.confidence,
          matchedPatterns: [p.id],
        });
      }
    }
  }
  return Array.from(byTool.values())
    .sort((a, b) => b.confidence - a.confidence || a.toolName.localeCompare(b.toolName))
    .slice(0, topN);
}

export interface MatchReport {
  v: typeof PROTOCOL_VERSION;
  event: SemanticEvent;
  predictions: SemanticPrediction[];
  patternsConsidered: number;
  patternsMatched: number;
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_EVENT_PATTERN_SECRET"] || `mneme-event-pattern-v${PROTOCOL_VERSION}`;
}

function hmacHex(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

export function reportMatch(input: { event: SemanticEvent; topN?: number; secret?: string }): MatchReport {
  const predictions = matchEventPatterns({ event: input.event, topN: input.topN });
  const matched = new Set<string>();
  for (const p of predictions) for (const id of p.matchedPatterns) matched.add(id);
  const body: Omit<MatchReport, "sig"> = {
    v: PROTOCOL_VERSION,
    event: input.event,
    predictions,
    patternsConsidered: BUILTIN_PATTERNS.length,
    patternsMatched: matched.size,
  };
  const sig = hmacHex(body, input.secret ?? defaultSecret());
  return { ...body, sig };
}

export function verifyReport(r: MatchReport, secret?: string): boolean {
  const { sig, ...body } = r;
  return safeEqHex(hmacHex(body, secret ?? defaultSecret()), sig);
}

export function listBuiltinPatterns(): SemanticPattern[] {
  return [...BUILTIN_PATTERNS];
}

export function formatPredictionLine(p: SemanticPrediction): string {
  const conf = (p.confidence * 100).toFixed(0);
  return `⚡ ${p.toolName} · ${conf}% · matched=[${p.matchedPatterns.join(",")}]`;
}
