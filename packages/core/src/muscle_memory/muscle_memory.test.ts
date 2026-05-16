import { describe, it, expect } from "vitest";
import {
  MuscleDispatcher,
  benchmarkMuscleSpeedup,
  suggestedSocketPath,
  formatMuscleStatusLine,
} from "./index.js";

const SECRET = "muscle-test-secret-554477";

describe("v2.19.12 MUSCLE MEMORY · dispatcher protocol", () => {
  it("round-trips a signed frame to a registered handler", async () => {
    const d = new MuscleDispatcher({
      secret: SECRET,
      handlers: { "echo": async (_c, args) => ({ got: args }) },
    });
    const reply = await d.call({ cmd: "echo", args: { foo: 1 }, secret: SECRET });
    expect(reply.ok).toBe(true);
    expect(reply.data).toEqual({ got: { foo: 1 } });
    expect(reply.requestId).toMatch(/^req-/);
  });

  it("rejects a frame whose hmac was tampered", async () => {
    const d = new MuscleDispatcher({ secret: SECRET, handlers: { ping: async () => "pong" } });
    const frame = d.buildFrame({ cmd: "ping", secret: SECRET });
    const forged = { ...frame, hmac: "deadbeef".repeat(8) };
    const reply = await d.handleFrame(forged);
    expect(reply.ok).toBe(false);
    expect(reply.error).toBe("hmac-mismatch");
  });

  it("rejects a stale frame older than the nonce window", async () => {
    let clock = 1_000_000;
    const d = new MuscleDispatcher({
      secret: SECRET,
      handlers: { ping: async () => "pong" },
      now: () => clock,
    });
    const frame = d.buildFrame({ cmd: "ping", secret: SECRET, ts: 0 });
    clock = 200_000; // way past 60s window
    const reply = await d.handleFrame(frame);
    expect(reply.ok).toBe(false);
    expect(reply.error).toBe("stale-frame");
  });

  it("rejects a replayed frame (same nonce twice)", async () => {
    const d = new MuscleDispatcher({ secret: SECRET, handlers: { ping: async () => "pong" } });
    const frame = d.buildFrame({ cmd: "ping", secret: SECRET });
    const first = await d.handleFrame(frame);
    expect(first.ok).toBe(true);
    const replay = await d.handleFrame(frame);
    expect(replay.ok).toBe(false);
    expect(replay.error).toBe("replay-detected");
  });

  it("returns unknown-command on a handler that's not registered", async () => {
    const d = new MuscleDispatcher({ secret: SECRET, handlers: { ping: async () => "pong" } });
    const reply = await d.call({ cmd: "fly_to_mars", secret: SECRET });
    expect(reply.ok).toBe(false);
    expect(reply.error).toContain("unknown-command");
  });

  it("surfaces handler errors verbatim", async () => {
    const d = new MuscleDispatcher({
      secret: SECRET,
      handlers: { boom: async () => { throw new Error("handler-explosion"); } },
    });
    const reply = await d.call({ cmd: "boom", secret: SECRET });
    expect(reply.ok).toBe(false);
    expect(reply.error).toBe("handler-explosion");
  });
});

describe("v2.19.12 MUSCLE MEMORY · benchmark + status", () => {
  it("benchmarkMuscleSpeedup proves cold > warm latency (the speedup invariant)", async () => {
    const r = await benchmarkMuscleSpeedup({ iterations: 20, workMs: 500 });
    expect(r.iterations).toBe(20);
    expect(r.coldMs).toBeGreaterThan(r.avgWarmMs);
    expect(r.speedupFactor).toBeGreaterThan(10);
  });

  it("status counts cold-equivalent + warm calls + reports p95", async () => {
    const d = new MuscleDispatcher({
      secret: SECRET,
      handlers: { ping: async () => "pong" },
    });
    for (let i = 0; i < 5; i++) await d.call({ cmd: "ping", secret: SECRET });
    const s = d.status();
    expect(s.totalCalls).toBe(5);
    expect(s.coldCalls).toBe(1);
    expect(s.warmCalls).toBe(4);
    expect(s.p95LatencyMs).toBeGreaterThanOrEqual(0);
  });

  it("formatter line reflects status invariants", () => {
    const line = formatMuscleStatusLine({
      warmCalls: 9, coldCalls: 1, totalCalls: 10,
      avgWarmLatencyMs: 12, p95LatencyMs: 14, speedupFactor: 66.6,
    });
    expect(line).toContain("MUSCLE");
    expect(line).toContain("66.6x");
  });
});

describe("v2.19.12 MUSCLE MEMORY · suggestedSocketPath", () => {
  it("returns a deterministic path tied to the repo (same repo => same path)", () => {
    const a = suggestedSocketPath({ repoPath: "/home/u/proj" });
    const b = suggestedSocketPath({ repoPath: "/home/u/proj" });
    expect(a).toBe(b);
  });

  it("differs per repo (no accidental cross-repo socket collision)", () => {
    const a = suggestedSocketPath({ repoPath: "/home/u/proj-a" });
    const b = suggestedSocketPath({ repoPath: "/home/u/proj-b" });
    expect(a).not.toBe(b);
  });

  it("uses Windows named-pipe prefix on win32, unix-socket path elsewhere", () => {
    const p = suggestedSocketPath({ repoPath: "/x" });
    if (process.platform === "win32") {
      expect(p.startsWith("\\\\.\\pipe\\")).toBe(true);
    } else {
      expect(p.endsWith(".sock")).toBe(true);
    }
  });
});
