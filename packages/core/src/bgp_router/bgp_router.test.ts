/**
 * v2.82.0 — BGP NOTARIZING ROUTER pinned + QUAN tests (💎1).
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { routeRequest, verifyRoute, renderRoute, type Hop, type Protocol } from "./index.js";
import { type NotaryReceipt } from "../notary/index.js";

const repo = () => mkdtempSync(join(tmpdir(), "mneme-bgp-"));

const HOPS: Hop[] = [
  { from: "mcp", to: "a2a", action: "delegate task", agent: "claude" },
  { from: "a2a", to: "x402", action: "pay 0.05 USDC", agent: "gpt" },
  { from: "x402", to: "erc8004", action: "settle + reputation", agent: "gemini" },
];

describe("v2.82.0 💎1 BGP router (PINNED)", () => {
  it("B1 routes + notarizes every hop; verifyRoute valid offline", () => {
    const r = repo();
    const { receipts } = routeRequest(r, { requestId: "req-1", hops: HOPS });
    expect(receipts).toHaveLength(3);
    const wire: NotaryReceipt[] = JSON.parse(JSON.stringify(receipts));
    expect(verifyRoute(wire).valid).toBe(true);
    expect(renderRoute(receipts)).toBe("mcp→a2a→x402→erc8004");
  });
  it("B2 tampering a hop breaks the route", () => {
    const r = repo();
    const { receipts } = routeRequest(r, { requestId: "req-2", hops: HOPS });
    const tampered = receipts.map((c, i) => i === 1 ? { ...c, payload: { ...(c.payload as object), action: "pay 999 USDC" } } as NotaryReceipt : c);
    expect(verifyRoute(tampered).valid).toBe(false);
  });
  it("B3 protocol discontinuity is rejected", () => {
    const r = repo();
    const bad: Hop[] = [{ from: "mcp", to: "a2a", action: "x" }, { from: "x402", to: "erc8004", action: "y" }]; // a2a≠x402
    const { receipts } = routeRequest(r, { requestId: "req-3", hops: bad });
    const v = verifyRoute(receipts);
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/discontinuity/);
  });
  it("B4 reordering hops breaks it", () => {
    const r = repo();
    const { receipts } = routeRequest(r, { requestId: "req-4", hops: HOPS });
    expect(verifyRoute([receipts[1]!, receipts[0]!, receipts[2]!]).valid).toBe(false);
  });
});

describe("v2.82.0 💎1 QUAN", () => {
  it("Q random connected routes always verify; any single tamper always fails", () => {
    const r = repo();
    const protos: Protocol[] = ["mcp", "a2a", "x402", "erc8004", "http", "local"];
    for (let n = 1; n <= 10; n++) {
      const hops: Hop[] = [];
      let cur = protos[n % protos.length]!;
      for (let i = 0; i < n; i++) {
        const next = protos[(n + i * 3 + 1) % protos.length]!;
        hops.push({ from: cur, to: next, action: `op${i}` });
        cur = next;
      }
      const { receipts } = routeRequest(r, { requestId: `q-${n}`, hops });
      expect(verifyRoute(receipts).valid, `route len ${n}`).toBe(true);
      for (let i = 0; i < receipts.length; i++) {
        const t = receipts.map((c, j) => j === i ? { ...c, subject: "evil" } as NotaryReceipt : c);
        expect(verifyRoute(t).valid, `tamper ${i}`).toBe(false);
      }
    }
  });
});
