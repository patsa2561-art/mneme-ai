/**
 * Iris — AI-summarized headline generator.
 *
 * Goal: every command leads with a 1-line, ~12-word, scannable headline.
 *
 * Strategy:
 *   1. If an enricher is provided AND we don't have a cached headline for the
 *      same {commandType, data} fingerprint → call the LLM with a strict
 *      prompt and a hard timeout (default 800ms). Cache the result.
 *   2. Otherwise → fall back to a deterministic *extractive* headline built
 *      from the data alone.  Never throws.
 *
 * Cache: `.mneme/iris-headlines.json` (keyed by SHA-1 of `{type,data}`),
 * 7-day TTL.  Atomic write (temp file + rename).
 *
 * The LLM is strictly optional and never blocks the user's command — if it's
 * slow, missing, or errors, we silently fall back to the extractive headline.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export type HeadlineCommandType =
  | "ask"
  | "forensics"
  | "quant"
  | "insight"
  | "guard"
  | "do"
  | "status"
  | "generic";

export interface HeadlineEnricher {
  name: string;
  enrich(input: {
    system: string;
    user: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<{ text: string }>;
}

export interface HeadlineRequest {
  /** Type of command for prompt context. */
  commandType: HeadlineCommandType;
  /** Raw structured data from the command (small — abstracts only). */
  data: Record<string, unknown>;
  /** Existing enricher; if undefined, falls back to extractive headline. */
  enricher?: HeadlineEnricher;
  /** Hard timeout for the LLM call (default 800ms — never block the user). */
  timeoutMs?: number;
  /** Repo root for cache file. If undefined, cache is disabled. */
  repoRoot?: string;
  /** Override the current time (test seam). */
  nowMs?: number;
}

/** Verbatim system prompt — keep tight, do not "improve". */
export const HEADLINE_SYSTEM_PROMPT = `You write 1-line headlines for terminal CLI output. ~12 words max.
Rules:
  • Lead with the most actionable fact (number, severity, action).
  • No buzzwords ("leveraging", "robust"). No emoji. No quotes.
  • Past tense for finished work; imperative for warnings.
Examples:
  "3 critical anomalies — verify alice@bank.com identity"
  "Clean shipping history; no firefighting periods detected"
  "Memory layer ready; 5,000 commits indexed in 12 seconds"`;

const DEFAULT_TIMEOUT_MS = 800;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CacheEntry {
  /** ISO timestamp written. */
  at: string;
  /** Headline text. */
  text: string;
}

interface CacheFile {
  version: 1;
  entries: Record<string, CacheEntry>;
}

function cachePath(repoRoot: string): string {
  return join(repoRoot, ".mneme", "iris-headlines.json");
}

function fingerprint(commandType: string, data: Record<string, unknown>): string {
  // Stable JSON: sort keys recursively for deterministic hashes.
  const stable = stableStringify({ t: commandType, d: data });
  return createHash("sha1").update(stable).digest("hex").slice(0, 16);
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function readCache(path: string): CacheFile {
  if (!existsSync(path)) return { version: 1, entries: {} };
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as CacheFile;
    if (parsed && typeof parsed === "object" && parsed.version === 1 && parsed.entries) {
      return parsed;
    }
  } catch {
    /* corrupt — start fresh */
  }
  return { version: 1, entries: {} };
}

function atomicWrite(path: string, contents: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      return;
    }
  }
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  try {
    writeFileSync(tmp, contents, "utf8");
    renameSync(tmp, path);
  } catch {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
  }
}

function getCached(
  repoRoot: string | undefined,
  key: string,
  nowMs: number,
): string | undefined {
  if (!repoRoot) return undefined;
  const cache = readCache(cachePath(repoRoot));
  const entry = cache.entries[key];
  if (!entry) return undefined;
  const at = Date.parse(entry.at);
  if (Number.isNaN(at) || nowMs - at > CACHE_TTL_MS) return undefined;
  return entry.text;
}

function setCached(repoRoot: string | undefined, key: string, text: string, nowMs: number): void {
  if (!repoRoot) return;
  const path = cachePath(repoRoot);
  const cache = readCache(path);
  // Garbage-collect expired entries while we're here (cheap).
  for (const [k, v] of Object.entries(cache.entries)) {
    const at = Date.parse(v.at);
    if (Number.isNaN(at) || nowMs - at > CACHE_TTL_MS) {
      delete cache.entries[k];
    }
  }
  cache.entries[key] = { at: new Date(nowMs).toISOString(), text };
  atomicWrite(path, JSON.stringify(cache, null, 2));
}

/** Sanitize an LLM headline: trim, strip quotes/emoji-ish chars, single line. */
export function sanitizeHeadline(raw: string): string {
  let s = raw.trim();
  // Take the first non-empty line.
  s = s.split(/\r?\n/).find((l) => l.trim().length > 0) ?? s;
  s = s.trim();
  // Strip wrapping quotes.
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  // Drop obvious emoji/symbol prefixes the model added despite the rule.
  s = s.replace(/^[\u{1F300}-\u{1FAFF}☀-➿←-⇿]+\s*/u, "");
  // Cap length defensively.
  if (s.length > 140) s = `${s.slice(0, 137)}…`;
  return s;
}

/** Build a deterministic extractive headline when no LLM is available. */
export function extractiveHeadline(
  commandType: HeadlineCommandType,
  data: Record<string, unknown>,
): string {
  const num = (k: string): number | undefined => {
    const v = data[k];
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  };
  const str = (k: string): string | undefined => {
    const v = data[k];
    return typeof v === "string" && v.length > 0 ? v : undefined;
  };

  switch (commandType) {
    case "forensics": {
      const crit = num("criticalCount") ?? 0;
      const high = num("highCount") ?? 0;
      const total = num("totalCount") ?? crit + high;
      if (crit > 0) {
        const subj = str("topSubject") ?? "review immediately";
        return `${crit} critical anomal${crit === 1 ? "y" : "ies"} — ${subj}`;
      }
      if (high > 0) return `${high} high-severity finding${high === 1 ? "" : "s"} to review`;
      if (total > 0) return `${total} low-severity item${total === 1 ? "" : "s"}; nothing critical`;
      return "Clean forensics scan; no anomalies detected";
    }
    case "quant": {
      const metric = str("metric") ?? "metric";
      const value = str("value") ?? num("value")?.toString() ?? "computed";
      const trend = str("trend");
      return trend ? `${metric} ${value} (trend: ${trend})` : `${metric} ${value}`;
    }
    case "insight": {
      const n = num("count") ?? 0;
      const top = str("topInsight");
      if (top) return `${n} insight${n === 1 ? "" : "s"} — ${top}`;
      return `${n} insight${n === 1 ? "" : "s"} surfaced from history`;
    }
    case "guard": {
      const blocked = num("blockedCount") ?? 0;
      const warned = num("warnedCount") ?? 0;
      if (blocked > 0) return `${blocked} change${blocked === 1 ? "" : "s"} blocked — review before merge`;
      if (warned > 0) return `${warned} warning${warned === 1 ? "" : "s"}; safe to merge with care`;
      return "Guard passed; no risky changes detected";
    }
    case "do": {
      const action = str("action") ?? "task";
      const result = str("result") ?? "done";
      return `${action} — ${result}`;
    }
    case "status": {
      const indexed = num("commitsIndexed");
      const ms = num("durationMs");
      if (indexed != null && ms != null) {
        return `Memory layer ready; ${indexed.toLocaleString()} commits indexed in ${(ms / 1000).toFixed(1)}s`;
      }
      return str("summary") ?? "Status ready";
    }
    case "ask": {
      const conf = str("confidence") ?? "unknown";
      const ev = num("evidenceCount") ?? 0;
      return `Answer ready — ${conf} confidence, ${ev} citation${ev === 1 ? "" : "s"}`;
    }
    case "generic":
    default: {
      const summary = str("summary") ?? str("title");
      if (summary) return summary;
      return "Command completed";
    }
  }
}

/** Race a promise against a timeout. Resolves to undefined on timeout. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(undefined);
      }
    }, ms);
    p.then(
      (v) => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolve(v);
        }
      },
      () => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolve(undefined);
        }
      },
    );
  });
}

/** Build a small "user prompt" describing the command output for the LLM. */
function buildUserPrompt(commandType: HeadlineCommandType, data: Record<string, unknown>): string {
  return [
    `Command: mneme ${commandType}`,
    `Data: ${stableStringify(data)}`,
    "",
    "Write the 1-line headline.",
  ].join("\n");
}

/**
 * Generate a headline for a command result.  Never throws.
 *
 * Always returns a non-empty string.
 */
export async function generateHeadline(req: HeadlineRequest): Promise<string> {
  const fallback = extractiveHeadline(req.commandType, req.data);
  const nowMs = req.nowMs ?? Date.now();
  const key = fingerprint(req.commandType, req.data);

  // Cache hit short-circuits everything.
  const cached = getCached(req.repoRoot, key, nowMs);
  if (cached) return cached;

  if (!req.enricher) return fallback;

  try {
    const text = await withTimeout(
      req.enricher.enrich({
        system: HEADLINE_SYSTEM_PROMPT,
        user: buildUserPrompt(req.commandType, req.data),
        temperature: 0.2,
        maxTokens: 64,
      }),
      req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    if (!text || !text.text || text.text.trim().length === 0) return fallback;
    const cleaned = sanitizeHeadline(text.text);
    if (cleaned.length === 0) return fallback;
    setCached(req.repoRoot, key, cleaned, nowMs);
    return cleaned;
  } catch {
    return fallback;
  }
}

/** Test-only export: clear all entries in the cache file. */
export function clearHeadlineCache(repoRoot: string): void {
  const path = cachePath(repoRoot);
  if (!existsSync(path)) return;
  try {
    rmSync(path, { force: true });
  } catch {
    /* ignore */
  }
}
