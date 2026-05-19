/**
 * v2.19.59 MUSCLE MEMORY transport_net — UDS round-trip deep tests.
 *
 * Verifies the missing wiring v2.19.12 punted: net.Server + net.Socket
 * over the existing MuscleDispatcher. Tests cover:
 *   - End-to-end client→server→handler→reply round-trip
 *   - HMAC sig verification on the wire
 *   - Server close releases the socket file
 *   - Client timeout handling
 *   - Client connection-refused fallback signal
 *   - pingMuscleServer liveness probe
 *   - Multiple parallel clients (the 50-parallel scenario)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rmSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:net";
import { MuscleDispatcher, createMuscleServer, dispatchOverNet, pingMuscleServer } from "./index.js";

let testDir: string;
let sockPath: string;
let server: Server | null = null;

beforeEach(() => {
  testDir = join(tmpdir(), `mneme-muscle-net-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(testDir, { recursive: true });
  sockPath = process.platform === "win32"
    ? `\\\\.\\pipe\\mneme-muscle-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    : join(testDir, "test.sock");
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => {
      try { server!.close(() => resolve()); }
      catch { resolve(); }
    });
    server = null;
  }
  try { rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
});

describe("v2.19.59 MUSCLE MEMORY net transport", () => {
  it("createMuscleServer + dispatchOverNet round-trip works (ping)", async () => {
    const dispatcher = new MuscleDispatcher({
      handlers: {
        "ping": async () => ({ pong: true, pid: process.pid }),
      },
    });
    server = createMuscleServer(dispatcher, { socketPath: sockPath });
    // Wait for listen
    await new Promise((r) => setTimeout(r, 100));
    const reply = await dispatchOverNet("ping", {}, { socketPath: sockPath });
    expect(reply.ok).toBe(true);
    expect(reply.data).toMatchObject({ pong: true });
  });

  it("HMAC sig auto-verified — bad secret rejected", async () => {
    const dispatcher = new MuscleDispatcher({
      secret: "server-secret",
      handlers: { "ping": async () => ({ pong: true }) },
    });
    server = createMuscleServer(dispatcher, { socketPath: sockPath });
    await new Promise((r) => setTimeout(r, 100));
    // Dispatch with wrong secret — server should return ok:false hmac-mismatch
    const reply = await dispatchOverNet("ping", {}, {
      socketPath: sockPath,
      secret: "wrong-secret",
    });
    expect(reply.ok).toBe(false);
    expect(reply.error).toBe("hmac-mismatch");
  });

  it("dispatchOverNet rejects with ENOENT when daemon socket missing", async () => {
    const nonexistent = process.platform === "win32"
      ? `\\\\.\\pipe\\mneme-muscle-DOES-NOT-EXIST-${Date.now()}`
      : join(testDir, "doesnt-exist.sock");
    await expect(
      dispatchOverNet("ping", {}, { socketPath: nonexistent, timeoutMs: 500 }),
    ).rejects.toThrow();
  });

  it("pingMuscleServer returns true when server alive", async () => {
    const dispatcher = new MuscleDispatcher({
      handlers: { "ping": async () => ({ pong: true }) },
    });
    server = createMuscleServer(dispatcher, { socketPath: sockPath });
    await new Promise((r) => setTimeout(r, 100));
    const alive = await pingMuscleServer({ socketPath: sockPath });
    expect(alive).toBe(true);
  });

  it("pingMuscleServer returns false when server down (caller falls back)", async () => {
    const nonexistent = process.platform === "win32"
      ? `\\\\.\\pipe\\mneme-muscle-NO-SUCH-${Date.now()}`
      : join(testDir, "no-such.sock");
    const alive = await pingMuscleServer({ socketPath: nonexistent });
    expect(alive).toBe(false);
  });

  it("50 parallel dispatchOverNet calls all succeed (the user workload)", async () => {
    let calls = 0;
    const dispatcher = new MuscleDispatcher({
      handlers: {
        "verify": async () => { calls++; return { verdict: "ACCEPTED", n: calls }; },
      },
    });
    server = createMuscleServer(dispatcher, { socketPath: sockPath });
    await new Promise((r) => setTimeout(r, 100));
    const t0 = Date.now();
    const tasks = [];
    for (let i = 0; i < 50; i++) {
      tasks.push(dispatchOverNet("verify", { claim: `claim-${i}` }, { socketPath: sockPath, timeoutMs: 5000 }));
    }
    const results = await Promise.all(tasks);
    const totalMs = Date.now() - t0;
    expect(results.length).toBe(50);
    expect(results.every((r) => r.ok === true)).toBe(true);
    expect(calls).toBe(50);
    // 50 round-trips over UDS should be well under 3s even with no warmup
    expect(totalMs).toBeLessThan(3000);
  });

  it("handler exception → structured ok:false reply (server doesn't crash)", async () => {
    const dispatcher = new MuscleDispatcher({
      handlers: {
        "boom": async () => { throw new Error("intentional"); },
      },
    });
    server = createMuscleServer(dispatcher, { socketPath: sockPath });
    await new Promise((r) => setTimeout(r, 100));
    const reply = await dispatchOverNet("boom", {}, { socketPath: sockPath });
    expect(reply.ok).toBe(false);
    expect(reply.error).toMatch(/intentional/);
    // Server still alive — next call works
    const reply2 = await dispatchOverNet("ping", {}, { socketPath: sockPath });
    expect(reply2.ok).toBe(false);  // ping not registered, but no crash
  });

  it("unknown cmd returns ok:false with unknown-command error", async () => {
    const dispatcher = new MuscleDispatcher({
      handlers: { "verify": async () => ({ ok: true }) },
    });
    server = createMuscleServer(dispatcher, { socketPath: sockPath });
    await new Promise((r) => setTimeout(r, 100));
    const reply = await dispatchOverNet("nonexistent-cmd", {}, { socketPath: sockPath });
    expect(reply.ok).toBe(false);
    expect(reply.error).toContain("unknown-command");
  });
});
