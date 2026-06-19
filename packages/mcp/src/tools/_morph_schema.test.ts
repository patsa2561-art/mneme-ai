/**
 * v3.108 — MORPH ⇄ live-schema verification. The novel guarantee: a router that
 * checks its OWN output against the destination tool's ACTUAL input schema. Every
 * INTENT_ARG / REQUIRED_ARGS entry in core must be a real input of the mapped MCP
 * tool — so MORPH never hands an agent an arg name the tool doesn't accept.
 */
import { describe, it, expect } from "vitest";
import { buildToolMap } from "./_registry.js";
import { morph } from "@mneme-ai/core";

describe("v3.108 · MORPH projected args match the LIVE MCP tool schemas", () => {
  const tm = buildToolMap();
  const schemaOf = (tool: string) => tm.get(tool)?.inputSchema as { properties?: Record<string, unknown>; required?: string[] } | undefined;

  it("every COMMAND_TO_MCP target is a real, registered tool", () => {
    for (const tool of Object.values(morph.COMMAND_TO_MCP)) {
      expect(tm.has(tool), tool).toBe(true);
    }
  });

  it("INTENT_ARG fills a REAL input property of the mapped tool", () => {
    for (const [command, arg] of Object.entries(morph.INTENT_ARG)) {
      const tool = morph.toMcpTool(command)!;
      const props = schemaOf(tool)?.properties ?? {};
      expect(Object.keys(props), `${command} → ${tool}.${arg}`).toContain(arg);
    }
  });

  it("REQUIRED_ARGS matches the tool's actual required list (no invented requirements)", () => {
    for (const [command, reqs] of Object.entries(morph.REQUIRED_ARGS)) {
      const tool = morph.toMcpTool(command)!;
      const required = schemaOf(tool)?.required ?? [];
      for (const r of reqs) expect(required, `${command} → ${tool} requires ${r}`).toContain(r);
    }
  });

  it("a routed shape's args are all valid input keys of the target tool", () => {
    for (const q of ["is this claim actually true", "what do we know about the auth module", "review the whole codebase"]) {
      const m = morph.morph(q);
      if (m.verdict !== "MORPHED" || !m.capability?.mcpTool) continue;
      const props = Object.keys(schemaOf(m.capability.mcpTool)?.properties ?? {});
      for (const k of Object.keys(m.shape?.args ?? {})) {
        if (k === "intent") continue; // generic hint (tool has no free-text arg)
        expect(props, `${m.capability.mcpTool} arg ${k}`).toContain(k);
      }
    }
  });
});
