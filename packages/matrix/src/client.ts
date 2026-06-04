/**
 * Matrix Rail gRPC client helpers — used by tests, the gauntlet, the CLI, and as
 * the reference any-language agents follow. Unary Invoke + chunked Pipe.
 */
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { matrix } from "@mneme-ai/core";

const PROTO_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "proto", "mneme.proto");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MatrixClientCtor(): any {
  const def = protoLoader.loadSync(PROTO_PATH, { keepCase: true, longs: Number, enums: String, defaults: true, oneofs: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pkg = grpc.loadPackageDefinition(def) as any;
  return pkg.mneme.Matrix;
}

export interface MatrixClient { _c: grpc.Client; close: () => void }
export interface ToolReply { ok: boolean; data_json: string; wisdom: string; proof_json: string; error: string }

export function connect(addr: string): MatrixClient {
  const Ctor = MatrixClientCtor();
  const c = new Ctor(addr, grpc.credentials.createInsecure(), {
    "grpc.max_receive_message_length": 8 * 1024 * 1024,
    "grpc.max_send_message_length": 8 * 1024 * 1024,
  });
  return { _c: c, close: () => c.close() };
}

export function health(client: MatrixClient): Promise<{ ok: boolean; version: string; tools: number; note: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Promise((resolve, reject) => (client._c as any).Health({}, (e: Error | null, r: { ok: boolean; version: string; tools: number; note: string }) => (e ? reject(e) : resolve(r))));
}

/** Unary Invoke — the typed door to any tool. */
export function invoke(client: MatrixClient, tool: string, argsJson = "{}", heldRoot = ""): Promise<ToolReply> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Promise((resolve, reject) => (client._c as any).Invoke({ tool, args_json: argsJson, held_root: heldRoot }, (e: Error | null, r: ToolReply) => (e ? reject(e) : resolve(r))));
}

interface WireFrame { id: string; seq: number; total: number; orig_bytes: number; gz: boolean; data: Buffer }
const toWire = (f: matrix.Frame): WireFrame => ({ id: f.id, seq: f.seq, total: f.total, orig_bytes: f.origBytes, gz: f.gz, data: Buffer.from(f.data) });
const fromWire = (w: WireFrame): matrix.Frame => ({ id: String(w.id), seq: Number(w.seq), total: Number(w.total), origBytes: Number(w.orig_bytes), gz: !!w.gz, data: w.data instanceof Uint8Array ? w.data : Uint8Array.from(w.data ?? []) });

/**
 * Pipe-invoke: send the request through the CHUNKED bidi pipe (any size, integrity-
 * checked) and reassemble the reply. Proves a large payload flows past the 4MB cap.
 */
export function pipeInvoke(client: MatrixClient, tool: string, argsJson = "{}", heldRoot = ""): Promise<ToolReply> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = (client._c as any).Pipe();
    const replyFrames: matrix.Frame[] = [];
    call.on("data", (w: WireFrame) => { try { replyFrames.push(fromWire(w)); } catch { /* */ } });
    call.on("error", (e: Error) => reject(e));
    call.on("end", () => {
      const asm = matrix.reassemble(replyFrames);
      if (!asm.ok) return reject(new Error(`reply pipe integrity: ${asm.reason}`));
      try { resolve(JSON.parse(new TextDecoder().decode(asm.payload)) as ToolReply); }
      catch (e) { reject(e as Error); }
    });
    // stream the request as frames
    const reqBytes = new TextEncoder().encode(JSON.stringify({ tool, argsJson, heldRoot }));
    for (const f of matrix.chunkFrame(reqBytes)) call.write(toWire(f));
    call.end();
  });
}
