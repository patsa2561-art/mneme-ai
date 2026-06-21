import { describe, it, expect } from "vitest";
import { TOOLS, MNEME_ENTRY } from "./mcp-install.js";

describe("mneme mcp --install — every agent descriptor wires Mneme correctly", () => {
  it("covers the MCP-native agents", () => {
    const ids = TOOLS.map((t) => t.id);
    for (const id of ["claude-code", "cursor", "continue", "windsurf", "cline", "vscode", "zed"]) {
      expect(ids, id).toContain(id);
    }
  });

  it("each descriptor inserts a 'mneme' entry into a fresh config", () => {
    for (const t of TOOLS) {
      const cfg = t.applyMnemeEntry({}, MNEME_ENTRY);
      expect(JSON.stringify(cfg), t.id).toContain('"mneme"');
    }
  });

  it("is idempotent — applying twice does not duplicate the entry", () => {
    for (const t of TOOLS) {
      const once = t.applyMnemeEntry({}, MNEME_ENTRY);
      const twice = t.applyMnemeEntry(once, MNEME_ENTRY);
      expect(twice, t.id).toEqual(once);
    }
  });

  it("uses the correct schema key per agent (mcpServers / servers / context_servers)", () => {
    const byId = Object.fromEntries(TOOLS.map((t) => [t.id, t.applyMnemeEntry({}, MNEME_ENTRY)]));
    for (const id of ["cursor", "windsurf", "cline"]) expect(byId[id], id).toHaveProperty("mcpServers");
    expect(byId["vscode"]).toHaveProperty("servers");          // VS Code native MCP
    expect(byId["zed"]).toHaveProperty("context_servers");     // Zed schema
    expect((byId["vscode"] as { servers: { mneme: { type: string } } }).servers.mneme.type).toBe("stdio");
  });

  it("preserves unrelated existing entries (never clobbers other servers)", () => {
    const t = TOOLS.find((x) => x.id === "cursor")!;
    const cfg = t.applyMnemeEntry({ mcpServers: { other: { command: "x", args: [] } } }, MNEME_ENTRY) as { mcpServers: Record<string, unknown> };
    expect(cfg.mcpServers).toHaveProperty("other");
    expect(cfg.mcpServers).toHaveProperty("mneme");
  });
});
