/**
 * THE MATRIX RAIL — gRPC wire server (local-first).
 *
 * The wire shell around @mneme-ai/core's pipe core. Any AI agent, any language,
 * connects over HTTP/2 + Protobuf to reach EVERY Mneme function through one typed
 * door — and a chunked bidi pipe so any-size payload flows byte-identical.
 *
 * Molecules of intelligence at every joint:
 *   • binds 127.0.0.1 ONLY (insecure creds are fine on loopback — no network, air-gap intact)
 *   • Invoke bridges to the SAME tool registry the MCP server uses (buildRuntime +
 *     buildToolMap) → all ~960 tools, zero logic duplication, seamless
 *   • every Invoke response carries a TRUSTLESS Ed25519 `_proof` (verify offline)
 *   • Pipe reassembles with the core's full integrity check (dropped/reordered/
 *     tampered chunk caught) and re-chunks the reply → the 4MB cap is never hit
 *   • every handler is TOTAL — a thrown tool never crashes the server
 *   • fail-open: if a tool/runtime is unavailable, the call returns ok:false, the
 *     server stays up, and the agent can fall back to MCP/CLI
 */
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { trustless, matrix } from "@mneme-ai/core";
import { buildRuntime, buildToolMap } from "@mneme-ai/mcp";
import { createRequire } from "node:module";
import { writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs";

/** The discovery file any agent reads to find the running rail (zero-command wiring). */
export function discoveryPath(cwd: string): string { return join(cwd, ".mneme", "matrix.json"); }

const PROTO_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "proto", "mneme.proto");
const req = createRequire(import.meta.url);
function version(): string { try { return (req("../package.json") as { version?: string }).version ?? "0.0.0"; } catch { return "0.0.0"; } }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadMatrixService(): any {
  const def = protoLoader.loadSync(PROTO_PATH, { keepCase: true, longs: Number, enums: String, defaults: true, oneofs: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pkg = grpc.loadPackageDefinition(def) as any;
  return pkg.mneme.Matrix.service;
}

export interface ServeOptions {
  cwd?: string;
  host?: string;   // default 127.0.0.1 — loopback only
  port?: number;   // default 0 = ephemeral (tests); pass a fixed port to serve
  idleMs?: number; // self-reap after this much idle (default 15min; 0 = never)
}

export interface RunningServer {
  server: grpc.Server;
  port: number;
  host: string;
  stop: () => Promise<void>;
}

interface WireFrame { id: string; seq: number; total: number; orig_bytes: number; gz: boolean; data: Buffer }

const toWire = (f: matrix.Frame): WireFrame => ({ id: f.id, seq: f.seq, total: f.total, orig_bytes: f.origBytes, gz: f.gz, data: Buffer.from(f.data) });
const fromWire = (w: WireFrame): matrix.Frame => ({ id: String(w.id), seq: Number(w.seq), total: Number(w.total), origBytes: Number(w.orig_bytes), gz: !!w.gz, data: w.data instanceof Uint8Array ? w.data : Uint8Array.from(w.data ?? []) });

/** Build the gRPC service implementation bound to a repo root. Pure of network.
 *  `touch` is called on every request so the server can self-reap when idle. */
export function buildImpl(cwd: string, touch: () => void = () => {}) {
  const toolMap = buildToolMap();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let runtime: any = null;
  let runtimeErr = "";
  async function getRuntime() {
    if (runtime) return runtime;
    if (runtimeErr) return null;
    try { runtime = await buildRuntime(cwd); return runtime; }
    catch (e) { runtimeErr = (e as Error).message; return null; }
  }

  /** The bridge: a tool name + JSON args → a proof-carrying ToolResponse. Total. */
  async function invoke(tool: string, argsJson: string, _heldRoot?: string) {
    try {
      // infra self-test fast-paths — no runtime, no registry (so the wire can be
      // proven for any-size data without building the heavy store/embedder).
      if (tool === "matrix.ping") return { ok: true, data_json: JSON.stringify({ pong: true, version: version() }), wisdom: "pong", proof_json: "", error: "" };
      if (tool === "matrix.echo") return { ok: true, data_json: argsJson || "{}", wisdom: "echo", proof_json: "", error: "" };
      const t = toolMap.get(tool);
      if (!t) return { ok: false, data_json: "{}", wisdom: "", proof_json: "", error: `unknown tool: ${tool}` };
      const rt = await getRuntime();
      if (!rt) return { ok: false, data_json: "{}", wisdom: "", proof_json: "", error: `runtime unavailable: ${runtimeErr}` };
      let args: Record<string, unknown> = {};
      try { args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {}; } catch { return { ok: false, data_json: "{}", wisdom: "", proof_json: "", error: "args_json is not valid JSON" }; }
      const resp = await t.handler(rt, args);
      const data = (resp?.data ?? {}) as Record<string, unknown>;
      // proof-per-message: bind the response data to an offline-verifiable Ed25519 receipt
      const wrapped = trustless.proofWrap(cwd, `matrix:${tool}`, typeof data === "object" && data ? data : { value: data }) as Record<string, unknown>;
      const proof = wrapped["_proof"];
      return { ok: true, data_json: JSON.stringify(data), wisdom: String(resp?.wisdom ?? ""), proof_json: JSON.stringify(proof ?? null), error: "" };
    } catch (e) {
      return { ok: false, data_json: "{}", wisdom: "", proof_json: "", error: (e as Error).message };
    }
  }

  return {
    // unary
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Invoke: (call: any, cb: any) => {
      touch();
      const r = call.request ?? {};
      invoke(String(r.tool ?? ""), String(r.args_json ?? ""), r.held_root).then((res) => cb(null, res)).catch((e) => cb(null, { ok: false, data_json: "{}", wisdom: "", proof_json: "", error: (e as Error).message }));
    },
    // unary
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Health: (_call: any, cb: any) => { touch(); cb(null, { ok: true, version: version(), tools: toolMap.size, note: "Matrix Rail — 127.0.0.1, proof-carrying, chunked pipe, delta channel", trustless: true }); },
    // CONTEXT STREAM (Phase 2) — the delta channel. Per channel_id, hold a doc;
    // the opening snapshot sets the base, each op applies a splice + replies with a
    // COMPACT ack (hash + sizes, never the whole doc). Byte-exact + measured saving.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ContextStream: (call: any) => {
      touch();
      const channels = new Map<string, matrix.ContextChannel>();
      call.on("data", (m: { channel_id?: string; snapshot?: boolean; base?: string; op_json?: string }) => {
        touch();
        try {
          const id = String(m.channel_id ?? "default");
          if (m.snapshot) { channels.set(id, new matrix.ContextChannel(String(m.base ?? ""))); call.write({ ok: true, doc_hash: "", doc_len: String(m.base ?? "").length, delta_bytes: 0, error: "" }); return; }
          const ch = channels.get(id);
          if (!ch) { call.write({ ok: false, doc_hash: "", doc_len: 0, delta_bytes: 0, error: "no snapshot for channel — send snapshot:true first" }); return; }
          const op = JSON.parse(String(m.op_json ?? "{}")) as matrix.SpliceOp;
          const ack = ch.apply(op);
          call.write({ ok: ack.ok, doc_hash: ack.docHash, doc_len: ack.docLen, delta_bytes: ack.deltaBytes, error: ack.error ?? "" });
        } catch (e) { try { call.write({ ok: false, doc_hash: "", doc_len: 0, delta_bytes: 0, error: (e as Error).message }); } catch { /* */ } }
      });
      call.on("error", () => { try { call.end(); } catch { /* */ } });
      call.on("end", () => { try { call.end(); } catch { /* */ } });
    },
    // bidi stream: client streams request frames → reassemble → invoke → stream reply frames
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Pipe: (call: any) => {
      touch();
      const frames: matrix.Frame[] = [];
      call.on("data", (w: WireFrame) => { touch(); try { frames.push(fromWire(w)); } catch { /* skip bad frame */ } });
      call.on("error", () => { try { call.end(); } catch { /* */ } });
      call.on("end", () => {
        (async () => {
          try {
            const asm = matrix.reassemble(frames);
            if (!asm.ok) { for (const f of matrix.chunkFrame(JSON.stringify({ ok: false, error: `pipe integrity: ${asm.reason}` }))) call.write(toWire(f)); call.end(); return; }
            const reqMsg = matrix.decodeRequest(asm.payload);
            if (!reqMsg) { for (const f of matrix.chunkFrame(JSON.stringify({ ok: false, error: "pipe payload is not a ToolRequest" }))) call.write(toWire(f)); call.end(); return; }
            const res = await invoke(reqMsg.tool, reqMsg.argsJson, reqMsg.heldRoot);
            for (const f of matrix.chunkFrame(JSON.stringify(res))) call.write(toWire(f));
            call.end();
          } catch (e) {
            try { for (const f of matrix.chunkFrame(JSON.stringify({ ok: false, error: (e as Error).message }))) call.write(toWire(f)); call.end(); } catch { /* */ }
          }
        })();
      });
    },
  };
}

/** Start the Matrix gRPC server on loopback. Resolves with the bound port. */
export function createMatrixServer(opts: ServeOptions = {}): Promise<RunningServer> {
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 0;
  const cwd = opts.cwd ?? process.cwd();
  // SELF-REAPING: the rail shuts itself down after `idleMs` with no requests, so a
  // demand-spawned rail never lingers as an orphan (0 = never reap; tests pass 0).
  const idleMs = opts.idleMs ?? 900_000; // 15 min default
  let lastActivity = Date.now();
  const touch = () => { lastActivity = Date.now(); };

  const server = new grpc.Server({
    // we CHUNK, so we never need to raise the cap — but keep it explicit + sane.
    "grpc.max_receive_message_length": 8 * 1024 * 1024,
    "grpc.max_send_message_length": 8 * 1024 * 1024,
  });
  server.addService(loadMatrixService(), buildImpl(cwd, touch));
  return new Promise<RunningServer>((resolve, reject) => {
    server.bindAsync(`${host}:${port}`, grpc.ServerCredentials.createInsecure(), (err, boundPort) => {
      if (err) return reject(err);
      // write the discovery file so any agent (any language) finds the rail with
      // NO user command. Best-effort + only for the default loopback serve (skip
      // ephemeral test ports so parallel tests don't fight over the file).
      const disc = discoveryPath(cwd);
      const writeDiscovery = host === "127.0.0.1" && (opts.port ?? 0) !== 0;
      if (writeDiscovery) {
        try {
          mkdirSync(join(cwd, ".mneme"), { recursive: true });
          writeFileSync(disc, JSON.stringify({ host, port: boundPort, pid: process.pid, version: version(), proto: PROTO_PATH, idleMs, at: new Date().toISOString() }));
        } catch { /* best-effort */ }
      }
      const cleanup = () => { if (writeDiscovery) { try { if (existsSync(disc)) rmSync(disc); } catch { /* */ } } };
      const stop = () => new Promise<void>((res) => { if (reaper) clearInterval(reaper); server.tryShutdown(() => { cleanup(); res(); }); });
      // the idle reaper — unref'd so it never keeps the process alive on its own.
      let reaper: ReturnType<typeof setInterval> | null = null;
      if (idleMs > 0) {
        reaper = setInterval(() => { if (Date.now() - lastActivity > idleMs) { void stop(); } }, Math.min(60_000, Math.max(1_000, Math.floor(idleMs / 5))));
        if (typeof reaper.unref === "function") reaper.unref();
      }
      resolve({ server, port: boundPort, host, stop });
    });
  });
}
