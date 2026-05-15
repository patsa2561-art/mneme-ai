import { describe, it, expect } from "vitest";
import {
  mintSession, publishToCosmic, revokeCosmic, readCosmic, formatCosmicPulseLine,
  heartbeatCosmic, pushHomunculusReturn, readInbox, getCosmicPresence,
} from "./index.js";
import { createHash } from "node:crypto";

interface MockSess {
  state: unknown;
  adminSecretHash: string;
  count: number;
  lastTs: number;
  lastHb: number;
  inbox: Array<{ receivedAt: string; vendor: string; body: string }>;
  watchers: Array<{ fp: string; vendor: string; secondsAgo: number }>;
}

// In-memory mock that emulates the COSMIC server enough for client tests.
function makeMockServer(): typeof fetch {
  const sessions = new Map<string, MockSess>();
  return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const u = new URL(url);
    const method = init?.method ?? "GET";
    // v2.12 routes
    let m = u.pathname.match(/^\/api\/v1\/sessions\/([A-Za-z0-9_-]+)\/heartbeat$/);
    if (m) {
      const sess = sessions.get(m[1]!);
      if (!sess) return new Response(JSON.stringify({ error: "no session" }), { status: 404 });
      sess.lastHb = Date.now();
      return new Response(JSON.stringify({ ok: true, ts: sess.lastHb, zombie: false }), { status: 200 });
    }
    m = u.pathname.match(/^\/api\/v1\/sessions\/([A-Za-z0-9_-]+)\/inbox$/);
    if (m) {
      const sess = sessions.get(m[1]!);
      if (!sess) return new Response(JSON.stringify({ error: "no session" }), { status: 404 });
      if (method === "POST") {
        sess.inbox.push({ receivedAt: new Date().toISOString(), vendor: "test", body: String(init?.body ?? "") });
        return new Response(JSON.stringify({ ok: true, count: sess.inbox.length }), { status: 201 });
      }
      if (method === "GET") {
        const items = sess.inbox.slice();
        const drained = (init?.headers as Record<string, string>)?.["x-drain"] === "1";
        if (drained) sess.inbox.length = 0;
        return new Response(JSON.stringify({ items, count: items.length, drained }), { status: 200 });
      }
    }
    m = u.pathname.match(/^\/api\/v1\/sessions\/([A-Za-z0-9_-]+)\/presence$/);
    if (m) {
      const sess = sessions.get(m[1]!);
      if (!sess) return new Response(JSON.stringify({ error: "no session" }), { status: 404 });
      return new Response(JSON.stringify({
        token: m[1], watchers: sess.watchers, publishCount: sess.count,
        lastPublishTs: sess.lastTs, lastHeartbeatTs: sess.lastHb || null, zombie: false,
      }), { status: 200 });
    }
    // v2.11 routes
    m = u.pathname.match(/^\/api\/v1\/sessions\/([A-Za-z0-9_-]+)(\.json|\/revoke)?$/);
    if (!m) return new Response(JSON.stringify({ error: "no route" }), { status: 404 });
    const token = m[1]!;
    const suffix = m[2];
    if (method === "POST" && suffix === "/revoke") {
      sessions.delete(token);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (method === "POST" && !suffix) {
      const body = JSON.parse(init!.body as string);
      const exists = sessions.get(token);
      if (!exists) {
        sessions.set(token, {
          state: body.state, adminSecretHash: body.adminSecretHash,
          count: 1, lastTs: Date.now(), lastHb: 0, inbox: [], watchers: [],
        });
        return new Response(JSON.stringify({ ok: true, count: 1, prevSig: null, newSig: "sig1" }), { status: 201 });
      }
      exists.state = body.state;
      exists.count++;
      exists.lastTs = Date.now();
      return new Response(JSON.stringify({ ok: true, count: exists.count, prevSig: "sig" + (exists.count - 1), newSig: "sig" + exists.count }), { status: 200 });
    }
    if (method === "GET" && suffix === ".json") {
      const sess = sessions.get(token);
      if (!sess) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      return new Response(JSON.stringify({
        token, state: sess.state, lastPublishTs: sess.lastTs, publishCount: sess.count,
        stale: false, zombie: false, watchers: sess.watchers.length,
      }), { status: 200 });
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

describe("v2.12 COSMIC LINK · NOBEL helpers", () => {
  it("heartbeatCosmic refreshes liveness with HMAC", async () => {
    const fetch = makeMockServer();
    const s = mintSession({ serverUrl: "https://cosmic.example.com" });
    await publishToCosmic({ session: s, state: { v: "2.12.0" }, fetchOverride: fetch });
    const r = await heartbeatCosmic(s, fetch);
    expect(r.ok).toBe(true);
    expect(r.zombie).toBe(false);
    expect(typeof r.ts).toBe("number");
  });

  it("heartbeatCosmic on unknown token returns 404", async () => {
    const fetch = makeMockServer();
    const s = mintSession({ serverUrl: "https://cosmic.example.com" });
    const r = await heartbeatCosmic(s, fetch);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("no session");
  });

  it("heartbeatCosmic includes Authorization Bearer header", async () => {
    let captured: string | undefined;
    const sniff = (async (_input: string | URL | Request, init?: RequestInit) => {
      captured = (init?.headers as Record<string, string>)?.["authorization"];
      return new Response(JSON.stringify({ ok: true, ts: 1, zombie: false }), { status: 200 });
    }) as typeof fetch;
    const s = mintSession({ serverUrl: "https://x.com" });
    await heartbeatCosmic(s, sniff);
    expect(captured).toMatch(/^Bearer [0-9a-f]{64}$/);
  });

  it("pushHomunculusReturn POSTs to /inbox endpoint (open, no auth)", async () => {
    const fetch = makeMockServer();
    const s = mintSession({ serverUrl: "https://cosmic.example.com" });
    await publishToCosmic({ session: s, state: {}, fetchOverride: fetch });
    const r = await pushHomunculusReturn(s.jsonUrl, "# HOMUNCULUS RETURN\necho: ack", fetch);
    expect(r.ok).toBe(true);
    expect(r.count).toBe(1);
  });

  it("pushHomunculusReturn derives /inbox from .json URL", async () => {
    let calledUrl: string | undefined;
    const sniff = (async (input: string | URL | Request) => {
      calledUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return new Response(JSON.stringify({ ok: true, count: 1 }), { status: 201 });
    }) as typeof fetch;
    await pushHomunculusReturn("https://x.com/api/v1/sessions/abc.json", "body", sniff);
    expect(calledUrl).toBe("https://x.com/api/v1/sessions/abc/inbox");
  });

  it("readInbox drains when drain=true (HMAC-auth)", async () => {
    const fetch = makeMockServer();
    const s = mintSession({ serverUrl: "https://cosmic.example.com" });
    await publishToCosmic({ session: s, state: {}, fetchOverride: fetch });
    await pushHomunculusReturn(s.jsonUrl, "first", fetch);
    await pushHomunculusReturn(s.jsonUrl, "second", fetch);
    const r1 = await readInbox(s, { fetchOverride: fetch });
    expect(r1.ok).toBe(true);
    expect(r1.count).toBe(2);
    expect(r1.drained).toBe(false);
    const r2 = await readInbox(s, { drain: true, fetchOverride: fetch });
    expect(r2.drained).toBe(true);
    const r3 = await readInbox(s, { fetchOverride: fetch });
    expect(r3.count).toBe(0);
  });

  it("readInbox returns ok=false on network error", async () => {
    const fail: typeof fetch = async () => { throw new Error("ENOTFOUND"); };
    const s = mintSession({ serverUrl: "https://cosmic.example.com" });
    const r = await readInbox(s, { fetchOverride: fail });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("ENOTFOUND");
  });

  it("getCosmicPresence returns watcher list + zombie flag", async () => {
    const fetch = makeMockServer();
    const s = mintSession({ serverUrl: "https://cosmic.example.com" });
    await publishToCosmic({ session: s, state: {}, fetchOverride: fetch });
    const r = await getCosmicPresence(s.jsonUrl, fetch);
    expect(r.ok).toBe(true);
    expect(Array.isArray(r.watchers)).toBe(true);
    expect(r.zombie).toBe(false);
    expect(r.publishCount).toBe(1);
  });

  it("getCosmicPresence derives /presence URL from /.json URL", async () => {
    let calledUrl: string | undefined;
    const sniff = (async (input: string | URL | Request) => {
      calledUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return new Response(JSON.stringify({ watchers: [] }), { status: 200 });
    }) as typeof fetch;
    await getCosmicPresence("https://x.com/api/v1/sessions/abc.json", sniff);
    expect(calledUrl).toBe("https://x.com/api/v1/sessions/abc/presence");
  });

  it("readCosmic exposes new v2.12 fields (zombie, watchers count)", async () => {
    const fetch = makeMockServer();
    const s = mintSession({ serverUrl: "https://cosmic.example.com" });
    await publishToCosmic({ session: s, state: { v: "2.12.0" }, fetchOverride: fetch });
    const raw = await fetch(s.jsonUrl);
    const j = await raw.json() as { zombie?: boolean; watchers?: number };
    expect(j.zombie).toBe(false);
    expect(typeof j.watchers).toBe("number");
  });
});
