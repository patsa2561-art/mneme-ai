import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CloudConnectivity } from "./cloud_connectivity.js";

describe("CloudConnectivity · state cache + probe", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-cloud-")); vi.restoreAllMocks(); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("readState returns 'unknown' on a fresh repo (no cache file yet)", () => {
    const c = new CloudConnectivity({ baseUrl: "https://nope.invalid", repoRoot: repo });
    expect(c.readState().state).toBe("unknown");
  });

  it("probe writes a state file + returns 'offline' on unreachable host", async () => {
    const c = new CloudConnectivity({ baseUrl: "https://10.0.0.255:65000", repoRoot: repo, probeTimeoutMs: 1000 });
    const s = await c.probe();
    expect(s.state).toBe("offline");
    expect(s.reason).toMatch(/probe failed/);
    expect(existsSync(join(repo, ".mneme/cloud-state.json"))).toBe(true);
  });

  it("ensureProbed uses cache when fresh + probes when stale", async () => {
    // First call: cache empty → triggers probe (offline because invalid host)
    const c = new CloudConnectivity({ baseUrl: "https://10.0.0.255:65000", repoRoot: repo, probeTimeoutMs: 500, ttlMs: 60_000 });
    const s1 = await c.ensureProbed();
    expect(s1.state).toBe("offline");
    // Second call: cache fresh — does NOT re-probe (we'd see another fetch attempt take ~500ms)
    const start = Date.now();
    const s2 = await c.ensureProbed();
    expect(Date.now() - start).toBeLessThan(50);    // cache hit, no network
    expect(s2.state).toBe(s1.state);
  });

  it("explain produces a one-line human-readable summary", () => {
    const c = new CloudConnectivity({ baseUrl: "https://x.invalid", repoRoot: repo });
    const text = c.explain();
    expect(text).toContain("unknown");
    expect(text).toContain("last probe");
  });
});

describe("CloudConnectivity · queue + drain", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-cloud-")); vi.restoreAllMocks(); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("enqueue + readQueue round-trip", () => {
    const c = new CloudConnectivity({ baseUrl: "https://x.invalid", repoRoot: repo });
    c.enqueue({ id: "a-1", path: "/v1/compliance", payload: { x: 1 } });
    c.enqueue({ id: "a-2", path: "/v1/compliance", payload: { x: 2 } });
    const q = c.readQueue();
    expect(q).toHaveLength(2);
    expect(q[0]!.id).toBe("a-1");
    expect(q[0]!.attempts).toBe(0);
  });

  it("drainQueue early-returns when cloud is offline (no events lost)", async () => {
    const c = new CloudConnectivity({ baseUrl: "https://10.0.0.255:65000", repoRoot: repo, probeTimeoutMs: 500 });
    c.enqueue({ id: "a-1", path: "/v1/compliance", payload: {} });
    const r = await c.drainQueue();
    expect(r.attempted).toBe(0);
    expect(r.succeeded).toBe(0);
    expect(r.remaining).toBe(1);
    expect(c.readQueue()).toHaveLength(1);   // event still there
  });

  it("tryRequest falls back to local fn when probe is offline", async () => {
    const c = new CloudConnectivity({ baseUrl: "https://10.0.0.255:65000", repoRoot: repo, probeTimeoutMs: 500 });
    let onlineCalled = false;
    let localCalled = false;
    const result = await c.tryRequest(
      async () => { onlineCalled = true; return "from-cloud"; },
      () => { localCalled = true; return "from-local"; },
    );
    expect(localCalled).toBe(true);
    expect(onlineCalled).toBe(false);
    expect(result).toBe("from-local");
  });

  it("tryRequest tries cloud first when state is online (mocked fetch)", async () => {
    const c = new CloudConnectivity({ baseUrl: "https://x.invalid", repoRoot: repo });
    // Inject an "online" cached state by writing the file directly.
    const fs = await import("node:fs");
    fs.mkdirSync(join(repo, ".mneme"), { recursive: true });
    fs.writeFileSync(join(repo, ".mneme/cloud-state.json"), JSON.stringify({ state: "online", lastProbe: new Date().toISOString(), latencyMs: 50, cloudVersion: "test", reason: "test" }));
    let onlineCalled = false;
    const result = await c.tryRequest(
      async () => { onlineCalled = true; return "from-cloud"; },
      () => "from-local",
    );
    expect(onlineCalled).toBe(true);
    expect(result).toBe("from-cloud");
  });
});
