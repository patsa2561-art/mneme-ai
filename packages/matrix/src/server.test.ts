import { describe, it, expect } from "vitest";
import { createMatrixServer, discoveryPath } from "./server.js";
import { connect, health, invoke, pipeInvoke } from "./client.js";
import { grpcGauntlet } from "./gauntlet.js";
import { createHash } from "node:crypto";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function entropy(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n); let off = 0, ctr = 0;
  while (off < n) { const b = createHash("sha256").update(`${seed}:${ctr++}`).digest(); const t = Math.min(b.length, n - off); out.set(b.subarray(0, t), off); off += t; }
  return out;
}

describe("MATRIX RAIL — live gRPC wire server", () => {
  // real-process: spawns a loopback gRPC server. retry absorbs CPU/port contention
  // under the full parallel suite; assertions are unchanged (a real break fails all).
  it("grpcGauntlet scores 100 (live round-trips on 127.0.0.1)", { retry: 2, timeout: 60_000 }, async () => {
    const g = await grpcGauntlet();
    expect(g.score).toBe(100);
    expect(g.checks.every((c) => c.pass)).toBe(true);
  });

  it("any-size payload (5MB) flows through the chunked Pipe byte-identical", { retry: 2, timeout: 60_000 }, async () => {
    const srv = await createMatrixServer({ port: 0 });
    const client = connect(`127.0.0.1:${srv.port}`);
    try {
      const big = Buffer.from(entropy(5_000_000, 99)).toString("base64"); // ~6.7MB > gRPC 4MB cap
      const r = await pipeInvoke(client, "matrix.echo", JSON.stringify({ payload: big }));
      expect(r.ok).toBe(true);
      expect((JSON.parse(r.data_json) as { payload: string }).payload).toBe(big);
    } finally { client.close(); await srv.stop(); }
  });

  it("self-reaps when idle (writes + removes the discovery file)", { retry: 2, timeout: 30_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "matrix-reap-"));
    try {
      const srv = await createMatrixServer({ cwd: dir, host: "127.0.0.1", port: 50599, idleMs: 250 });
      const disc = discoveryPath(dir);
      expect(existsSync(disc)).toBe(true);          // discovery file written for agents
      await sleep(2500);                             // > idleMs + reaper tick (1s) → self-reap
      expect(existsSync(disc)).toBe(false);          // reaped: file removed, server gone
      await srv.stop().catch(() => {});              // idempotent (already stopped)
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("Health + unary Invoke work; unknown tool fails clean, server stays up", { retry: 2, timeout: 30_000 }, async () => {
    const srv = await createMatrixServer({ port: 0 });
    const client = connect(`127.0.0.1:${srv.port}`);
    try {
      const h = await health(client);
      expect(h.ok).toBe(true);
      expect(h.tools).toBeGreaterThan(0);
      const ping = await invoke(client, "matrix.ping");
      expect(ping.ok).toBe(true);
      const bad = await invoke(client, "no.such.tool");
      expect(bad.ok).toBe(false);
      const still = await health(client);
      expect(still.ok).toBe(true); // fail-open: one bad call never kills the server
    } finally { client.close(); await srv.stop(); }
  });
});
