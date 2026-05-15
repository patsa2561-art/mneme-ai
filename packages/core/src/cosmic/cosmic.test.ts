import { describe, it, expect } from "vitest";
import { mintSession, publishToCosmic, revokeCosmic, readCosmic, formatCosmicPulseLine } from "./index.js";
import { createHash } from "node:crypto";

// In-memory mock that emulates the COSMIC server enough for client tests.
function makeMockServer(): typeof fetch {
  const sessions = new Map<string, { state: unknown; adminSecretHash: string; count: number; lastTs: number }>();
  return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const u = new URL(url);
    const m = u.pathname.match(/^\/api\/v1\/sessions\/([A-Za-z0-9_-]+)(\.json|\/revoke)?$/);
    if (!m) return new Response(JSON.stringify({ error: "no route" }), { status: 404 });
    const token = m[1]!;
    const suffix = m[2];
    if (init?.method === "POST" && suffix === "/revoke") {
      sessions.delete(token);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (init?.method === "POST" && !suffix) {
      const body = JSON.parse(init.body as string);
      const exists = sessions.get(token);
      if (!exists) {
        sessions.set(token, { state: body.state, adminSecretHash: body.adminSecretHash, count: 1, lastTs: Date.now() });
        return new Response(JSON.stringify({ ok: true, count: 1, prevSig: null, newSig: "sig1" }), { status: 201 });
      }
      exists.state = body.state;
      exists.count++;
      exists.lastTs = Date.now();
      return new Response(JSON.stringify({ ok: true, count: exists.count, prevSig: "sig" + (exists.count - 1), newSig: "sig" + exists.count }), { status: 200 });
    }
    if (init?.method === undefined && suffix === ".json") {
      const sess = sessions.get(token);
      if (!sess) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      return new Response(JSON.stringify({ token, state: sess.state, lastPublishTs: sess.lastTs, publishCount: sess.count, stale: false }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: "no route" }), { status: 404 });
  }) as typeof fetch;
}

describe("v2.11 COSMIC LINK · client", () => {
  it("mintSession produces a token + secret + URLs", () => {
    const s = mintSession({ serverUrl: "https://cosmic.example.com" });
    expect(s.token).toMatch(/^[0-9a-f]{24}$/);
    expect(s.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(s.adminSecretHash).toBe(createHash("sha256").update(s.secret).digest("hex"));
    expect(s.publicUrl).toBe(`https://cosmic.example.com/sessions/${s.token}`);
    expect(s.jsonUrl).toBe(`https://cosmic.example.com/api/v1/sessions/${s.token}.json`);
    expect(s.sseUrl).toBe(`https://cosmic.example.com/sessions/${s.token}/sse`);
  });

  it("strips trailing slashes from serverUrl", () => {
    const s = mintSession({ serverUrl: "https://cosmic.example.com/" });
    expect(s.publicUrl).toBe(`https://cosmic.example.com/sessions/${s.token}`);
  });

  it("first publish returns count=1 and null prevSig", async () => {
    const fetch = makeMockServer();
    const s = mintSession({ serverUrl: "https://cosmic.example.com" });
    const r = await publishToCosmic({ session: s, state: { v: "2.11.0" }, fetchOverride: fetch });
    expect(r.ok).toBe(true);
    expect(r.count).toBe(1);
    expect(r.prevSig).toBeNull();
    expect(r.newSig).toBe("sig1");
  });

  it("subsequent publishes increment count + chain prevSig", async () => {
    const fetch = makeMockServer();
    const s = mintSession({ serverUrl: "https://cosmic.example.com" });
    await publishToCosmic({ session: s, state: { v: "2.11.0" }, fetchOverride: fetch });
    const r2 = await publishToCosmic({ session: s, state: { v: "2.11.1" }, fetchOverride: fetch });
    expect(r2.count).toBe(2);
    expect(r2.prevSig).toBe("sig1");
    expect(r2.newSig).toBe("sig2");
  });

  it("readCosmic fetches state without auth", async () => {
    const fetch = makeMockServer();
    const s = mintSession({ serverUrl: "https://cosmic.example.com" });
    await publishToCosmic({ session: s, state: { v: "2.11.0" }, fetchOverride: fetch });
    const r = await readCosmic(s.jsonUrl, fetch);
    expect(r.ok).toBe(true);
    expect((r.state as { v: string }).v).toBe("2.11.0");
    expect(r.publishCount).toBe(1);
  });

  it("readCosmic on unknown token returns 404 error", async () => {
    const fetch = makeMockServer();
    const s = mintSession({ serverUrl: "https://cosmic.example.com" });
    const r = await readCosmic(s.jsonUrl, fetch);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("not found");
  });

  it("revokeCosmic deletes the session", async () => {
    const fetch = makeMockServer();
    const s = mintSession({ serverUrl: "https://cosmic.example.com" });
    await publishToCosmic({ session: s, state: { v: "x" }, fetchOverride: fetch });
    const rev = await revokeCosmic(s, fetch);
    expect(rev.ok).toBe(true);
    const after = await readCosmic(s.jsonUrl, fetch);
    expect(after.ok).toBe(false);
  });

  it("publishToCosmic returns ok=false on network failure", async () => {
    const failingFetch: typeof fetch = async () => { throw new Error("ECONNREFUSED"); };
    const s = mintSession({ serverUrl: "https://cosmic.example.com" });
    const r = await publishToCosmic({ session: s, state: {}, fetchOverride: failingFetch });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("ECONNREFUSED");
  });

  it("publishToCosmic includes Authorization Bearer header", async () => {
    let captured: string | undefined;
    const sniffFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>)?.["authorization"];
      captured = auth;
      return new Response(JSON.stringify({ ok: true, count: 1, prevSig: null, newSig: "x" }), { status: 201 });
    }) as typeof fetch;
    const s = mintSession({ serverUrl: "https://cosmic.example.com" });
    await publishToCosmic({ session: s, state: {}, fetchOverride: sniffFetch });
    expect(captured).toMatch(/^Bearer [0-9a-f]{64}$/);
  });

  it("formatCosmicPulseLine emits a tight summary", () => {
    const s = mintSession({ serverUrl: "https://x.com" });
    const line = formatCosmicPulseLine(s, { ok: true, count: 3, newSig: "abcdef1234567890" });
    expect(line).toContain("COSMIC");
    expect(line).toContain("count=3");
    expect(line).toContain("sig=abcdef12");
  });
});
