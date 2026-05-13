/**
 * v2.1.0 -- TOOL SELECTOR · smart intent → tool router (THE FIX for "AI picks wrong tool")
 *
 * User's exact worry: "Mneme ships 100+ tools. AI agents pick the wrong
 * one, customer gets angry. How do we make sure the AI always picks
 * RIGHT?"
 *
 * Vanilla AI: scans tool descriptions, picks one that "looks relevant."
 * Probabilistic + opaque + flaky.
 *
 * TOOL SELECTOR: deterministic, auditable, fuzzy-Thai/English/mixed.
 *
 *   selectTool({userIntent: "ส่งสมองไปมือถือ", catalog, ctx})
 *     → ranked candidates with confidence + reasoning trace
 *     → COMMIT (≥0.75): call it
 *     → CONFIRM (0.40-0.75): ask user to confirm
 *     → MENU (<0.40): show menu
 *
 * Pure function. Same input → same selection. The AI agent doesn't
 * pick the tool — Mneme picks it FOR the AI based on math.
 */

export interface ToolEntry {
  /** Tool name, e.g. "mneme.rainbow.show_local". */
  name: string;
  /** Category for grouping: memory / people / audit / forensics / ... */
  category: string;
  /** One-line description for AI agents. */
  description: string;
  /** Trigger keywords / phrases (Thai/English/mixed). When user intent
   *  contains any of these, the tool wins votes. */
  triggers: string[];
  /** "Use this when..." rule that should match the user's intent semantically. */
  whenToUse: string;
  /** Example user phrases that should resolve to this tool. */
  examples: string[];
  /** Optional list of tool names that are alternatives / preferred companions. */
  prefer?: string[];
  /** Optional list of tool names that should NOT be paired. */
  conflictsWith?: string[];
  /** Prior probability when no signals match. Default 1/N. */
  prior?: number;
}

export interface SelectorContext {
  /** Previous tool the AI agent called this session — boosts related tools. */
  recentTools?: string[];
  /** User's preferred output kind (text / file / qr / browser). */
  outputPreference?: string;
  /** Active features the user has opted into. */
  enabledFeatures?: string[];
}

export interface ToolCandidate {
  tool: ToolEntry;
  /** Combined posterior 0..1. */
  confidence: number;
  /** Which triggers matched. */
  matchedTriggers: string[];
  /** Per-signal breakdown. */
  signals: { triggerMatch: number; recencyBoost: number; preferBoost: number; conflictPenalty: number };
}

export interface SelectorResult {
  /** Top candidate. Null when catalog is empty. */
  top: ToolCandidate | null;
  /** Ranked candidates, descending. */
  ranked: ToolCandidate[];
  /** Decision based on top confidence. */
  verdict: "COMMIT" | "CONFIRM" | "MENU" | "EMPTY";
  /** Why we chose this verdict. */
  reasoning: string;
}

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFC").replace(/[​‌‍﻿]/g, "");
}

function triggerMatchScore(intent: string, triggers: readonly string[]): { score: number; matches: string[] } {
  const intentN = normalize(intent);
  const matches: string[] = [];
  let score = 0;
  for (const t of triggers) {
    if (!t) continue;
    const tn = normalize(t);
    if (intentN.includes(tn)) {
      matches.push(t);
      // Longer matches contribute more (more specific keyword). A single
      // specific keyword (≥6 chars) already wins ~1.0; additional matches
      // saturate the score.
      score += Math.min(1, tn.length / 6);
    }
  }
  return { score: Math.min(1, score), matches };
}

function recencyBoost(toolName: string, recent: readonly string[] | undefined): number {
  if (!recent || recent.length === 0) return 0;
  const idx = recent.indexOf(toolName);
  if (idx === -1) return 0;
  return Math.max(0, 0.10 - idx * 0.04);
}

export interface SelectInput {
  userIntent: string;
  catalog: readonly ToolEntry[];
  ctx?: SelectorContext;
}

export function selectTool(input: SelectInput): SelectorResult {
  if (input.catalog.length === 0) {
    return { top: null, ranked: [], verdict: "EMPTY", reasoning: "no tools in catalog" };
  }

  const ctx = input.ctx ?? {};
  const N = input.catalog.length;

  const scored: ToolCandidate[] = input.catalog.map((tool) => {
    const { score: triggerMatch, matches } = triggerMatchScore(input.userIntent, tool.triggers);
    const recBoost = recencyBoost(tool.name, ctx.recentTools);
    let preferBoost = 0;
    let conflictPenalty = 0;
    if (ctx.recentTools && tool.prefer) {
      for (const r of ctx.recentTools) if (tool.prefer.includes(r)) preferBoost += 0.05;
    }
    if (ctx.recentTools && tool.conflictsWith) {
      for (const r of ctx.recentTools) if (tool.conflictsWith.includes(r)) conflictPenalty += 0.10;
    }
    const prior = tool.prior ?? 1 / N;
    const raw = prior * 0.10 + triggerMatch * 0.80 + recBoost + preferBoost - conflictPenalty;
    const confidence = Math.max(0, Math.min(1, raw));

    return { tool, confidence, matchedTriggers: matches, signals: { triggerMatch, recencyBoost: recBoost, preferBoost, conflictPenalty } };
  });

  scored.sort((a, b) => b.confidence - a.confidence);
  const top = scored[0]!;
  let verdict: SelectorResult["verdict"];
  let reasoning: string;
  if (top.confidence >= 0.75) {
    verdict = "COMMIT";
    reasoning = `top tool ${top.tool.name} has confidence ${top.confidence.toFixed(2)} ≥ 0.75 — call it`;
  } else if (top.confidence >= 0.40) {
    verdict = "CONFIRM";
    reasoning = `top tool ${top.tool.name} has confidence ${top.confidence.toFixed(2)} in 0.40-0.75 range — ask user to confirm`;
  } else {
    verdict = "MENU";
    reasoning = `top confidence ${top.confidence.toFixed(2)} below 0.40 — show user a menu`;
  }
  return { top, ranked: scored, verdict, reasoning };
}

export function formatSelectorPulseLine(r: SelectorResult): string {
  if (!r.top) return "TOOL-SELECTOR · EMPTY · no tools";
  return `TOOL-SELECTOR · ${r.verdict} · top=${r.top.tool.name}(${r.top.confidence.toFixed(2)}) · triggers=[${r.top.matchedTriggers.slice(0, 3).join(",")}]`;
}

export function formatConfirmationPrompt(r: SelectorResult): string {
  if (!r.top) return "I don't have a tool that matches what you asked. Could you rephrase?";
  if (r.verdict === "COMMIT") return `Running '${r.top.tool.name}'.`;
  if (r.verdict === "CONFIRM") {
    const runners = r.ranked.slice(1, 3).map((c) => `${c.tool.name} (${c.confidence.toFixed(2)})`).join(" · ");
    return `About to call '${r.top.tool.name}' (confidence ${r.top.confidence.toFixed(2)}). Other plausible: ${runners}. Confirm or say which one.`;
  }
  const lines = r.ranked.slice(0, 5).map((c, i) => `  ${i + 1}. ${c.tool.name} — ${c.tool.whenToUse}`);
  return `Not sure which tool fits. Pick one:\n${lines.join("\n")}`;
}

/** Starter catalog covering the most-misrouted tools. AI agents should
 *  EXTEND with the full 100+ catalog from `mneme.capabilities`. */
export const STARTER_CATALOG: ToolEntry[] = [
  {
    name: "mneme.clone.to",
    category: "rainbow",
    description: "Clone brain to another AI / device.",
    triggers: ["ส่งสมอง", "ส่งความจำ", "ย้าย mneme", "clone", "send brain", "sync", "share mneme", "โคลน", "ก๊อปไป", "brain to"],
    whenToUse: "user wants to send/clone/sync their brain to another AI agent or device",
    examples: ['"ส่งสมองไปมือถือ"', '"clone brain to gemini"'],
  },
  {
    name: "mneme.flash.run",
    category: "flash",
    description: "Anti-hallucination V_eff scan before stating a factual claim.",
    triggers: ["rare", "rarity", "really rare", "is it authentic", "verify", "is this true", "หายากไหม", "ของจริงไหม", "authenticity"],
    whenToUse: "user makes a factual claim or asks AI to confirm one",
    examples: ['"is this card really rare?"'],
  },
  {
    name: "mneme.passport.issue",
    category: "passport",
    description: "Issue HMAC-signed eternal passport bundle.",
    triggers: ["passport", "export my context", "save my brain", "พาสปอร์ต"],
    whenToUse: "user wants to export portable identity for cross-vendor use",
    examples: ['"issue my passport"'],
  },
  {
    name: "mneme.bloodline.report",
    category: "bloodline",
    description: "Show personal AI genetic strain — DNA fingerprint + σ deviations.",
    triggers: ["bloodline", "my dna", "personality report", "my strain", "ลายนิ้วมือ"],
    whenToUse: "user asks how their Mneme has evolved vs baseline",
    examples: ['"show my AI dna"'],
  },
  {
    name: "mneme.mutiny.check",
    category: "mutiny",
    description: "Check if request matches documented historical regret.",
    triggers: ["use redis", "tighten jwt", "ใช้ redis"],
    whenToUse: "before any destructive / 'let's try X again' change",
    examples: ['"let me use Redis for sessions"'],
  },
  {
    name: "mneme.memory.ask",
    category: "memory",
    description: "Semantic Q&A against the memory store + AI synthesis.",
    triggers: ["what changed", "why did we", "who wrote", "เปลี่ยนอะไร", "ทำไม"],
    whenToUse: "user asks 'what/why/who' about the codebase",
    examples: ['"why did we migrate to postgres?"'],
  },
  {
    name: "mneme.audit.certify",
    category: "audit",
    description: "5-axis CI trust gate (PASS/WARN/FAIL).",
    triggers: ["certify", "audit", "trust gate", "ตรวจสอบ"],
    whenToUse: "before merging an AI-written commit",
    examples: ['"certify this commit"'],
  },
  {
    name: "mneme.qx.run_quantum",
    category: "quantum",
    description: "Run quantum circuit on simulator or real cloud.",
    triggers: ["quantum", "qubit", "bell pair", "grover", "qasm", "ควอนตัม"],
    whenToUse: "user provides quantum circuit or asks for famous circuit",
    examples: ['"run a bell pair"'],
  },
  {
    name: "mneme.system.upgrade",
    category: "system",
    description: "Upgrade Mneme to latest npm version.",
    triggers: ["upgrade mneme", "update mneme", "อัปเกรด mneme", "อัพเดท mneme"],
    whenToUse: "user wants newer Mneme version",
    examples: ['"upgrade Mneme"'],
  },
];
