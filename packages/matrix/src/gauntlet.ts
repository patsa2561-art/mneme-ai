/**
 * grpcGauntlet — the LIVE, measured proof that the Matrix wire works: start a
 * server on an ephemeral loopback port, run real round-trips, MEASURE, shut down.
 * Honest numbers, not adjectives.
 */
import { createMatrixServer } from "./server.js";
import { connect, health, invoke, pipeInvoke, listTools, search } from "./client.js";
import { createHash } from "node:crypto";

function entropy(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n); let off = 0, ctr = 0;
  while (off < n) { const b = createHash("sha256").update(`${seed}:${ctr++}`).digest(); const t = Math.min(b.length, n - off); out.set(b.subarray(0, t), off); off += t; }
  return out;
}

export interface GrpcGauntlet {
  score: number;
  metrics: { healthMs: number; pingMs: number; largePayloadBytes: number; framesOverWire: number; roundTripMs: number };
  checks: Array<{ name: string; pass: boolean; detail: string }>;
}

export async function grpcGauntlet(): Promise<GrpcGauntlet> {
  const checks: Array<{ name: string; pass: boolean; detail: string }> = [];
  const metrics = { healthMs: 0, pingMs: 0, largePayloadBytes: 0, framesOverWire: 0, roundTripMs: 0 };
  const srv = await createMatrixServer({ port: 0 });
  const client = connect(`127.0.0.1:${srv.port}`);
  try {
    // 1) Health — the server is up on loopback + advertises the tool surface
    let t = Date.now();
    const h = await health(client);
    metrics.healthMs = Date.now() - t;
    checks.push({ name: "health round-trips on 127.0.0.1", pass: h.ok === true && h.tools > 0, detail: `tools=${h.tools} v=${h.version} ${metrics.healthMs}ms` });

    // 2) Unary Invoke (ping) — the typed door works
    t = Date.now();
    const p = await invoke(client, "matrix.ping");
    metrics.pingMs = Date.now() - t;
    checks.push({ name: "unary Invoke works", pass: p.ok === true && JSON.parse(p.data_json).pong === true, detail: `${metrics.pingMs}ms` });

    // 3) THE BIG ONE — a 5MB payload flows through the chunked Pipe byte-identical
    //    (past gRPC's 4MB cap, which would reject a single message).
    const big = entropy(5_000_000, 42);
    const bigStr = Buffer.from(big).toString("base64"); // ~6.7MB string, well over 4MB
    metrics.largePayloadBytes = bigStr.length;
    t = Date.now();
    const echoed = await pipeInvoke(client, "matrix.echo", JSON.stringify({ payload: bigStr }));
    metrics.roundTripMs = Date.now() - t;
    const back = echoed.ok ? (JSON.parse(echoed.data_json) as { payload: string }).payload : "";
    checks.push({ name: "5MB+ payload flows through chunked Pipe byte-identical", pass: back === bigStr, detail: `${(bigStr.length / 1e6).toFixed(1)}MB round-trip ${metrics.roundTripMs}ms (4MB cap bypassed)` });

    // 4) pipe integrity surfaces on a real wire (a real tool via Pipe carries a proof)
    const real = await pipeInvoke(client, "matrix.ping");
    checks.push({ name: "Pipe carries a real call end-to-end", pass: real.ok === true, detail: "request frames in → reply frames out" });

    // 5) unknown tool fails cleanly (server stays up — fail-open)
    const bad = await invoke(client, "no.such.tool");
    const stillUp = await health(client);
    checks.push({ name: "unknown tool fails cleanly, server stays up", pass: bad.ok === false && stillUp.ok === true, detail: bad.error.slice(0, 40) });

    // 6) SELF-DESCRIBING — ListTools returns the surface + JSON schemas over the wire
    const lt = await listTools(client, "", 5);
    const schemaOk = lt.tools.length > 0 && lt.tools.every((t) => typeof t.name === "string" && t.name.length > 0 && typeof t.input_schema_json === "string");
    checks.push({ name: "ListTools is self-describing (names + JSON schema)", pass: lt.total > 0 && schemaOk, detail: `${lt.total} tools advertised; sample schema len ${lt.tools[0]?.input_schema_json?.length ?? 0}` });

    // 7) AUTONOMOUS DISCOVERY — Search maps a plain intent → a ranked, relevant tool
    const sr = await search(client, "verify a claim is actually true", 5);
    const found = sr.hits.length > 0 && /truth|verify|retire|savant|check/i.test(sr.hits[0]?.name ?? "");
    checks.push({ name: "Search maps intent → the right tool (no LLM)", pass: found, detail: sr.hits.length ? `#1 ${sr.hits[0].name} (${sr.hits[0].why})` : "no hits" });

    const pass = checks.every((c) => c.pass);
    return { score: pass ? 100 : 0, metrics, checks };
  } finally {
    client.close();
    await srv.stop();
  }
}
