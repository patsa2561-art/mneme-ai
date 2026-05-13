/**
 * v1.62.0 -- REACTOR LAYERS 3, 4, 6, 7, 8, 9, 10, 11, 12.
 *
 * Smaller modules grouped into a single file for surface coherence.
 * Each export ships its own deterministic measure of tokens-saved so
 * the ledger rolls them all up uniformly.
 */

import { createHash, createHmac, randomBytes } from "node:crypto";
import { safeHmacNotEqual } from "../util/hmac_compare.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { estimateTokens, metricsOf, recordSavings, type ReactorMetrics } from "./measure.js";

// ─── LAYER 3: COMPILED INTENT PROTOCOL ─────────────────────────────────
//
// Recipe library. Caller's intent matches a recipe → Mneme emits the
// boilerplate skeleton + leaves the AI to fill in the 3-5 line gap.

export interface Recipe {
  id: string;
  pattern: RegExp;
  /** Boilerplate that Mneme emits directly (no AI). */
  scaffold: string;
  /** Description of the gap the AI must fill. */
  aiGap: string;
  /** Expected token cost: scaffold (no AI) + AI's fill. */
  estimatedAiTokens: number;
}

const RECIPES: Recipe[] = [
  {
    id: "structured-logger",
    pattern: /add\s+(?:a\s+)?(?:structured\s+)?logger\s+to\s+(.+)/i,
    scaffold: `import { logger } from "@app/logger";\nconst log = logger.child({ module: "$MODULE" });\n// log.info({ ... }, "message")`,
    aiGap: "Insert 2-4 log.info() / log.warn() calls at the right spots in the existing function.",
    estimatedAiTokens: 180,
  },
  {
    id: "vitest-skeleton",
    pattern: /(?:write|add|create)\s+(?:a\s+)?(?:unit\s+)?tests?\s+for\s+(.+)/i,
    scaffold: `import { describe, it, expect } from "vitest";\nimport { $TARGET } from "./$MODULE.js";\n\ndescribe("$TARGET", () => {\n  it("$BEHAVIOR", () => {\n    // ARRANGE ACT ASSERT\n  });\n});`,
    aiGap: "Fill in $BEHAVIOR name + the arrange/act/assert body (3-5 lines).",
    estimatedAiTokens: 220,
  },
  {
    id: "try-catch-with-logging",
    pattern: /wrap\s+(.+?)\s+in\s+try.?catch/i,
    scaffold: `try {\n  $ORIGINAL_BODY\n} catch (err) {\n  log.error({ err }, "$CONTEXT failed");\n  throw err;\n}`,
    aiGap: "Plug $CONTEXT label (one short string).",
    estimatedAiTokens: 80,
  },
  {
    id: "express-handler",
    pattern: /(?:add|create)\s+(?:a\s+)?(?:express|http)\s+(?:handler|route|endpoint)\s+(?:for|to)\s+(.+)/i,
    scaffold: `router.$VERB("$PATH", async (req, res) => {\n  try {\n    const result = await $SERVICE;\n    res.json(result);\n  } catch (err) {\n    res.status(500).json({ error: (err as Error).message });\n  }\n});`,
    aiGap: "Pick $VERB (get/post/...) + $PATH + 2-line $SERVICE call.",
    estimatedAiTokens: 200,
  },
];

export interface RecipeMatch {
  matched: boolean;
  recipeId?: string;
  scaffold?: string;
  aiGap?: string;
  metrics: ReactorMetrics;
}

export function tryRecipe(intent: string): RecipeMatch {
  for (const r of RECIPES) {
    if (r.pattern.test(intent)) {
      const baseline = 1500; // naive AI writes whole snippet from scratch
      const spent = r.estimatedAiTokens + estimateTokens(r.scaffold);
      return {
        matched: true,
        recipeId: r.id,
        scaffold: r.scaffold,
        aiGap: r.aiGap,
        metrics: metricsOf(spent, baseline, `compiled_intent_${r.id}`),
      };
    }
  }
  return { matched: false, metrics: metricsOf(0, 0, "compiled_intent_miss") };
}

// ─── LAYER 4: SHARD CACHE (content-addressed prompt fragments) ─────────
//
// Stamp + hash large prompt fragments. Compatible with Anthropic prompt
// caching (it does its own hashing internally) but explicit hash IDs let
// the caller verify which shards are stable across turns.

const SHARDS_DIR = ".mneme/reactor/shards";

export interface PromptShard {
  id: string;
  content: string;
  sizeChars: number;
  firstSeen: string;
  lastSeen: string;
  reuseCount: number;
}

export function stampShard(repoRoot: string, content: string): PromptShard {
  const id = createHash("sha256").update(content).digest("hex").slice(0, 16);
  const dir = join(repoRoot, SHARDS_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, `${id}.json`);
  const now = new Date().toISOString();
  if (existsSync(path)) {
    try {
      const existing = JSON.parse(readFileSync(path, "utf8")) as PromptShard;
      existing.lastSeen = now;
      existing.reuseCount += 1;
      writeFileSync(path, JSON.stringify(existing, null, 2), "utf8");
      return existing;
    } catch { /* */ }
  }
  const shard: PromptShard = {
    id, content, sizeChars: content.length,
    firstSeen: now, lastSeen: now, reuseCount: 0,
  };
  writeFileSync(path, JSON.stringify(shard, null, 2), "utf8");
  return shard;
}

export interface ShardEnvelope {
  shardId: string;
  /** Tokens that WOULD have been spent re-sending the full content. */
  baselineTokens: number;
  /** Tokens spent referencing the shard by ID. */
  spentTokens: number;
  metrics: ReactorMetrics;
}

/** Replace a large content blob with a small shard reference. Records
 *  savings to the ledger on every call (hit OR miss) so the rollup
 *  reflects total compression activity. */
export function shardEnvelope(repoRoot: string, content: string): ShardEnvelope {
  const shard = stampShard(repoRoot, content);
  const baseline = estimateTokens(content);
  // Spent if cache hit: 16-char id + 20-char wrapper.
  const spent = shard.reuseCount > 0 ? 12 : baseline;
  const metrics = metricsOf(spent, baseline, shard.reuseCount > 0 ? "shard_hit" : "shard_first_emit");
  recordSavings(repoRoot, metrics);
  return {
    shardId: shard.id,
    baselineTokens: baseline,
    spentTokens: spent,
    metrics,
  };
}

// ─── LAYER 6: ATOMIC TOOL FUSION ───────────────────────────────────────
//
// Collapse a sequence of MCP tool calls into one fused call to save
// tool-definition + tool-result envelope overhead.

export interface ToolCall { name: string; args: Record<string, unknown> }

export interface FusionResult {
  fusable: boolean;
  fusedName?: string;
  fusedArgs?: Record<string, unknown>;
  toolsCombined: number;
  metrics: ReactorMetrics;
}

const FUSION_RULES: Array<{ pattern: string[]; fusedName: string }> = [
  { pattern: ["mneme.bot.spawn", "mneme.truth.check"], fusedName: "mneme.atomic.spawn-verify" },
  { pattern: ["mneme.truth.check", "mneme.oracle.forecast"], fusedName: "mneme.atomic.verify-forecast" },
  { pattern: ["mneme.bot.spawn", "mneme.truth.check", "mneme.oracle.forecast"], fusedName: "mneme.atomic.audit" },
];

export function fuseToolCalls(calls: ToolCall[]): FusionResult {
  if (calls.length < 2) return { fusable: false, toolsCombined: calls.length, metrics: metricsOf(0, 0, "fusion_miss") };
  const names = calls.map((c) => c.name);
  for (const rule of FUSION_RULES) {
    if (rule.pattern.length !== names.length) continue;
    if (rule.pattern.every((p, i) => p === names[i])) {
      // Overhead per tool def ~200 tok; envelopes ~80 tok per call.
      const perCallOverhead = 200 + 80;
      const baseline = calls.length * perCallOverhead;
      const spent = perCallOverhead; // single fused call
      return {
        fusable: true,
        fusedName: rule.fusedName,
        fusedArgs: Object.assign({}, ...calls.map((c) => c.args)),
        toolsCombined: calls.length,
        metrics: metricsOf(spent, baseline, `fusion_${rule.fusedName.split(".").pop()}`),
      };
    }
  }
  return { fusable: false, toolsCombined: calls.length, metrics: metricsOf(0, 0, "fusion_no_rule") };
}

// ─── LAYER 7: STREAMING TRUNCATION (certainty checker) ─────────────────
//
// Pure function the caller can poll mid-stream. When confidence is high
// enough the caller signals the vendor to stop generation.

export interface CertaintyCheck {
  shouldStop: boolean;
  confidence: number;
  reason: string;
  metrics: ReactorMetrics;
}

const CERTAINTY_MARKERS = [
  /^(?:answer|verdict|conclusion|in short|therefore|so the answer is):/i,
  /\.$\s*$/m, // trailing period at end of buffer = sentence done
  /```[\s\S]+```/, // closed code block
];

/** Heuristic: when the partial output already contains a closed answer
 *  block (period at end / closed code fence / explicit "answer:" lead),
 *  recommend stop. Also stop if partial > maxTokensSoFar bound. */
export function shouldTruncate(
  partialOutput: string,
  expectedTokens: number,
  opts?: { maxTokens?: number },
): CertaintyCheck {
  const max = opts?.maxTokens ?? expectedTokens * 1.5;
  const currentTokens = estimateTokens(partialOutput);
  let confidence = 0;
  for (const re of CERTAINTY_MARKERS) if (re.test(partialOutput)) confidence += 0.33;
  if (currentTokens >= expectedTokens) confidence += 0.34;
  const stop = confidence >= 0.66 || currentTokens >= max;
  // Savings = expected-tokens not generated.
  const savedIfStop = stop ? Math.max(0, max - currentTokens) : 0;
  return {
    shouldStop: stop,
    confidence: Math.min(1, confidence),
    reason: stop ? `Certainty markers + token budget hit (current=${currentTokens}, expected=${expectedTokens})` : "still streaming",
    metrics: metricsOf(currentTokens, currentTokens + savedIfStop, "stream_truncation"),
  };
}

// ─── LAYER 8: CERTIFICATE TOKEN (ACGV proof reuse) ─────────────────────
//
// Issue a small signed cert that future calls reuse instead of re-verifying.

const CERT_DIR = ".mneme/reactor/certs";

export interface VerificationCert {
  /** Stable id. */
  id: string;
  /** Hashed claim text. */
  claimHash: string;
  /** Verdict from the original ACGV run. */
  verdict: string;
  /** Confidence 0..1. */
  confidence: number;
  issuedAt: string;
  expiresAt: string;
  hmac: string;
}

function certSecret(repoRoot: string): string {
  const dir = join(repoRoot, CERT_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, ".secret");
  if (existsSync(path)) return readFileSync(path, "utf8").trim();
  const s = randomBytes(32).toString("hex");
  writeFileSync(path, s, "utf8");
  return s;
}

export function issueCert(repoRoot: string, claim: string, verdict: string, confidence: number, opts?: { ttlHours?: number }): VerificationCert {
  const ttl = opts?.ttlHours ?? 24;
  const claimHash = createHash("sha256").update(claim).digest("hex").slice(0, 24);
  const id = createHash("sha256").update(`${claimHash}|${verdict}|${Date.now()}`).digest("hex").slice(0, 16);
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttl * 3600 * 1000).toISOString();
  const body = { id, claimHash, verdict, confidence, issuedAt, expiresAt };
  const hmac = createHmac("sha256", certSecret(repoRoot)).update(JSON.stringify(body)).digest("hex").slice(0, 24);
  const cert: VerificationCert = { ...body, hmac };
  const dir = join(repoRoot, CERT_DIR);
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(cert, null, 2), "utf8");
  return cert;
}

export function verifyCert(repoRoot: string, cert: VerificationCert): { valid: boolean; reason: string; metrics: ReactorMetrics } {
  const baseline = 300;
  const { hmac, ...body } = cert;
  const expected = createHmac("sha256", certSecret(repoRoot)).update(JSON.stringify(body)).digest("hex").slice(0, 24);
  if (safeHmacNotEqual(expected, hmac)) {
    return { valid: false, reason: "HMAC mismatch", metrics: metricsOf(0, 0, "cert_invalid") };
  }
  if (Date.parse(cert.expiresAt) < Date.now()) {
    return { valid: false, reason: "expired", metrics: metricsOf(0, 0, "cert_expired") };
  }
  // Reusing the cert costs ~40 tokens (id + verdict label) vs re-verifying (~300 tok).
  return { valid: true, reason: "HMAC + freshness ok", metrics: metricsOf(40, baseline, "cert_reuse") };
}

// ─── LAYER 9: EMBEDDINGS-AS-CONTEXT (compress background prose) ────────
//
// Reduce a 500-token background blob to a 30-token "anchor" (top-3
// keyword summary). For models that accept embedding hints, the savings
// extrapolate further; here we emit the keyword anchor as plaintext.

export interface ContextCompression {
  compressed: string;
  baselineTokens: number;
  spentTokens: number;
  metrics: ReactorMetrics;
}

export function compressContext(chunks: string[], opts?: { keywordsPerChunk?: number }): ContextCompression {
  const k = opts?.keywordsPerChunk ?? 5;
  const baselineText = chunks.join("\n");
  const baseline = estimateTokens(baselineText);
  const keywords: string[] = [];
  for (const chunk of chunks.slice(0, 3)) {
    const tokens = (chunk.toLowerCase().match(/[a-z][a-z0-9_-]+/g) ?? []).filter((t) => t.length >= 5);
    const freq = new Map<string, number>();
    for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([w]) => w);
    keywords.push(top.join(" "));
  }
  const compressed = `[CONTEXT ANCHORS] ${keywords.join(" | ")}`;
  const spent = estimateTokens(compressed);
  return {
    compressed,
    baselineTokens: baseline,
    spentTokens: spent,
    metrics: metricsOf(spent, baseline, "embed_context"),
  };
}

// ─── LAYER 10: TURN-DIFF PROTOCOL (server-side conversation memory) ────
//
// Conversation lives in Mneme. AI client sends only the new user message
// + conversationId. Mneme reconstructs the full history before forwarding.

const TURNS_DIR = ".mneme/reactor/turns";

export interface ConversationTurn { user?: string; ai?: string; ts: string }

export interface Conversation { id: string; turns: ConversationTurn[]; createdAt: string }

function turnPath(repoRoot: string, id: string): string {
  const dir = join(repoRoot, TURNS_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, `${id}.json`);
}

export function startConversation(repoRoot: string): Conversation {
  const id = randomBytes(8).toString("hex");
  const c: Conversation = { id, turns: [], createdAt: new Date().toISOString() };
  writeFileSync(turnPath(repoRoot, id), JSON.stringify(c, null, 2), "utf8");
  return c;
}

export function recordTurn(repoRoot: string, conversationId: string, userMsg: string, aiResp?: string): Conversation | null {
  const path = turnPath(repoRoot, conversationId);
  if (!existsSync(path)) return null;
  try {
    const c = JSON.parse(readFileSync(path, "utf8")) as Conversation;
    c.turns.push({ user: userMsg, ai: aiResp, ts: new Date().toISOString() });
    writeFileSync(path, JSON.stringify(c, null, 2), "utf8");
    return c;
  } catch { return null; }
}

export interface TurnDiffResult {
  conversationId: string;
  fullHistoryTokens: number;
  diffTokens: number;
  diff: string;
  metrics: ReactorMetrics;
}

/** Build the slim "diff payload" the AI client sends instead of full history. */
export function turnDiff(repoRoot: string, conversationId: string, newMessage: string): TurnDiffResult {
  const path = turnPath(repoRoot, conversationId);
  if (!existsSync(path)) {
    return {
      conversationId, fullHistoryTokens: 0, diffTokens: estimateTokens(newMessage),
      diff: newMessage,
      metrics: metricsOf(estimateTokens(newMessage), estimateTokens(newMessage), "turn_diff_new"),
    };
  }
  try {
    const c = JSON.parse(readFileSync(path, "utf8")) as Conversation;
    const fullHistory = c.turns.map((t) => `[U] ${t.user ?? ""}\n[A] ${t.ai ?? ""}`).join("\n");
    const baseline = estimateTokens(fullHistory + "\n" + newMessage);
    const diff = `CONV_REF:${conversationId}\n${newMessage}`;
    const diffTokens = estimateTokens(diff);
    return {
      conversationId,
      fullHistoryTokens: estimateTokens(fullHistory),
      diffTokens,
      diff,
      metrics: metricsOf(diffTokens, baseline, "turn_diff_compact"),
    };
  } catch {
    return {
      conversationId, fullHistoryTokens: 0, diffTokens: estimateTokens(newMessage),
      diff: newMessage,
      metrics: metricsOf(estimateTokens(newMessage), estimateTokens(newMessage), "turn_diff_corrupt"),
    };
  }
}

// ─── LAYER 11: SUMMARY DEBT LEDGER ─────────────────────────────────────
//
// Generate a 1-paragraph summary of a chunk so future references quote
// the summary instead of replaying the content.

const SUMMARY_DIR = ".mneme/reactor/summaries";

export interface Summary {
  id: string;
  source: string;
  summary: string;
  bytesIn: number;
  bytesOut: number;
  createdAt: string;
}

/** Heuristic summarizer: extract first sentence + 3 highest-token-frequency lines. */
export function summarize(content: string, opts?: { source?: string }): { summary: Summary; metrics: ReactorMetrics } {
  const baseline = estimateTokens(content);
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
  const firstSentence = (lines[0] ?? "").split(/[.!?]/)[0]?.trim() ?? "";
  const freq = new Map<string, number>();
  const tokens = (content.toLowerCase().match(/[a-z][a-z0-9_-]+/g) ?? []).filter((t) => t.length >= 5);
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  const topTokens = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w);
  const summaryText = `${firstSentence}. Key topics: ${topTokens.join(", ")}.`;
  const id = createHash("sha256").update(content).digest("hex").slice(0, 16);
  const summary: Summary = {
    id, source: opts?.source ?? "anon",
    summary: summaryText,
    bytesIn: content.length,
    bytesOut: summaryText.length,
    createdAt: new Date().toISOString(),
  };
  return { summary, metrics: metricsOf(estimateTokens(summaryText), baseline, "summary_debt") };
}

export function persistSummary(repoRoot: string, s: Summary): void {
  const dir = join(repoRoot, SUMMARY_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${s.id}.json`), JSON.stringify(s, null, 2), "utf8");
}

export function recallSummary(repoRoot: string, id: string): Summary | null {
  const path = join(repoRoot, SUMMARY_DIR, `${id}.json`);
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")) as Summary; } catch { return null; }
}

// ─── LAYER 12: PRECOG REGRET (retry prevention) ────────────────────────
//
// Predict which prompt patterns lead to AI rewrite cycles + auto-inject
// constraint hints that prevent the retry.

export interface PrecogResult {
  riskScore: number; // 0..1
  predictedRetries: number;
  injectedConstraints: string[];
  metrics: ReactorMetrics;
}

const RETRY_PATTERNS: Array<{ test: RegExp; constraint: string; weight: number }> = [
  { test: /generate.+(?:javascript|typescript|jsx|tsx).+(?:component|class)/i, constraint: "Use functional components, no class syntax; no React.FC type wrapper.", weight: 0.6 },
  { test: /write.+regex/i, constraint: "Provide regex flavor (JS / PCRE / POSIX); include flags explicitly.", weight: 0.5 },
  { test: /(?:add|fix).+(?:lint|eslint|prettier)/i, constraint: "Show ONLY the line/file change, not full file rewrite.", weight: 0.4 },
  { test: /refactor/i, constraint: "Preserve public API + existing test signatures.", weight: 0.5 },
  { test: /implement.+algorithm/i, constraint: "Include complexity (Big-O) + a 3-case test scaffold.", weight: 0.5 },
];

export function precogConstraints(prompt: string): PrecogResult {
  const baseline = 800; // estimated retry cycle adds 800 tok on average
  const constraints: string[] = [];
  let risk = 0;
  for (const r of RETRY_PATTERNS) {
    if (r.test.test(prompt)) {
      constraints.push(r.constraint);
      risk = Math.max(risk, r.weight);
    }
  }
  const predictedRetries = risk > 0.5 ? 1 : 0;
  const spent = estimateTokens(constraints.join(" ")) + 50;
  const savedIfPrevented = predictedRetries * baseline;
  return {
    riskScore: risk,
    predictedRetries,
    injectedConstraints: constraints,
    metrics: metricsOf(spent, spent + savedIfPrevented, "precog_regret"),
  };
}
