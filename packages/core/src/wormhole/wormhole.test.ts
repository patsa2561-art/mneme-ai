import { describe, it, expect } from "vitest";
import { sendViaWormhole, ingestTrial, formatWormholePulseLine, type Channel } from "./index.js";

function fakeChannel(id: string, opts: { probe: "available" | "unavailable" | "needs-pairing"; sendDelay?: number; sendOk?: boolean; reason?: string; preference?: number } = { probe: "available" }): Channel<string, string> {
  return {
    id,
    preference: opts.preference,
    probe: () => opts.probe,
    send: async () => {
      if (opts.sendDelay) await new Promise((r) => setTimeout(r, opts.sendDelay));
      if (opts.sendOk === false) return { ok: false, reason: opts.reason ?? "fake-fail" };
      return { ok: true, receipt: `delivered-via-${id}` };
    },
  };
}

describe("v2.6 WORMHOLE · negotiation", () => {
  it("single available channel wins immediately", async () => {
    const r = await sendViaWormhole({
      payload: "hello",
      channels: [fakeChannel("lan", { probe: "available" })],
    });
    expect(r.winner).toBe("lan");
    expect(r.receipt).toBe("delivered-via-lan");
  });

  it("unavailable channels are filtered before send", async () => {
    const r = await sendViaWormhole({
      payload: "hello",
      channels: [
        fakeChannel("lan", { probe: "unavailable" }),
        fakeChannel("paste", { probe: "available" }),
      ],
    });
    expect(r.winner).toBe("paste");
    const lanTrial = r.trials.find((t) => t.channel === "lan");
    expect(lanTrial?.outcome).toBe("unavailable");
  });

  it("needs-pairing channels are excluded", async () => {
    const r = await sendViaWormhole({
      payload: "hello",
      channels: [
        fakeChannel("aura", { probe: "needs-pairing" }),
        fakeChannel("paste", { probe: "available" }),
      ],
    });
    expect(r.winner).toBe("paste");
    const auraTrial = r.trials.find((t) => t.channel === "aura");
    expect(auraTrial?.outcome).toBe("needs-pairing");
  });

  it("no live channels → NO-CHANNEL winner null", async () => {
    const r = await sendViaWormhole({
      payload: "hello",
      channels: [fakeChannel("a", { probe: "unavailable" }), fakeChannel("b", { probe: "unavailable" })],
    });
    expect(r.winner).toBeNull();
    expect(r.receipt).toBeNull();
  });

  it("send failure on one channel allows another to win", async () => {
    const r = await sendViaWormhole({
      payload: "hello",
      channels: [
        fakeChannel("flaky", { probe: "available", sendOk: false, reason: "503" }),
        fakeChannel("solid", { probe: "available" }),
      ],
    });
    expect(r.winner).toBe("solid");
    const flakyTrial = r.trials.find((t) => t.channel === "flaky");
    expect(flakyTrial?.outcome).toBe("failed");
    expect(flakyTrial?.reason).toBe("503");
  });

  it("send timeout marks channel as failed", async () => {
    const r = await sendViaWormhole({
      payload: "hello",
      channels: [
        fakeChannel("slow", { probe: "available", sendDelay: 200 }),
        fakeChannel("fast", { probe: "available" }),
      ],
      sendTimeoutMs: 50,
      concurrency: 2,
    });
    expect(r.winner).toBe("fast");
    const slowTrial = r.trials.find((t) => t.channel === "slow");
    expect(slowTrial?.reason).toContain("timeout");
  });

  it("higher preference channel runs first when scores tied", async () => {
    const r = await sendViaWormhole({
      payload: "hello",
      channels: [
        fakeChannel("low", { probe: "available", preference: 0.1 }),
        fakeChannel("high", { probe: "available", preference: 10 }),
      ],
      concurrency: 1,
    });
    expect(r.winner).toBe("high");
  });

  it("empty channel list → NO-CHANNEL", async () => {
    const r = await sendViaWormhole({ payload: "x", channels: [] });
    expect(r.winner).toBeNull();
    expect(r.trials.length).toBe(0);
  });

  it("scoresAtNegotiation reports per-channel scores", async () => {
    const r = await sendViaWormhole({
      payload: "x",
      channels: [fakeChannel("a"), fakeChannel("b")],
    });
    expect(r.scoresAtNegotiation["a"]).toBeGreaterThan(0);
    expect(r.scoresAtNegotiation["b"]).toBeGreaterThan(0);
  });
});

describe("v2.6 WORMHOLE · EWMA stats", () => {
  it("first success → ewmaSuccess = 1", () => {
    const s = ingestTrial(undefined, { channel: "a", outcome: "succeeded", ms: 100, ts: 0 });
    expect(s.ewmaSuccess).toBe(1);
    expect(s.succeeded).toBe(1);
    expect(s.trials).toBe(1);
  });

  it("first failure → ewmaSuccess = 0", () => {
    const s = ingestTrial(undefined, { channel: "a", outcome: "failed", ms: 100, ts: 0 });
    expect(s.ewmaSuccess).toBe(0);
    expect(s.succeeded).toBe(0);
    expect(s.trials).toBe(1);
  });

  it("repeated successes converge ewmaSuccess to 1", () => {
    let s = ingestTrial(undefined, { channel: "a", outcome: "failed", ms: 100, ts: 0 });
    for (let i = 0; i < 60; i++) {
      s = ingestTrial(s, { channel: "a", outcome: "succeeded", ms: 100, ts: i });
    }
    expect(s.ewmaSuccess).toBeGreaterThan(0.85);
    expect(s.trials).toBe(61);
    expect(s.succeeded).toBe(60);
  });

  it("recent failures pull ewmaSuccess down even after long success streak", () => {
    let s = ingestTrial(undefined, { channel: "a", outcome: "succeeded", ms: 100, ts: 0 });
    for (let i = 0; i < 30; i++) s = ingestTrial(s, { channel: "a", outcome: "succeeded", ms: 100, ts: i });
    const before = s.ewmaSuccess;
    for (let i = 0; i < 30; i++) s = ingestTrial(s, { channel: "a", outcome: "failed", ms: 100, ts: i });
    expect(s.ewmaSuccess).toBeLessThan(before);
    expect(s.ewmaSuccess).toBeLessThan(0.5);
  });
});

describe("v2.6 WORMHOLE · pulse", () => {
  it("formatWormholePulseLine OK case", async () => {
    const r = await sendViaWormhole({ payload: "x", channels: [fakeChannel("a")] });
    expect(formatWormholePulseLine(r)).toContain("OK");
    expect(formatWormholePulseLine(r)).toContain("winner=a");
  });

  it("formatWormholePulseLine NO-CHANNEL case", async () => {
    const r = await sendViaWormhole({ payload: "x", channels: [fakeChannel("a", { probe: "unavailable" })] });
    expect(formatWormholePulseLine(r)).toContain("NO-CHANNEL");
  });
});
