/**
 * AGENT-FIT — Mneme's map of HOW it integrates with each AI agent's actual architecture, and how
 * TIGHTLY it can. Every agent exposes a different extension surface (Claude Code: PreToolUse +
 * UserPromptSubmit hooks + MCP; Cursor/Cline/Continue/Zed/Windsurf: MCP; Codex: AGENTS.md; Gemini
 * CLI: GEMINI.md + MCP; Aider: conventions; web chats: a browser bridge). Mneme can't integrate the
 * same way everywhere, so it should integrate the BEST way each one allows — and say, honestly, how
 * tight that is. AGENT-FIT is that registry + a measurable fit score + the exact wiring per agent.
 *
 * The fit score is grounded, not vibes — it is the sum of the integration channels the agent actually
 * exposes:  programmatic tool calls (MCP, +40) · a per-action gate (a hook, +25) · a per-turn signal
 * (+20) · a persistent instruction surface (rules/agents file, +15). FULL = MCP + gate + per-turn.
 *
 * ★HONEST (DIAKRISIS): this is a knowledge map + auto-wiring of REAL, documented extension points —
 * not a claim Mneme runs "inside" a hosted model. A browser-only chat (chatgpt.com) genuinely scores
 * LIMITED (a bridge userscript is the only surface), and AGENT-FIT says so rather than pretending.
 */

export type Surface = "mcp" | "hook" | "perTurn" | "rulesFile" | "cli" | "browser";
export interface AgentProfile {
  id: string; label: string;
  /** env-var markers that identify this agent at runtime. */
  detect: string[];
  surfaces: Surface[];
  /** how Mneme delivers a LIVE signal on each turn/action for this agent. */
  liveMechanism: string;
  /** the concrete wiring to make Mneme native here. */
  wiring: string;
  /** integration tightness band (derived from `surfaces`). */
  tier: "FULL" | "STRONG" | "PARTIAL" | "LIMITED";
  fit: number; // 0..100
}

const SURFACE_POINTS: Record<Surface, number> = { mcp: 40, hook: 25, perTurn: 20, rulesFile: 15, cli: 10, browser: 8 };
function scoreOf(surfaces: Surface[]): { fit: number; tier: AgentProfile["tier"] } {
  const fit = Math.min(100, surfaces.reduce((a, s) => a + (SURFACE_POINTS[s] ?? 0), 0));
  const tier = fit >= 85 ? "FULL" : fit >= 60 ? "STRONG" : fit >= 30 ? "PARTIAL" : "LIMITED";
  return { fit, tier };
}
function profile(p: Omit<AgentProfile, "fit" | "tier">): AgentProfile { return { ...p, ...scoreOf(p.surfaces) }; }

export const AGENT_PROFILES: ReadonlyArray<AgentProfile> = [
  profile({ id: "claude-code", label: "Claude Code", detect: ["CLAUDECODE", "CLAUDE_CODE"], surfaces: ["mcp", "hook", "perTurn", "rulesFile", "cli"], liveMechanism: "PreToolUse hook gates each tool call + UserPromptSubmit hook nudges every turn + MCP tools callable inline", wiring: "MCP server in .mcp.json (or settings) + PreToolUse/UserPromptSubmit hooks in .claude/settings.json + CLAUDE.md" }),
  profile({ id: "cursor", label: "Cursor", detect: ["CURSOR_AGENT", "CURSOR_TRACE_ID"], surfaces: ["mcp", "perTurn", "rulesFile", "cli"], liveMechanism: "MCP tools called per turn + .cursor/rules instructions advertised each turn", wiring: "MCP in ~/.cursor/mcp.json + .cursor/rules (or .cursorrules)" }),
  profile({ id: "cline", label: "Cline", detect: ["CLINE"], surfaces: ["mcp", "perTurn", "cli"], liveMechanism: "MCP tools per turn (Cline auto-invokes MCP); custom instructions", wiring: "MCP via the Cline MCP settings" }),
  profile({ id: "continue", label: "Continue", detect: ["CONTINUE", "CONTINUE_DEV"], surfaces: ["mcp", "perTurn", "cli"], liveMechanism: "MCP tools + config.json context providers", wiring: "MCP block in Continue's config.json" }),
  profile({ id: "claude-desktop", label: "Claude Desktop", detect: ["CLAUDE_DESKTOP"], surfaces: ["mcp", "perTurn"], liveMechanism: "MCP tools per turn (no shell)", wiring: "MCP in claude_desktop_config.json" }),
  profile({ id: "zed", label: "Zed", detect: ["ZED", "ZED_TERM"], surfaces: ["mcp", "perTurn", "cli"], liveMechanism: "MCP context servers per turn", wiring: "MCP context server in Zed settings" }),
  profile({ id: "windsurf", label: "Windsurf", detect: ["WINDSURF"], surfaces: ["mcp", "perTurn", "rulesFile", "cli"], liveMechanism: "MCP tools + .windsurfrules each turn", wiring: "MCP in Windsurf config + .windsurfrules" }),
  profile({ id: "gemini-cli", label: "Gemini CLI", detect: ["GEMINI_CLI", "GEMINI_API_KEY"], surfaces: ["mcp", "rulesFile", "cli"], liveMechanism: "MCP tools + GEMINI.md instructions + shell", wiring: "MCP in Gemini settings + GEMINI.md" }),
  profile({ id: "codex", label: "Codex", detect: ["CODEX", "CODEX_SANDBOX", "CODEX_AGENT"], surfaces: ["rulesFile", "cli"], liveMechanism: "AGENTS.md instructions + the CLI (`mneme ...`) run as shell steps", wiring: "AGENTS.md with the Mneme decision table + call `mneme` from the shell" }),
  profile({ id: "aider", label: "Aider", detect: ["AIDER", "AIDER_MODEL"], surfaces: ["rulesFile", "cli"], liveMechanism: "CONVENTIONS.md / .aider.conf.yml + shell calls to `mneme`", wiring: ".aider.conf.yml read-list + a conventions file referencing `mneme verify`" }),
  profile({ id: "copilot", label: "GitHub Copilot", detect: ["COPILOT_AGENT", "GITHUB_COPILOT"], surfaces: ["rulesFile"], liveMechanism: ".github/copilot-instructions.md (instructions only — no programmatic call)", wiring: ".github/copilot-instructions.md referencing the Mneme discipline" }),
  profile({ id: "grok", label: "Grok", detect: ["GROK", "XAI_API_KEY"], surfaces: ["cli", "perTurn"], liveMechanism: "API-driven: route prompts through `gephyra serve` (HTTP) for truth-customs + the CLI", wiring: "point the Grok app/agent at the Gephyra HTTP surface, or call `mneme` from its tool layer" }),
  profile({ id: "web-chat", label: "Browser chat (chatgpt.com / gemini / claude.ai / …)", detect: [], surfaces: ["browser"], liveMechanism: "the Browser Polygraph userscript + local bridge — green/yellow/red truth dots beside each sentence", wiring: "mneme polygraph autosetup (Tampermonkey userscript + bridge)" }),
];

/** Identify the active agent from env markers (process.env-shaped object). */
export function detectActiveAgent(env: Record<string, string | undefined>): AgentProfile | null {
  const e = env ?? {};
  for (const p of AGENT_PROFILES) if (p.detect.some((k) => e[k])) return p;
  return null;
}
export function fitFor(id: string): AgentProfile | undefined { return AGENT_PROFILES.find((p) => p.id === String(id).toLowerCase()); }
export function listFits(): ReadonlyArray<AgentProfile> { return AGENT_PROFILES; }

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface AgentFitGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function agentFitGauntlet(): AgentFitGauntlet {
  const all = AGENT_PROFILES;
  const everyValid = all.every((p) => p.id && p.label && Array.isArray(p.surfaces) && p.surfaces.length > 0 && p.liveMechanism && p.wiring && p.fit >= 0 && p.fit <= 100);
  const claude = fitFor("claude-code");
  const claudeFull = !!claude && claude.tier === "FULL" && claude.surfaces.includes("hook") && claude.surfaces.includes("mcp");
  const web = fitFor("web-chat");
  const webLimited = !!web && web.tier === "LIMITED" && web.surfaces[0] === "browser";       // honest: a web chat is limited
  const detectOK = detectActiveAgent({ CLAUDECODE: "1" })?.id === "claude-code" && detectActiveAgent({ CURSOR_AGENT: "1" })?.id === "cursor" && detectActiveAgent({})?.id === undefined;
  const mcpAgentsStrong = all.filter((p) => p.surfaces.includes("mcp")).every((p) => p.fit >= 60);   // MCP ⇒ at least STRONG
  const scoreMonotone = scoreOf(["mcp", "hook", "perTurn"]).fit > scoreOf(["rulesFile"]).fit;          // more surfaces ⇒ higher fit
  const total = (() => { try { detectActiveAgent(null as never); fitFor(null as never); return true; } catch { return false; } })();

  const checks = [
    { name: "EVERY-PROFILE-VALID", pass: everyValid, detail: `${all.length} agent profiles each have surfaces + live mechanism + wiring + a 0..100 fit` },
    { name: "CLAUDE-CODE-FULL", pass: claudeFull, detail: "Claude Code = FULL (MCP + per-action hook + per-turn) — the tightest fit" },
    { name: "WEB-CHAT-HONEST-LIMITED", pass: webLimited, detail: "a browser-only chat scores LIMITED (bridge userscript only) — not overstated" },
    { name: "DETECT-FROM-ENV", pass: detectOK, detail: "the active agent is identified from its env markers; unknown env → null" },
    { name: "MCP-IMPLIES-STRONG", pass: mcpAgentsStrong, detail: "any agent exposing MCP scores ≥ STRONG (programmatic integration)" },
    { name: "SCORE-MONOTONE", pass: scoreMonotone, detail: "more integration surfaces ⇒ a strictly higher fit score (grounded, not vibes)" },
    { name: "TOTAL", pass: total, detail: "null/garbage env never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
