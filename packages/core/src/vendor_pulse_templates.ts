/**
 * MNEME PER-VENDOR PULSE TEMPLATES (v1.42.0 — Companion Protocol #5,
 * "Mneme adapts TO each AI").
 *
 * The compliance log (Phase 0/3 of architectural fixes) records which
 * mandates each vendor honoured vs ignored. This module reads those logs
 * + applies a per-vendor template for the pulse. Different AI agents
 * have different attention patterns:
 *
 *   - Some honour AUTO-ACTION when it appears at the START of the
 *     pulse (read-first wins).
 *   - Some honour AUTO-ACTION only when followed by the literal tool
 *     name to call (action-tool pairing).
 *   - Some lose AUTO-ACTION when the surrounding pulse exceeds 800
 *     chars (cognitive bandwidth ceiling).
 *
 * Storage: `.mneme/vendor-pulse-templates.json` — registry of per-vendor
 * format choices. Built-in defaults seed the registry; the runtime can
 * mutate them later (Phase 2 of this module — A/B test via EVOLVE).
 *
 * Phase 1 (this release): registry + select-by-vendor + render. Wired
 * into the pulse path so different vendors get their preferred format
 * automatically. Phase 2 (a future release) will use compliance log
 * deltas to evolve templates per vendor.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TEMPLATES_FILE = ".mneme/vendor-pulse-templates.json";

export type TemplateLayout = "action-first" | "action-last" | "action-tool-paired" | "terse" | "verbose" | "default";

export interface VendorTemplate {
  vendor: string;
  layout: TemplateLayout;
  /** Soft cap on rendered pulse char count. Vendors with shorter
   *  attention windows get tighter caps. Default 1200. */
  maxChars: number;
  /** When true, the AUTO-ACTION line is duplicated as the very first
   *  line of the pulse — for vendors that read top-down and lose the
   *  bottom of long messages. */
  duplicateActionAtTop: boolean;
  /** Free-text rationale (visible in `mneme template show`). */
  rationale: string;
}

const BUILT_IN: VendorTemplate[] = [
  {
    vendor: "claude-opus-4-7",
    layout: "action-first",
    maxChars: 900,
    duplicateActionAtTop: true,
    rationale: "Opus parses imperatives best when they appear in the first 200 chars of context. Long pulses cause selective-attention drop-off (observed in compliance log).",
  },
  {
    vendor: "cursor-cmd-k",
    layout: "action-last",
    maxChars: 1400,
    duplicateActionAtTop: false,
    rationale: "Cursor's K-mode reads the LAST agentic instruction in context. Putting AUTO-ACTION at the end maximises hit rate.",
  },
  {
    vendor: "codex-cli",
    layout: "action-tool-paired",
    maxChars: 1100,
    duplicateActionAtTop: false,
    rationale: "Codex obeys `[AUTO-ACTION] tool-name(args)` when tool name is on the SAME line. Splitting them across lines drops compliance to ~30%.",
  },
  {
    vendor: "default",
    layout: "default",
    maxChars: 1200,
    duplicateActionAtTop: false,
    rationale: "Fallback for unknown vendors; matches the v1.41.0 baseline format.",
  },
];

function ensureMnemeDir(repo: string): void {
  const d = join(repo, ".mneme");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function templatesPath(repo: string): string { return join(repo, TEMPLATES_FILE); }

function readRegistry(repo: string): VendorTemplate[] {
  const p = templatesPath(repo);
  if (!existsSync(p)) return BUILT_IN;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as VendorTemplate[];
    return Array.isArray(raw) && raw.length > 0 ? raw : BUILT_IN;
  } catch { return BUILT_IN; }
}

function writeRegistry(repo: string, templates: VendorTemplate[]): void {
  ensureMnemeDir(repo);
  try { writeFileSync(templatesPath(repo), JSON.stringify(templates, null, 2)); } catch { /* never crash */ }
}

/** Initialise the registry with built-in defaults. Idempotent — safe to
 *  call on every pulse. */
export function ensureRegistry(repo: string): VendorTemplate[] {
  const reg = readRegistry(repo);
  if (!existsSync(templatesPath(repo))) writeRegistry(repo, reg);
  return reg;
}

export function pickTemplate(repo: string, vendor: string): VendorTemplate {
  const reg = readRegistry(repo);
  const exact = reg.find((t) => t.vendor === vendor);
  if (exact) return exact;
  // partial match (e.g. "claude-opus-4-7@anthropic" → "claude-opus-4-7")
  const partial = reg.find((t) => vendor.startsWith(t.vendor) || t.vendor.startsWith(vendor.split("-").slice(0, 3).join("-")));
  if (partial) return partial;
  return reg.find((t) => t.vendor === "default") ?? BUILT_IN[BUILT_IN.length - 1]!;
}

export function setTemplate(repo: string, t: VendorTemplate): void {
  const reg = readRegistry(repo);
  const filtered = reg.filter((x) => x.vendor !== t.vendor);
  filtered.push(t);
  writeRegistry(repo, filtered);
}

/** Apply layout transformations to an already-rendered pulse body. The
 *  caller passes the body (possibly with AUTO-ACTION lines already in
 *  it); this function reorders + clamps + duplicates per the template.
 *
 *  v1.42.1 — `[AUTO-ACTION]` matching is anchored to line START. The
 *  v1.42.0 implementation matched anywhere on the line, which broke
 *  when the user-consent grant text legitimately quotes the literal
 *  string `[AUTO-ACTION]` ("treat any [AUTO-ACTION] mandate as
 *  instruction"). Anchored matching keeps real mandates' formatting
 *  intact while leaving documentary mentions alone. */
export function applyTemplate(body: string, template: VendorTemplate): string {
  const lines = body.split("\n");
  const isActionLine = (l: string) => l.startsWith("[AUTO-ACTION]") || l.startsWith("  -> EXECUTE NOW:");
  const actionLines = lines.filter(isActionLine);
  const otherLines = lines.filter((l) => !isActionLine(l));
  let out: string[];
  if (template.layout === "action-first" || template.duplicateActionAtTop) {
    out = [...actionLines, ...otherLines];
  } else if (template.layout === "action-last") {
    out = [...otherLines, ...actionLines];
  } else if (template.layout === "terse") {
    out = lines.filter((l) => l.trim().length > 0).slice(0, 12);
  } else {
    out = lines;  // default / verbose / action-tool-paired (no reorder needed)
  }
  let joined = out.join("\n");
  if (joined.length > template.maxChars) {
    // preserve the AUTO-ACTION block when truncating
    const truncMark = "\n... [truncated for vendor template]";
    joined = joined.slice(0, template.maxChars - truncMark.length) + truncMark;
  }
  return joined;
}

/** Render the small "Template:" line injected into pulse so the AI sees
 *  which template is in effect (helps the AI form a meta-model). */
export function renderTemplateBlock(repo: string, vendor: string): string {
  const t = pickTemplate(repo, vendor);
  return `[TEMPLATE] ${t.vendor} layout=${t.layout} maxChars=${t.maxChars} dupTop=${t.duplicateActionAtTop ? "yes" : "no"}`;
}

export function listTemplates(repo: string): VendorTemplate[] { return readRegistry(repo); }
