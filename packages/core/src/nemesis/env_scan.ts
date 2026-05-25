/**
 * v2.46.0 — NEMESIS ORGAN 1 addon: ENV-SCAN.
 *
 * Each AI coding agent sets a recognizable env var when it spawns
 * child processes. Detecting these is the cheapest + most reliable
 * vendor signal — zero false positives, zero ML needed.
 *
 * Public sources:
 *   CLAUDECODE          = "1"        Claude Code
 *   CLAUDE_CODE_*       =            Claude Code
 *   CURSOR_AGENT        = "1"        Cursor
 *   CURSOR_TRACE_ID                  Cursor
 *   CONTINUE_*                       Continue.dev
 *   GITHUB_COPILOT_*                 GitHub Copilot CLI
 *   COPILOT_AGENT                    Copilot Workspace
 *   AIDER_*                          Aider
 *   GEMINI_CLI                       Gemini CLI
 *   DEVIN_SESSION                    Devin
 *   ANTHROPIC_API_KEY                Claude API
 *   OPENAI_API_KEY                   OpenAI / Codex
 *   CODER_*                          Coder
 *   WINDSURF_*                       Windsurf / Codeium
 *
 * Pure deterministic; reads only the env object passed in (default
 * process.env). NEVER throws.
 */

import type { VendorId } from "./types.js";

interface EnvMarker {
  key: string;
  vendor: VendorId;
  match?: (value: string) => boolean;
}

const MARKERS: EnvMarker[] = [
  { key: "CLAUDECODE", vendor: "claude-code", match: (v) => v === "1" || v.toLowerCase() === "true" },
  { key: "CLAUDE_CODE_ENTRYPOINT", vendor: "claude-code" },
  { key: "CLAUDE_CODE_SSE_PORT", vendor: "claude-code" },
  { key: "CURSOR_AGENT", vendor: "cursor", match: (v) => v === "1" || v.toLowerCase() === "true" },
  { key: "CURSOR_TRACE_ID", vendor: "cursor" },
  { key: "COPILOT_AGENT", vendor: "copilot" },
  { key: "GH_COPILOT_TOKEN", vendor: "copilot" },
  { key: "GITHUB_COPILOT_CLI", vendor: "copilot" },
  { key: "DEVIN_SESSION", vendor: "devin" },
  { key: "DEVIN_API_KEY", vendor: "devin" },
  // Codex CLI uses OpenAI's CLI ARG conventions but env shape is OPENAI_*
  // We only flag codex when OPENAI_API_KEY + a CODEX-specific marker.
  { key: "OPENAI_CODEX", vendor: "codex" },
  { key: "CODEX_AGENT", vendor: "codex" },
  // v2.56.0 — xAI Grok env markers (Grok Code Fast / Grok CLI / Grok Heavy)
  { key: "GROK_API_KEY", vendor: "grok" as VendorId },
  { key: "XAI_API_KEY", vendor: "grok" as VendorId },
  { key: "GROK_CLI", vendor: "grok-cli" as VendorId },
  { key: "GROK_CODE_FAST", vendor: "grok-code-fast" as VendorId },
  { key: "GROK_AGENT", vendor: "grok" as VendorId },
];

export interface EnvScanResult {
  vendor: VendorId;
  /** Confidence ∈ [0, 1]. */
  confidence: number;
  /** Per-marker evidence. */
  evidence: Array<{ key: string; value: string; vendor: VendorId }>;
}

export function scanEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): EnvScanResult {
  const evidence: EnvScanResult["evidence"] = [];
  const perVendor: Partial<Record<VendorId, number>> = {};
  try {
    for (const m of MARKERS) {
      const v = env[m.key];
      if (typeof v !== "string" || v.length === 0) continue;
      if (m.match && !m.match(v)) continue;
      evidence.push({ key: m.key, value: v.slice(0, 32), vendor: m.vendor });
      perVendor[m.vendor] = (perVendor[m.vendor] ?? 0) + 1;
    }
  } catch { /* defensive */ }

  if (evidence.length === 0) {
    return { vendor: "unknown", confidence: 0, evidence: [] };
  }

  // Pick the vendor with the most distinct markers.
  let top: VendorId = "unknown";
  let topN = 0;
  for (const [v, n] of Object.entries(perVendor)) {
    if ((n ?? 0) > topN) { topN = n ?? 0; top = v as VendorId; }
  }
  const total = Object.values(perVendor).reduce((a, b) => a + (b ?? 0), 0);
  const confidence = total === 0 ? 0 : topN / total;
  return { vendor: top, confidence, evidence };
}
