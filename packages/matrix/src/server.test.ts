import { describe, it, expect } from "vitest";
import { createMatrixServer, discoveryPath } from "./server.js";
import { connect, health, invoke, pipeInvoke, contextStream, verifyReply } from "./client.js";
import { grpcGauntlet } from "./gauntlet.js";
import { matrix, trustless } from "@mneme-ai/core";
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

  it("ContextStream (Phase 2 delta channel): ops apply server-side byte-exact + acks are compact", { retry: 2, timeout: 30_000 }, async () => {
    const srv = await createMatrixServer({ port: 0 });
    const client = connect(`127.0.0.1:${srv.port}`);
    try {
      const base = "const a = 1;\n".repeat(400); // ~5KB doc
      const ops: matrix.SpliceOp[] = [];
      for (let i = 0; i < 20; i++) ops.push({ at: (i * 31) % base.length, del: i % 2, ins: `/*${i}*/` });
      const acks = await contextStream(client, base, ops);
      // first ack is the snapshot ack; then one per op
      expect(acks.length).toBe(ops.length + 1);
      // the server's final doc hash must equal the LOCAL pure replay (byte-exact)
      const local = matrix.deltaStream(base, ops);
      expect(acks[acks.length - 1].doc_hash).toBe(local.finalHash);
      // every op ack is compact (a hash + ints, far smaller than the doc)
      expect(acks.slice(1).every((a) => a.ok && a.delta_bytes < base.length)).toBe(true);
    } finally { client.close(); await srv.stop(); }
  });

  it("Phase 4: a genuine Invoke proof verifies offline; a tampered one is rejected", () => {
    // construct a genuine proof-carrying reply the way the server does (proofWrap)
    const wrapped = trustless.proofWrap(process.cwd(), "matrix:test", { value: 42, note: "ok" }) as Record<string, unknown>;
    const proof = wrapped["_proof"];
    const { _proof, ...data } = wrapped; void _proof;
    const good = { ok: true, data_json: JSON.stringify(data), wisdom: "", proof_json: JSON.stringify(proof), error: "" };
    expect(verifyReply(good).verified).toBe(true);
    const tampered = { ...good, data_json: JSON.stringify({ value: 999, note: "ok" }) };
    expect(verifyReply(tampered).verified).toBe(false);
    expect(verifyReply({ ok: true, data_json: "{}", wisdom: "", proof_json: "", error: "" }).verified).toBe(false);
  });

  it("Health + unary Invoke work; unknown tool fails clean, server stays up", { retry: 2, timeout: 30_000 }, async () => {
    const srv = await createMatrixServer({ port: 0 });
    const client = connect(`127.0.0.1:${srv.port}`);
    try {
      const h = await health(client);
      expect(h.ok).toBe(true);
      expect(h.trustless).toBe(true);
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
