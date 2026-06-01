/**
 * v2.86.0 — HEPHAESTUS MCP tools · GEPHYRA's OS lane (the command Toll Booth).
 *
 * PROACTIVE: an agent about to run a shell command should call
 * `mneme.heph.cross` FIRST and only run it if the disposition is ALLOW. A
 * destructive command is NEVER allowed without a human co-sign.
 */

import type { MnemeTool } from "./_types.js";

export const hephCrossTool: MnemeTool = {
  name: "mneme.heph.cross",
  category: "meta",
  description:
    "🔨 HEPHAESTUS — cross a command into the OS through the safety gate. Classifies risk (read/write/destructive) via CERBERUS (v2.135.0: recursively DECOMPOSES the command — every pipe stage, subshell, wrapper (sudo/env/xargs/nohup), interpreter payload (bash -c / node -e / python -c / eval), find -exec, and base64/hex decoder — and gates the WORST capability REACHABLE, not the leading token; intent-hiding obfuscation FAILS CLOSED to co-sign — closing the curl|bash / base64|sh / node -e / find -exec RCE-bypass class a denylist can't), scans for injection, applies policy, and returns ALLOW / NEEDS_COSIGN / BLOCK + reasons + a signed provenance receipt (who: human vs which AI). A DESTRUCTIVE command is NEVER ALLOW without a human co-sign. Set tribunal=true to convene a REAL cross-vendor panel (from env API keys OPENAI_API_KEY/XAI_API_KEY/GEMINI_API_KEY/DEEPSEEK_API_KEY/OPENROUTER_API_KEY) to judge a destructive op — uncorrelated judges, fail-SAFE to BLOCK when no panel is reachable. Decision only — it does not execute. Call this BEFORE running any shell command and only proceed if disposition === 'ALLOW'.",
  whenToUse: "BEFORE you (an AI agent) run ANY shell command on the user's machine — especially destructive ones (rm -rf, kubectl delete, DROP, git push --force). Use the verdict to decide whether to run, ask for co-sign, or refuse. Add tribunal=true on a destructive op for an independent cross-vendor verdict.",
  triggers: ["heph cross", "is this command safe to run", "gate this command", "check before running"],
  inputSchema: {
    type: "object",
    required: ["command", "agent"],
    properties: {
      command: { type: "string" },
      agent: { type: "string", description: "'human' or your AI agent id" },
      host: { type: "string", description: "host/context tag; a 'prod' substring triggers prod read-only" },
      cosigned: { type: "boolean", description: "a human explicitly co-signed a destructive op" },
      tribunal: { type: "boolean", description: "convene a REAL cross-vendor tribunal from env API keys (no keys ⇒ fail-safe BLOCK on destructive)" },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const deps: Parameters<typeof core.hephaestus.crossCommand>[2] = {};
      if (args["tribunal"] === true) {
        deps.tribunal = core.hephaestus.makeDiffArenaTribunal(cwd, { vendors: await core.hephaestus.tribunalVendorsFromEnv() });
      }
      const r = await core.hephaestus.crossCommand(cwd, {
        command: String(args["command"] ?? ""),
        agent: String(args["agent"] ?? "unknown"),
        host: typeof args["host"] === "string" ? args["host"] as string : undefined,
        cosigned: args["cosigned"] === true,
      }, deps);
      const icon = r.disposition === "ALLOW" ? "🟢" : r.disposition === "NEEDS_COSIGN" ? "🟡" : "🔴";
      return {
        data: { disposition: r.disposition, risk: r.risk, reasons: r.reasons, threats: r.threats, origin: r.origin, tribunal: r.tribunal, receiptId: r.receipt?.receiptId },
        wisdom: `${icon} ${r.disposition} (${r.risk})${r.reasons[0] ? " — " + r.reasons[0] : ""}${r.tribunal ? ` · tribunal=${r.tribunal.consensus}` : ""}`,
        followUp: r.disposition === "NEEDS_COSIGN" ? ["mneme.heph.status"] : [],
        confidence: { level: "high" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "cross failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const hephPolyglotTool: MnemeTool = {
  name: "mneme.heph.polyglot",
  category: "meta",
  description: "🌐 HEPHAESTUS — translate a canonical intent (e.g. 'list listening ports', 'disk usage', 'list processes') to the correct shell command for a platform (linux / macos / powershell; default = this OS). Write once, run anywhere.",
  whenToUse: "When you know WHAT you want but not the exact command on this OS.",
  triggers: ["polyglot", "translate command", "what's the command for"],
  inputSchema: { type: "object", required: ["intent"], properties: { intent: { type: "string" }, platform: { type: "string", description: "linux | macos | powershell (default: this OS)" } } },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    void rt;
    try {
      const core = await import("@mneme-ai/core");
      const platform = typeof args["platform"] === "string" ? args["platform"] as import("@mneme-ai/core").hephaestus.Platform : undefined;
      const t = core.hephaestus.polyglot(String(args["intent"] ?? ""), platform);
      if (!t) return { data: { known: core.hephaestus.polyglotIntents() }, wisdom: `unknown intent — known: ${core.hephaestus.polyglotIntents().join(", ")}`, followUp: [], confidence: { level: "medium" as const } };
      return { data: t, wisdom: `${t.intent} → [${t.platform}] ${t.command}`, followUp: ["mneme.heph.cross"], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "polyglot failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const hephPreflightTool: MnemeTool = {
  name: "mneme.heph.preflight",
  category: "meta",
  description:
    "🔮 HEPHAESTUS PRE-FLIGHT — preview a command's blast radius BEFORE crossing: risk + whether the effect is REVERSIBLE + an explicit list of what CANNOT be undone (rm -rf, dd, DROP/TRUNCATE, git push --force, terraform destroy, …) + a signed pre-mortem receipt. NEVER executes. The honest answer to 'can you undo it?': we can't un-delete, so we predict + warn + SIGN first. Call this on any command whose effect you're unsure is recoverable.",
  whenToUse: "BEFORE running a command that might destroy data or be impossible to undo. Read irreversibleWarnings back to the user and get explicit confirmation before proceeding.",
  triggers: ["heph preflight", "preview command", "what will this command do", "is this reversible", "blast radius"],
  inputSchema: {
    type: "object",
    required: ["command"],
    properties: {
      command: { type: "string" },
      agent: { type: "string", description: "'human' or your AI agent id" },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const pf = await core.hephaestus.preflightCommand(cwd, {
        command: String(args["command"] ?? ""),
        agent: String(args["agent"] ?? "human"),
      });
      const icon = pf.reversible ? "🟢" : "🔴";
      return {
        data: { command: pf.command, risk: pf.risk, reversible: pf.reversible, effects: pf.effects, irreversibleWarnings: pf.irreversibleWarnings, receiptId: pf.receipt?.receiptId },
        wisdom: `${icon} ${pf.reversible ? "REVERSIBLE" : "IRREVERSIBLE"} (${pf.risk})${pf.irreversibleWarnings[0] ? " — " + pf.irreversibleWarnings[0] : ""}`,
        followUp: pf.reversible ? ["mneme.heph.cross"] : ["mneme.heph.cross"],
        confidence: { level: "high" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "preflight failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const hephStatusTool: MnemeTool = {
  name: "mneme.heph.status",
  category: "meta",
  description: "🔨 HEPHAESTUS — live status from the command black box: crossings, allowed / needs-cosign / blocked, and whether the tamper-evident chain is intact.",
  whenToUse: "Reporting what the OS gate has done this session.",
  triggers: ["heph status", "command gate status"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async (rt) => {
    try {
      const core = await import("@mneme-ai/core");
      const s = core.hephaestus.hephaestusStatus(rt.meta?.rootPath ?? process.cwd());
      return { data: s, wisdom: `${s.crossings} crossings · ${s.blocked} blocked · chain ${s.chainValid ? "intact" : "TAMPERED"}`, followUp: [], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "status failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const HEPHAESTUS_TOOLS: MnemeTool[] = [hephCrossTool, hephPreflightTool, hephPolyglotTool, hephStatusTool];
