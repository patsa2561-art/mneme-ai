import { describe, it, expect } from "vitest";
import { WISDOM_TOOLS } from "./_wisdom_tools.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const rt = { meta: { rootPath: process.cwd() } } as never;
const byName = Object.fromEntries(WISDOM_TOOLS.map((t) => [t.name, t]));
const D = (r: { data: unknown }): any => r.data;

describe("v2.103 WISDOM GATES MCP tools — agent-facing + self-attesting", () => {
  it("exposes mneme.cognitive.judge + mneme.branch.analyze", () => {
    expect(WISDOM_TOOLS.map((t) => t.name)).toEqual(["mneme.cognitive.judge", "mneme.branch.analyze"]);
    for (const t of WISDOM_TOOLS) { expect(typeof t.handler).toBe("function"); expect(t.inputSchema?.type).toBe("object"); }
  });

  it("cognitive.judge returns a verdict + NOTARY self-attest proof (this repo)", async () => {
    const r = D(await byName["mneme.cognitive.judge"]!.handler(rt, {}));
    expect(["ALLOW", "REVIEW", "FLAG", "UNKNOWN"]).toContain(r.verdict);
    expect(r._proof).toBeTruthy();
    expect(typeof r._proof.dataHash).toBe("string");
  });

  it("branch.analyze returns a signed real-signal summary (this repo)", async () => {
    const r = D(await byName["mneme.branch.analyze"]!.handler(rt, {}));
    expect(typeof r.summary?.branches).toBe("number");
    expect(r._proof).toBeTruthy();
  });

  it("STABILITY — handlers are total even with junk args", async () => {
    for (const t of WISDOM_TOOLS) {
      await expect(t.handler(rt, { author: 123, base: {}, samples: "x", diff: [] } as never)).resolves.toBeTruthy();
    }
  });
});
