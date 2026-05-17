import { describe, it, expect } from "vitest";
import {
  parseClaims, verifyClaims, computeHonestyStats, formatHonestyLine,
  HONESTY_GATE_TUNABLES,
  type RuntimeView,
} from "./index.js";

const RUNTIME: RuntimeView = {
  mcpToolNames: new Set(["mneme.synapse.sync_export", "mneme.handoff.snapshot", "mneme.truth.forensic"]),
  cliCommands: new Set(["browse", "suggest", "status"]),
  starterCount: 30,
  newToolsThisRelease: 5,
  frameworkCount: 6,
};

describe("v2.19.35 HONESTY GATE — parseClaims", () => {
  it("parses STARTER count claim 'STARTER 13→35'", () => {
    const claims = parseClaims("STARTER 13→35 because reasons");
    const c = claims.find((x) => x.kind === "starter_count_mismatch");
    expect(c).toBeDefined();
    expect(c!.value).toBe(35);
  });

  it("parses STARTER count with arrow variants ('STARTER N to M', 'N -> M')", () => {
    const claims1 = parseClaims("STARTER tier expanded 13 to 35");
    const claims2 = parseClaims("STARTER 22 -> 45");
    expect(claims1.find((x) => x.value === 35)).toBeDefined();
    expect(claims2.find((x) => x.value === 45)).toBeDefined();
  });

  it("parses '+ mneme.X.Y' new MCP tool claims", () => {
    const claims = parseClaims("+ mneme.handoff.snapshot + mneme.fork.record");
    const tools = claims.filter((c) => c.kind === "missing_mcp_tool").map((c) => c.value);
    expect(tools).toContain("mneme.handoff.snapshot");
    expect(tools).toContain("mneme.fork.record");
  });

  it("parses '+ mneme X' 2-part CLI command claims", () => {
    const claims = parseClaims("+ mneme browse + mneme suggest");
    const cmds = claims.filter((c) => c.kind === "missing_cli_command").map((c) => c.value);
    expect(cmds).toContain("browse");
    expect(cmds).toContain("suggest");
  });

  it("parses 'N new MCP tools'", () => {
    const claims = parseClaims("Ships 20 new MCP tools this release");
    const c = claims.find((x) => x.kind === "tool_count_below_claim");
    expect(c!.value).toBe(20);
  });

  it("parses 'N compliance frameworks'", () => {
    const claims = parseClaims("auto-mapped to 6 compliance frameworks");
    const c = claims.find((x) => x.kind === "framework_count_mismatch");
    expect(c!.value).toBe(6);
  });

  it("DEFENSIVE: empty / non-string body returns []", () => {
    expect(parseClaims("")).toEqual([]);
    expect(parseClaims(null as unknown as string)).toEqual([]);
  });
});

describe("v2.19.35 HONESTY GATE — verifyClaims", () => {
  it("STARTER claim PASSES when runtime ≥ claim", () => {
    const claims = parseClaims("STARTER 13→25");
    const v = verifyClaims({ claims, runtime: RUNTIME });
    expect(v.verdict).toBe("PASS");
  });

  it("STARTER claim FAILS when runtime < claim", () => {
    const claims = parseClaims("STARTER 13→100");
    const v = verifyClaims({ claims, runtime: RUNTIME });
    expect(v.verdict).toBe("FAIL");
    expect(v.violations[0]!.expected).toBe(100);
    expect(v.violations[0]!.actual).toBe(30);
  });

  it("MCP tool claim FAILS when tool not in runtime catalog", () => {
    const claims = parseClaims("+ mneme.imaginary.tool");
    const v = verifyClaims({ claims, runtime: RUNTIME });
    expect(v.verdict).toBe("FAIL");
    expect(v.violations[0]!.kind).toBe("missing_mcp_tool");
  });

  it("MCP tool claim PASSES when tool is registered", () => {
    const claims = parseClaims("+ mneme.synapse.sync_export");
    const v = verifyClaims({ claims, runtime: RUNTIME });
    expect(v.verdict).toBe("PASS");
  });

  it("CLI command claim FAILS when command not registered (the actual user-reported R4 bug)", () => {
    const claims = parseClaims("+ mneme imaginary_command");
    const v = verifyClaims({ claims, runtime: RUNTIME });
    expect(v.verdict).toBe("FAIL");
    expect(v.violations[0]!.kind).toBe("missing_cli_command");
  });

  it("CLI command claim PASSES when command is registered", () => {
    const claims = parseClaims("+ mneme browse");
    const v = verifyClaims({ claims, runtime: RUNTIME });
    expect(v.verdict).toBe("PASS");
  });

  it("tool_count claim FAILS when runtime ships fewer than claimed", () => {
    const claims = parseClaims("Ships 20 new MCP tools");
    const v = verifyClaims({ claims, runtime: RUNTIME });
    expect(v.verdict).toBe("FAIL");
    expect(v.violations[0]!.expected).toBe(20);
    expect(v.violations[0]!.actual).toBe(5);
  });

  it("framework_count claim PASSES when runtime ≥ claim", () => {
    const claims = parseClaims("6 frameworks supported");
    const v = verifyClaims({ claims, runtime: RUNTIME });
    expect(v.verdict).toBe("PASS");
  });

  it("REAL R2 + R4 scenario reproduces honestly", () => {
    // v2.19.33 whats_new claimed "STARTER 13→35 + mneme browse + mneme suggest"
    // But actual starterCount=22, mneme browse CLI didn't exist
    const fake_v33 = "STARTER 13→35 + mneme browse + mneme suggest";
    const fake_runtime: RuntimeView = {
      ...RUNTIME,
      starterCount: 22,
      cliCommands: new Set(["suggest"]), // browse missing
    };
    const claims = parseClaims(fake_v33);
    const v = verifyClaims({ claims, runtime: fake_runtime });
    expect(v.verdict).toBe("FAIL");
    expect(v.violations.some((x) => x.kind === "starter_count_mismatch")).toBe(true);
    expect(v.violations.some((x) => x.kind === "missing_cli_command" && x.expected === "browse")).toBe(true);
  });
});

describe("v2.19.35 HONESTY GATE — stats + tunables", () => {
  it("computeHonestyStats aggregates by kind", () => {
    const claims = parseClaims("STARTER 13→999 + mneme.imaginary.x + mneme nonexistent");
    const v = verifyClaims({ claims, runtime: RUNTIME });
    const s = computeHonestyStats(v);
    expect(s.totalClaimsParsed).toBeGreaterThanOrEqual(3);
    expect(s.violationsFound).toBeGreaterThanOrEqual(3);
    expect(formatHonestyLine(s)).toContain("HONESTY");
  });

  it("5 claim kinds shipped", () => {
    expect(HONESTY_GATE_TUNABLES.CLAIM_KINDS.length).toBe(5);
  });

  it("RESILIENCE: 1000 random claim-text fuzz never crash", () => {
    const samples = ["STARTER", "+", "mneme.x.y", "+ mneme browse", "20 tools", "6 frameworks", "garbage", ""];
    for (let i = 0; i < 1000; i++) {
      const text = samples.map((s) => s + " " + Math.random()).join(" ");
      expect(() => parseClaims(text)).not.toThrow();
      const claims = parseClaims(text);
      expect(() => verifyClaims({ claims, runtime: RUNTIME })).not.toThrow();
    }
  });
});
