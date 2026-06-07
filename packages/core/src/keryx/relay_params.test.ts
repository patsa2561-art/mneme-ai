import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleKeryxRelay } from "../gephyra/index.js";
import { mintPairingCode } from "./rendezvous.js";

let ipN = 0;
const repo = () => mkdtempSync(join(tmpdir(), "relayp-"));
// unique client IP per call so the per-IP rate limiter never bleeds across tests
const call = (r: string, action: Parameters<typeof handleKeryxRelay>[1], body: unknown, query: Record<string, string> = {}, hdr: Record<string, string> = {}) =>
  handleKeryxRelay(r, action, body, query, { "x-forwarded-for": "10.0." + Math.floor(ipN / 256) + "." + ((ipN++) % 256), ...hdr });

describe("handleKeryxRelay · pair-register", () => {
  it("missing record.code → 400", async () => { const r = await call(repo(), "pair-register", { daemonId: "d" }); expect(r.status).toBe(400); });
  it("key CLAIMS a daemonId (TOFU); same key re-registers OK", async () => {
    const root = repo(); const a = mintPairingCode("d", "line", { now: Date.now(), secret: "k", counter: 1 });
    expect((await call(root, "pair-register", { daemonId: "d", record: a.record, key: "k" })).status).toBe(200);
    const b = mintPairingCode("d", "line", { now: Date.now(), secret: "k", counter: 2 });
    expect((await call(root, "pair-register", { daemonId: "d", record: b.record, key: "k" })).status).toBe(200);
  });
  it("a different key on a claimed daemonId → 401 (no hijack)", async () => {
    const root = repo(); const a = mintPairingCode("d", "line", { now: Date.now(), secret: "k" });
    await call(root, "pair-register", { daemonId: "d", record: a.record, key: "k" });
    const evil = mintPairingCode("d", "line", { now: Date.now(), secret: "evil", counter: 9 });
    expect((await call(root, "pair-register", { daemonId: "d", record: evil.record, key: "evil" })).status).toBe(401);
  });
  it("a claimed daemonId with NO key supplied → 401", async () => {
    const root = repo(); const a = mintPairingCode("d", "line", { now: Date.now(), secret: "k" });
    await call(root, "pair-register", { daemonId: "d", record: a.record, key: "k" });
    const b = mintPairingCode("d", "line", { now: Date.now(), secret: "k", counter: 3 });
    expect((await call(root, "pair-register", { daemonId: "d", record: b.record })).status).toBe(401);
  });
});

describe("handleKeryxRelay · rotate-key", () => {
  it("missing newKey → 400", async () => { expect((await call(repo(), "rotate-key", { daemonId: "d", oldKey: "x" })).status).toBe(400); });
  it("wrong old key → 401; right old key → rotated", async () => {
    const root = repo(); const a = mintPairingCode("d", "line", { now: Date.now(), secret: "old" });
    await call(root, "pair-register", { daemonId: "d", record: a.record, key: "old" });
    expect((await call(root, "rotate-key", { daemonId: "d", oldKey: "nope", newKey: "new" })).status).toBe(401);
    expect((await call(root, "rotate-key", { daemonId: "d", oldKey: "old", newKey: "new" })).body as { rotated?: boolean }).toMatchObject({ rotated: true });
  });
  it("rotating an UNclaimed daemonId claims it with newKey", async () => {
    const r = await call(repo(), "rotate-key", { daemonId: "fresh", oldKey: "", newKey: "n" });
    expect(r.status).toBe(200);
  });
});

describe("handleKeryxRelay · expect", () => {
  it("missing daemonId/askId → 400; valid → ok + routes that ask's answer", async () => {
    const root = repo();
    expect((await call(root, "expect", { daemonId: "d" })).status).toBe(400);
    expect((await call(root, "expect", { daemonId: "d", askId: "ask1" })).body as { ok?: boolean }).toMatchObject({ ok: true });
  });
});

describe("handleKeryxRelay · webhook", () => {
  it("discord PING (type 1) → PONG (type 1)", async () => {
    const r = await call(repo(), "webhook", JSON.stringify({ type: 1 }), { provider: "discord" });
    expect((r.body as { type?: number }).type).toBe(1);
  });
  it("a pairing code links the conversation", async () => {
    const root = repo(); const a = mintPairingCode("d", "line", { now: Date.now(), secret: "k" });
    await call(root, "pair-register", { daemonId: "d", record: a.record, key: "k" });
    const r = await call(root, "webhook", { events: [{ message: { text: a.code }, source: { userId: "U" } }] }, { provider: "line" });
    expect((r.body as { linked?: boolean }).linked).toBe(true);
  });
  it("an answer routes to the ask's owner (expect), drained by that daemon", async () => {
    const root = repo();
    await call(root, "expect", { daemonId: "owner", askId: "q1" });
    await call(root, "webhook", { events: [{ message: { text: "keryx:q1:allow" } }] }, { provider: "line" });
    const d = await call(root, "drain", "", { daemon: "owner" });
    expect((d.body as { answers?: Array<{ payload: string }> }).answers?.some((x) => x.payload === "allow")).toBe(true);
  });
  it("an answer with no recognizable content → ok:false (no retry-storm, still 200)", async () => {
    const r = await call(repo(), "webhook", { random: "noise" }, { provider: "line" });
    expect(r.status).toBe(200); expect((r.body as { ok?: boolean }).ok).toBe(false);
  });
});

describe("handleKeryxRelay · drain auth", () => {
  it("an UNclaimed daemonId drains openly", async () => {
    const r = await call(repo(), "drain", "", { daemon: "nobody" });
    expect(r.status).toBe(200); expect((r.body as { auth?: boolean }).auth).not.toBe(false);
  });
  it("a claimed daemonId: wrong key → auth:false + empty; right key → answers", async () => {
    const root = repo(); const a = mintPairingCode("d", "line", { now: Date.now(), secret: "k" });
    await call(root, "pair-register", { daemonId: "d", record: a.record, key: "k" });
    await call(root, "expect", { daemonId: "d", askId: "q" });
    await call(root, "webhook", { events: [{ message: { text: "keryx:q:allow" } }] }, { provider: "line" });
    const wrong = await call(root, "drain", "", { daemon: "d" }, { "x-keryx-key": "WRONG" });
    expect((wrong.body as { auth?: boolean }).auth).toBe(false);
    expect((wrong.body as { answers?: unknown[] }).answers).toHaveLength(0);
    const right = await call(root, "drain", "", { daemon: "d" }, { "x-keryx-key": "k" });
    expect((right.body as { answers?: Array<{ payload: string }> }).answers?.some((x) => x.payload === "allow")).toBe(true);
  });
});

describe("handleKeryxRelay · rate limit", () => {
  it("a flood from ONE ip on pair-register eventually 429s", async () => {
    const root = repo(); let got429 = false;
    for (let i = 0; i < 40; i++) {
      const r = await handleKeryxRelay(root, "pair-register", { daemonId: "d", record: { code: "C" + i, daemonId: "d" }, key: "k" }, {}, { "x-forwarded-for": "9.9.9.9" });
      if (r.status === 429) { got429 = true; break; }
    }
    expect(got429).toBe(true);
  });
});
