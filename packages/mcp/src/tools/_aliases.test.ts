import { describe, it, expect } from "vitest";
import { resolveAlias, listAliases, TOOL_ALIASES } from "./_aliases.js";

describe("MCP tool aliases (#17 fix)", () => {
  it("resolves a known verb.noun alias to its metaphor name", () => {
    expect(resolveAlias("mneme.security.detect_tool_anomaly")).toBe("mneme.aletheia.immune.scan");
    expect(resolveAlias("mneme.signals.list")).toBe("mneme.stigmergy.list");
  });

  it("returns canonical names unchanged", () => {
    expect(resolveAlias("mneme.aletheia.immune.scan")).toBe("mneme.aletheia.immune.scan");
    expect(resolveAlias("mneme.memory.ask")).toBe("mneme.memory.ask");
  });

  it("returns unknown names unchanged (caller decides what to do)", () => {
    expect(resolveAlias("not.a.known.alias")).toBe("not.a.known.alias");
  });

  it("lists aliases sorted by alias name", () => {
    const list = listAliases();
    expect(list.length).toBeGreaterThan(0);
    for (let i = 1; i < list.length; i++) {
      expect(list[i]!.alias.localeCompare(list[i - 1]!.alias)).toBeGreaterThanOrEqual(0);
    }
  });

  it("every alias starts with mneme.", () => {
    for (const alias of Object.keys(TOOL_ALIASES)) {
      expect(alias.startsWith("mneme.")).toBe(true);
    }
  });

  it("every canonical target starts with mneme.", () => {
    for (const canonical of Object.values(TOOL_ALIASES)) {
      expect(canonical.startsWith("mneme.")).toBe(true);
    }
  });

  it("includes the v1.44 demon stage aliases", () => {
    expect(resolveAlias("mneme.security.bug_bounty_scan")).toBe("mneme.teeth.bounty.scan");
    expect(resolveAlias("mneme.compliance.report")).toBe("mneme.godmode.compliance_report");
    expect(resolveAlias("mneme.knowledge.universal_stream")).toBe("mneme.avatar.lingua.stream");
  });
});
