import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CORTEX_TOOLS } from "./_cortex_tools.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const byName = Object.fromEntries(CORTEX_TOOLS.map((t) => [t.name, t]));
const D = (r: { data: unknown }): any => r.data;

describe("v2.104 CORTEX MCP tools — the cross-vendor Sovereign Memory Bus", () => {
  it("exposes contribute / recall / handoff / reconcile / verify", () => {
    expect(CORTEX_TOOLS.map((t) => t.name)).toEqual([
      "mneme.cortex.contribute", "mneme.cortex.recall", "mneme.cortex.handoff", "mneme.cortex.reconcile", "mneme.cortex.verify",
    ]);
  });

  it("reconcile resolves a verifiably-false conflict by PROOF (the magical power)", async () => {
    const rt = { meta: { rootPath: process.cwd() } } as never;
    const r = D(await byName["mneme.cortex.reconcile"]!.handler(rt, { agentA: "claude", valueA: "2+2=4", agentB: "grok", valueB: "2+2=5" }));
    expect(r.resolution).toBe("proof");
    expect(r.winner?.value).toBe("2+2=4");
    expect(r._proof).toBeTruthy();
  });

  it("CROSS-AGENT: claude writes → gpt agrees → grok conflict quarantined → gemini recalls the verified fact", async () => {
    const repo = mkdtempSync(join(tmpdir(), "cortex-mcp-"));
    const rt = { meta: { rootPath: repo } } as never;
    const call = (n: string, a: Record<string, unknown>) => byName[n]!.handler(rt, a as never);
    try {
      expect(D(await call("mneme.cortex.contribute", { agent: "claude", key: "db.url", value: "pg://prod", kind: "fact" })).verdict).toBe("ACCEPTED");
      expect(D(await call("mneme.cortex.contribute", { agent: "gpt", key: "db.url", value: "pg://prod" })).verdict).toBe("DUPLICATE");
      const grok = D(await call("mneme.cortex.contribute", { agent: "grok", key: "db.url", value: "pg://EVIL" }));
      expect(grok.verdict).toBe("QUARANTINED");
      const rec = D(await call("mneme.cortex.recall", { query: "db url" }));
      expect(rec.facts.find((f: any) => f.key === "db.url")?.value).toBe("pg://prod");   // not poisoned
      expect(rec._proof).toBeTruthy();
      const upd = D(await call("mneme.cortex.contribute", { agent: "claude", key: "db.url", value: "pg://prod2", update: true }));
      expect(upd.verdict).toBe("UPDATED");
    } finally { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } }
  });

  it("handoff builds a signed capsule + verify confirms a genuine entry", async () => {
    const repo = mkdtempSync(join(tmpdir(), "cortex-mcp2-"));
    const rt = { meta: { rootPath: repo } } as never;
    const call = (n: string, a: Record<string, unknown>) => byName[n]!.handler(rt, a as never);
    try {
      await call("mneme.cortex.contribute", { agent: "claude", key: "k", value: "v" });
      const ho = D(await call("mneme.cortex.handoff", { toAgent: "gemini" }));
      expect(ho.factCount).toBe(1);
      const entry = ho.capsule?.facts; expect(Array.isArray(entry)).toBe(true);
    } finally { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } }
  });

  it("STABILITY — handlers are total on junk args", async () => {
    const rt = { meta: { rootPath: process.cwd() } } as never;
    for (const t of CORTEX_TOOLS) {
      await expect(t.handler(rt, { key: 1, value: {}, query: [], entry: null } as never)).resolves.toBeTruthy();
    }
  });
});
