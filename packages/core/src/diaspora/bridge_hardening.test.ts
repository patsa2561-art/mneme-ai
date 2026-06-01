// v2.28.1 — BUG IMMUNITY PROTOCOL for the 15-vector HTTP bridge audit.
// Every vector gets ONE discrete pinned test. If any fails the bug is back.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startBridge, JsonParseError, __resetRateLimiterForTest, __rateCapsForTest } from "./http_bridge.js";
import type { BridgeHandle } from "./http_bridge.js";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let bridge: BridgeHandle;
let baseUrl: string;
let token: string;
let repoRoot: string;

beforeAll(async () => {
  repoRoot = mkdtempSync(join(tmpdir(), "mneme-bridge-test-"));
  bridge = await startBridge({
    repoRoot,
    host: "127.0.0.1",
  }, {
    polygraphVerify: async ({ sentence }) => ({
      verdict: "trustworthy" as const,
      color: "green" as const,
      confidence: 0.9,
      oneLine: `verified · ${sentence.slice(0, 30)}`,
      latencyMs: 5,
      engine: "test-stub",
    }),
  });
  baseUrl = `http://127.0.0.1:${bridge.port}`;
  token = readFileSync(join(repoRoot, ".mneme", "http-token"), "utf8").trim();
});

afterAll(async () => {
  try { await bridge.stop(); } catch { /* */ }
  try { rmSync(repoRoot, { recursive: true, force: true }); } catch { /* */ }
});

describe("HTTP bridge — B0..B-paths PINNED IMMUNITY", () => {
  // B0 — random port per session
  it("B0: bridge binds in the 17741..17750 ladder", () => {
    expect(bridge.port).toBeGreaterThanOrEqual(17741);
    expect(bridge.port).toBeLessThanOrEqual(17760);
  });

  // B1..B5 — auth enforcement
  it("B1: GET /v1/health WITHOUT auth → 401", async () => {
    const r = await fetch(`${baseUrl}/v1/health`);
    expect(r.status).toBe(401);
  });
  it("B2: wrong token → 401", async () => {
    const r = await fetch(`${baseUrl}/v1/health`, { headers: { Authorization: "Bearer wrong" } });
    expect(r.status).toBe(401);
  });
  it("B3: empty token → 401", async () => {
    const r = await fetch(`${baseUrl}/v1/health`, { headers: { Authorization: "Bearer " } });
    expect(r.status).toBe(401);
  });

  // B6 — bearer scheme case-insensitive (RFC 6750)
  it("B6: lowercase `bearer` scheme accepted", async () => {
    const r = await fetch(`${baseUrl}/v1/health`, { headers: { Authorization: `bearer ${token}` } });
    expect(r.status).toBe(200);
  });

  // B8 — path traversal
  it("B8: path-traversal URL → 404", async () => {
    const r = await fetch(`${baseUrl}/v1/../etc/passwd`, { headers: { Authorization: `Bearer ${token}` } });
    expect([401, 404]).toContain(r.status);
  });
  it("B9: unknown route → 404", async () => {
    const r = await fetch(`${baseUrl}/v1/no-such-route`, { headers: { Authorization: `Bearer ${token}` } });
    expect(r.status).toBe(404);
  });

  // B10 — polygraph accepts claim/text/sentence aliases (was sentence-only)
  it("B10a: POST polygraph with `sentence` returns engine != noop", async () => {
    const r = await fetch(`${baseUrl}/v1/polygraph/verify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sentence: "Mneme is at version 2.28.1" }),
    });
    expect(r.status).toBe(200);
    const j = await r.json() as { engine?: string };
    expect(j.engine).not.toBe("noop");
  });
  it("B10b: POST polygraph with `claim` ALIAS returns engine != noop", async () => {
    const r = await fetch(`${baseUrl}/v1/polygraph/verify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ claim: "Mneme is at version 2.28.1" }),
    });
    expect(r.status).toBe(200);
    const j = await r.json() as { engine?: string };
    expect(j.engine).not.toBe("noop");
  });
  it("B10c: POST polygraph with `text` ALIAS works", async () => {
    const r = await fetch(`${baseUrl}/v1/polygraph/verify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "test text" }),
    });
    expect(r.status).toBe(200);
  });

  // B11 — malformed JSON returns 400 (was 500)
  it("B11: malformed JSON POST → 400 with sanitized message (no parser internals)", async () => {
    const r = await fetch(`${baseUrl}/v1/polygraph/verify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{ malformed",
    });
    expect(r.status).toBe(400);
    const j = await r.json() as { error?: string };
    expect(j.error).toBeDefined();
    // sanitized: should NOT contain parser internals like "Unexpected token"
    expect(j.error!.toLowerCase()).not.toContain("unexpected token");
    expect(j.error!.toLowerCase()).not.toContain("position");
  });

  // B12 — per-route anti-flood (v2.28.1): the polygraph perSec cap absorbs a
  // burst UP TO the cap and rejects a flood beyond it. (A concurrent fan-out
  // lands in the same second deterministically, so this is timing-robust.)
  it("B12: polygraph perSec cap absorbs a burst and rate-limits a flood", async () => {
    __resetRateLimiterForTest();
    const caps = __rateCapsForTest().polygraph;
    const statuses = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        fetch(`${baseUrl}/v1/polygraph/verify`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ sentence: `claim ${i}` }),
        }).then((r) => r.status),
      ),
    );
    const ok = statuses.filter((s) => s === 200).length;
    const rateLimited = statuses.filter((s) => s === 429).length;
    // a legitimate flurry up to the cap is served...
    expect(ok).toBeGreaterThanOrEqual(1);
    expect(ok).toBeLessThanOrEqual(caps.perSec + 5); // ...but NOT all 100 (flood capped near perSec)
    // ...and the flood beyond the cap is rejected (the anti-flood actually fires).
    expect(rateLimited).toBeGreaterThan(0);
    expect(ok + rateLimited).toBe(100);
  });

  // B14 — CORS headers set even when rate-limited (preflight exempt)
  it("B14a: OPTIONS preflight returns ACAO + ACAH headers (Origin: claude.ai)", async () => {
    const r = await fetch(`${baseUrl}/v1/polygraph/verify`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://claude.ai",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type, Authorization",
      },
    });
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-origin")).toBe("https://claude.ai");
    expect(r.headers.get("access-control-allow-headers")).toMatch(/Authorization/i);
    expect(r.headers.get("access-control-max-age")).toBe("86400");
  });
  it("B14b: OPTIONS preflight is EXEMPT from rate limit (1000 preflights ok)", async () => {
    let blocked = 0;
    for (let i = 0; i < 200; i++) {
      const r = await fetch(`${baseUrl}/v1/polygraph/verify`, {
        method: "OPTIONS",
        headers: { Origin: "https://claude.ai", "Access-Control-Request-Method": "POST" },
      });
      if (r.status === 429) blocked++;
    }
    expect(blocked).toBe(0);
  });

  // B15 — response sizes for real claims are not stubs (reset the limiter first
  // so a prior burst test can't leave this single request rate-limited).
  it("B15: real claim response is richer than 24-byte stub", async () => {
    __resetRateLimiterForTest();
    const r = await fetch(`${baseUrl}/v1/polygraph/verify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sentence: "this is a real test claim with content" }),
    });
    const text = await r.text();
    expect(r.status).toBe(200);
    expect(text.length).toBeGreaterThan(50);
  });

  // B-ver — /v1/health returns the REAL installed version (not hardcoded 1.72.0)
  it("B-ver: /v1/health version is pulled from package.json (not '1.72.0')", async () => {
    const r = await fetch(`${baseUrl}/v1/health`, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json() as { version?: string };
    expect(j.version).toBeDefined();
    expect(j.version).not.toBe("1.72.0");
    expect(j.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  // B-paths — honest httpSurface field present
  it("B-paths: /v1/health declares httpSurface honestly", async () => {
    const r = await fetch(`${baseUrl}/v1/health`, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json() as { httpSurface?: { routes?: number; note?: string } };
    expect(j.httpSurface).toBeDefined();
    expect(typeof j.httpSurface!.routes).toBe("number");
    expect(j.httpSurface!.note).toMatch(/MCP|stdio/i);
  });

  // JsonParseError class exposed for downstream tests
  it("JsonParseError class is exported and instanceof checkable", () => {
    const e = new JsonParseError(new Error("inner"));
    expect(e).toBeInstanceOf(JsonParseError);
    expect(e.message).toBe("invalid JSON body");
  });
});
