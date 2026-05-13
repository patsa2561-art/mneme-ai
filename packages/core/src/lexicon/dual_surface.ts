/**
 * v2.3.0 -- LEXICON · Phase A · Dual-Surface translator.
 *
 * The CORE: take any text (tool name / description / metadata) +
 * a vendor profile → return the same text with demonic→neutral
 * rewrites applied. Apply policy: literal (case-sensitive substring),
 * regex (RegExp.source), or word (word-boundary regex).
 *
 * Pure function. Deterministic. Same input → same output. Zero
 * external deps. Composes with everything else in Mneme.
 */

import type { LexiconProfile, LexiconRule } from "./mappings.js";

export interface TuneResult {
  before: string;
  after: string;
  appliedRules: Array<{ from: string; to: string; hits: number }>;
  /** Whether the output differs from input. */
  changed: boolean;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyRule(text: string, rule: LexiconRule): { text: string; hits: number } {
  const policy = rule.policy ?? "literal";
  if (text.length === 0 || rule.from.length === 0) return { text, hits: 0 };
  let hits = 0;
  let out: string;
  if (policy === "regex") {
    try {
      const re = new RegExp(rule.from, "g");
      out = text.replace(re, () => { hits++; return rule.to; });
    } catch {
      return { text, hits: 0 };
    }
  } else if (policy === "word") {
    try {
      const re = new RegExp(`\\b${escapeRegex(rule.from)}\\b`, "g");
      out = text.replace(re, () => { hits++; return rule.to; });
    } catch {
      return { text, hits: 0 };
    }
  } else {
    // literal — case-sensitive include + global replace using split/join
    if (!text.includes(rule.from)) return { text, hits: 0 };
    hits = text.split(rule.from).length - 1;
    out = text.split(rule.from).join(rule.to);
  }
  return { text: out, hits };
}

export function tuneText(text: string, profile: LexiconProfile): TuneResult {
  let cur = text;
  const applied: TuneResult["appliedRules"] = [];
  for (const rule of profile.rules) {
    const r = applyRule(cur, rule);
    if (r.hits > 0) {
      applied.push({ from: rule.from, to: rule.to, hits: r.hits });
      cur = r.text;
    }
  }
  return { before: text, after: cur, appliedRules: applied, changed: cur !== text };
}

// ============================================================
// Dual-Surface Tool registry
// ============================================================

export interface ToolHandler<I = unknown, O = unknown> {
  (input: I): O | Promise<O>;
}

export interface DualSurfaceTool<I = unknown, O = unknown> {
  /** Internal canonical name — used in code, docs, README, branding. */
  internalName: string;
  /** Demon-mode description (shown in user-facing docs, NEVER to vendor). */
  internalDescription: string;
  /** Optional EXPLICIT vendor-facing name. If omitted, tuneText is applied. */
  externalName?: string;
  /** Optional EXPLICIT vendor-facing description. If omitted, tuneText is applied. */
  externalDescription?: string;
  /** Same handler for both names. Behavior is IDENTICAL — only labels differ. */
  handler: ToolHandler<I, O>;
  /** Trigger keywords for TOOL SELECTOR. Already in user/neutral language. */
  triggers?: string[];
  /** Optional opt-out flag (Phase D) — skip translation for this specific tool. */
  preserveNames?: boolean;
}

export interface RegisteredTool<I = unknown, O = unknown> {
  /** What the vendor / MCP client sees. */
  exposedName: string;
  exposedDescription: string;
  /** What internal code references. */
  internalName: string;
  internalDescription: string;
  triggers: string[];
  handler: ToolHandler<I, O>;
  /** Tuning trace — which rules fired. */
  tuneTrace: { name: TuneResult; description: TuneResult };
}

/** Apply a profile to a DualSurfaceTool. Pure function. */
export function tuneTool<I, O>(tool: DualSurfaceTool<I, O>, profile: LexiconProfile): RegisteredTool<I, O> {
  // Phase D — per-tool toggle: if preserveNames=true, skip translation entirely.
  if (tool.preserveNames) {
    return {
      exposedName: tool.externalName ?? tool.internalName,
      exposedDescription: tool.externalDescription ?? tool.internalDescription,
      internalName: tool.internalName,
      internalDescription: tool.internalDescription,
      triggers: tool.triggers ?? [],
      handler: tool.handler,
      tuneTrace: {
        name: { before: tool.internalName, after: tool.internalName, appliedRules: [], changed: false },
        description: { before: tool.internalDescription, after: tool.internalDescription, appliedRules: [], changed: false },
      },
    };
  }
  const nameTune = tool.externalName
    ? { before: tool.internalName, after: tool.externalName, appliedRules: [], changed: tool.externalName !== tool.internalName }
    : tuneText(tool.internalName, profile);
  const descTune = tool.externalDescription
    ? { before: tool.internalDescription, after: tool.externalDescription, appliedRules: [], changed: tool.externalDescription !== tool.internalDescription }
    : tuneText(tool.internalDescription, profile);
  return {
    exposedName: nameTune.after,
    exposedDescription: descTune.after,
    internalName: tool.internalName,
    internalDescription: tool.internalDescription,
    triggers: tool.triggers ?? [],
    handler: tool.handler,
    tuneTrace: { name: nameTune, description: descTune },
  };
}

export function tuneCatalog<I, O>(catalog: readonly DualSurfaceTool<I, O>[], profile: LexiconProfile): RegisteredTool<I, O>[] {
  return catalog.map((t) => tuneTool(t, profile));
}

/** Compact one-line summary for the pulse. */
export function formatLexiconPulseLine(profile: LexiconProfile, tuned: readonly RegisteredTool[]): string {
  const totalRules = tuned.reduce((s, t) => s + t.tuneTrace.name.appliedRules.length + t.tuneTrace.description.appliedRules.length, 0);
  const changed = tuned.filter((t) => t.tuneTrace.name.changed || t.tuneTrace.description.changed).length;
  return `LEXICON · profile=${profile.name} · ${changed}/${tuned.length} tools tuned · ${totalRules} rule-hits`;
}
