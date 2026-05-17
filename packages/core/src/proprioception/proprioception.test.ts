import { describe, it, expect } from "vitest";
import {
  buildUnifiedCatalog,
  verifyCatalog,
  findByAlias,
  computeCatalogStats,
  formatCatalogLine,
  deriveAliases,
} from "./index.js";

const SECRET = "proprioception-test-secret-997744";

describe("v2.19.23 PROPRIOCEPTION · deriveAliases", () => {
  it("kebab-case CLI -> dash/snake/camel/nodelim variants", () => {
    const a = deriveAliases("ghost-code");
    expect(a).toContain("ghost-code");
    expect(a).toContain("ghost_code");
    expect(a).toContain("ghostcode");
    expect(a).toContain("ghostcode"); // lowercased camel
  });

  it("MCP-style 'mneme.ghost.distill' strips prefix + derives variants", () => {
    const a = deriveAliases("mneme.ghost.distill");
    expect(a).toContain("ghost.distill");
    expect(a).toContain("ghost_distill");
    expect(a).toContain("ghost-distill");
    expect(a).toContain("ghostdistill");
  });

  it("aliases are deduplicated + lowercased + sorted", () => {
    const a = deriveAliases("FOO-BAR");
    expect(a).toEqual([...a].sort());
    for (const x of a) expect(x).toBe(x.toLowerCase());
  });
});

describe("v2.19.23 PROPRIOCEPTION · buildUnifiedCatalog", () => {
  it("classifies cli_only / mcp_only / both correctly", () => {
    const cat = buildUnifiedCatalog({
      cliCommands: [
        { name: "ghost", description: "ghost-code lens" },
        { name: "status", description: "memory status" },
        { name: "ask", description: "Q&A" }, // cli_only — no mcp wrapper
      ],
      mcpTools: [
        { name: "mneme.ghost.distill" },
        { name: "mneme.status.report" },
        { name: "mneme.arena.judge" }, // mcp_only — no cli command
      ],
      secret: SECRET,
    });
    const byName = (n: string) => cat.entries.find((e) => e.canonical === n)!;
    expect(byName("ghost").kind).toBe("both");
    expect(byName("ghost").surface).toEqual(["cli", "mcp"]);
    expect(byName("status").kind).toBe("both");
    expect(byName("ask").kind).toBe("cli_only");
    expect(byName("ask").surface).toEqual(["cli"]);
    expect(byName("arena").kind).toBe("mcp_only");
    expect(byName("arena").surface).toEqual(["mcp"]);
  });

  it("entries sorted by canonical (stable order)", () => {
    const cat = buildUnifiedCatalog({
      cliCommands: [{ name: "zebra" }, { name: "alpha" }],
      mcpTools: [{ name: "mneme.beta.go" }, { name: "mneme.alpha.go" }],
      secret: SECRET,
    });
    const names = cat.entries.map((e) => e.canonical);
    expect(names).toEqual(["alpha", "beta", "zebra"]);
  });

  it("CLI description preferred over MCP description for 'both' entries", () => {
    const cat = buildUnifiedCatalog({
      cliCommands: [{ name: "ghost", description: "CLI desc" }],
      mcpTools: [{ name: "mneme.ghost.distill", description: "MCP desc" }],
      secret: SECRET,
    });
    expect(cat.entries.find((e) => e.canonical === "ghost")!.description).toBe("CLI desc");
  });

  it("sharedCount = number of 'both' entries", () => {
    const cat = buildUnifiedCatalog({
      cliCommands: [{ name: "ghost" }, { name: "status" }, { name: "ask" }],
      mcpTools: [{ name: "mneme.ghost.x" }, { name: "mneme.status.y" }, { name: "mneme.unrelated.z" }],
      secret: SECRET,
    });
    expect(cat.sharedCount).toBe(2);
  });
});

describe("v2.19.23 PROPRIOCEPTION · HMAC integrity", () => {
  it("verifyCatalog passes on untampered", () => {
    const cat = buildUnifiedCatalog({
      cliCommands: [{ name: "a" }],
      mcpTools: [{ name: "mneme.b.c" }],
      secret: SECRET,
    });
    expect(verifyCatalog(cat, SECRET)).toBe(true);
  });

  it("verifyCatalog rejects tamper", () => {
    const cat = buildUnifiedCatalog({
      cliCommands: [{ name: "a" }],
      mcpTools: [{ name: "mneme.b.c" }],
      secret: SECRET,
    });
    const tampered = { ...cat, totalCli: 999 };
    expect(verifyCatalog(tampered, SECRET)).toBe(false);
  });

  it("MEASURED 100% determinism: same input -> same sig (50 trials)", () => {
    const input = {
      cliCommands: [{ name: "ghost" }, { name: "status" }],
      mcpTools: [{ name: "mneme.ghost.distill" }, { name: "mneme.arena.judge" }],
      secret: SECRET,
    };
    const firstSig = buildUnifiedCatalog(input).sig;
    let allEqual = true;
    for (let i = 0; i < 50; i++) {
      if (buildUnifiedCatalog(input).sig !== firstSig) { allEqual = false; break; }
    }
    expect(allEqual).toBe(true);
  });
});

describe("v2.19.23 PROPRIOCEPTION · findByAlias (one catalog, many surfaces)", () => {
  it("resolves canonical name to entry", () => {
    const cat = buildUnifiedCatalog({
      cliCommands: [{ name: "ghost-code" }],
      mcpTools: [{ name: "mneme.arena.judge" }],
      secret: SECRET,
    });
    expect(findByAlias(cat, "ghost-code")?.canonical).toBe("ghost-code");
    expect(findByAlias(cat, "GHOST-CODE")?.canonical).toBe("ghost-code"); // case-insensitive
  });

  it("resolves derived aliases (snake_case, camelCase, no-delim)", () => {
    const cat = buildUnifiedCatalog({
      cliCommands: [{ name: "ghost-code" }],
      mcpTools: [],
      secret: SECRET,
    });
    expect(findByAlias(cat, "ghost_code")?.canonical).toBe("ghost-code");
    expect(findByAlias(cat, "ghostcode")?.canonical).toBe("ghost-code");
  });

  it("unknown alias returns undefined", () => {
    const cat = buildUnifiedCatalog({ cliCommands: [{ name: "a" }], mcpTools: [], secret: SECRET });
    expect(findByAlias(cat, "no-such")).toBeUndefined();
  });
});

describe("v2.19.23 PROPRIOCEPTION · stats + formatter", () => {
  it("computeCatalogStats unifiedRatio = both / total", () => {
    const cat = buildUnifiedCatalog({
      cliCommands: [{ name: "a" }, { name: "b" }, { name: "c" }],
      mcpTools: [{ name: "mneme.a.x" }, { name: "mneme.d.x" }],
      secret: SECRET,
    });
    const s = computeCatalogStats(cat);
    expect(s.both).toBe(1); // a
    expect(s.cliOnly).toBe(2); // b, c
    expect(s.mcpOnly).toBe(1); // d
    expect(s.unifiedRatio).toBeCloseTo(1 / 4, 5);
  });

  it("formatCatalogLine renders single-line digest", () => {
    const cat = buildUnifiedCatalog({
      cliCommands: [{ name: "a" }, { name: "b" }],
      mcpTools: [{ name: "mneme.a.x" }],
      secret: SECRET,
    });
    const line = formatCatalogLine(computeCatalogStats(cat));
    expect(line).toContain("PROPRIOCEPTION");
    expect(line).toContain("unified");
  });
});
