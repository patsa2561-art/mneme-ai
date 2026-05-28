/**
 * v2.76.0 — Ollama embedder robustness (bge-m3 "500 / NaN on a specific input").
 *
 * The model occasionally returns HTTP 5xx OR a NaN-poisoned embedding on a
 * particular input (observed with bge-m3). Before v2.76 that threw and aborted
 * the whole index. Now: retry 5xx, validate against NaN, sanitize + retry, then
 * substitute a same-dimension deterministic vector so the run always completes.
 */

import { describe, it, expect, afterEach } from "vitest";
import { OllamaEmbedder } from "./ollama.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function vec(n: number, fill = 0.1): number[] { return Array.from({ length: n }, () => fill); }
function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Install a fetch mock that routes /api/embed (batch) + /api/embeddings (singular). */
function mockFetch(handler: (url: string, body: any) => Response) {
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(init.body) : {};
    return handler(u, body);
  }) as typeof fetch;
}

describe("v2.76.0 — Ollama embedder robustness (PINNED)", () => {
  it("N1 transient 5xx on singular → retries → succeeds (no fallback)", async () => {
    const e = new OllamaEmbedder({ model: "bge-m3", dimensions: 8, timeoutMs: 2000 });
    let singular = 0;
    mockFetch((u) => {
      if (u.endsWith("/api/embed")) return jsonResp(500, { error: "loading" }); // batch unhealthy → singular
      // singular: first call 503, then OK
      singular++;
      return singular < 2 ? jsonResp(503, { error: "busy" }) : jsonResp(200, { embedding: vec(8) });
    });
    const out = await e.embed(["hello"]);
    expect(out).toHaveLength(1);
    expect([...out[0]!].every(Number.isFinite)).toBe(true);
    expect(e.embedStats().degraded).toBe(0);
  });

  it("N2 ok-but-NaN embedding → retried as unhealthy → eventually valid", async () => {
    const e = new OllamaEmbedder({ model: "bge-m3", dimensions: 4, timeoutMs: 2000 });
    let n = 0;
    mockFetch((u) => {
      if (u.endsWith("/api/embed")) return jsonResp(404, {}); // no batch endpoint → singular path
      n++;
      return n < 2 ? jsonResp(200, { embedding: [0.1, NaN, 0.3, 0.4] }) : jsonResp(200, { embedding: vec(4) });
    });
    const out = await e.embed(["x"]);
    expect([...out[0]!].every(Number.isFinite)).toBe(true);
    expect(e.embedStats().degraded).toBe(0);
  });

  it("N3 persistent 500 on a specific input → deterministic SAME-DIM fallback (index completes)", async () => {
    const e = new OllamaEmbedder({ model: "bge-m3", dimensions: 16, timeoutMs: 2000 });
    mockFetch((u) => {
      if (u.endsWith("/api/embed")) return jsonResp(404, {});
      return jsonResp(500, { error: "the bge-m3 NaN input" }); // never succeeds
    });
    const out = await e.embed(["...may encrypt where feasible..."]);
    expect(out).toHaveLength(1);
    expect(out[0]!.length).toBe(16);                       // dimension stays consistent
    expect([...out[0]!].every(Number.isFinite)).toBe(true); // a usable (non-NaN) vector
    expect(e.embedStats().degraded).toBe(1);              // transparently counted, not faked
  });

  it("N4 fallback vector is deterministic per (text, dim)", async () => {
    const e = new OllamaEmbedder({ model: "bge-m3", dimensions: 16, timeoutMs: 2000 });
    mockFetch((u) => u.endsWith("/api/embed") ? jsonResp(404, {}) : jsonResp(500, {}));
    const a = await e.embed(["same text"]);
    const b = await e.embed(["same text"]);
    expect([...a[0]!]).toEqual([...b[0]!]);
  });

  it("N5 one bad input in a multi-item run does NOT abort the others", async () => {
    const e = new OllamaEmbedder({ model: "bge-m3", dimensions: 8, timeoutMs: 2000 });
    mockFetch((u, body) => {
      if (u.endsWith("/api/embed")) return jsonResp(404, {}); // force singular per-item
      const prompt: string = body.prompt ?? "";
      if (prompt.includes("POISON")) return jsonResp(500, { error: "bad input" });
      return jsonResp(200, { embedding: vec(8) });
    });
    const out = await e.embed(["good1", "POISON", "good3"]);
    expect(out).toHaveLength(3);
    expect(out.every((v) => v.length === 8 && [...v].every(Number.isFinite))).toBe(true);
    expect(e.embedStats().degraded).toBe(1); // only the poison chunk degraded
  });
});
