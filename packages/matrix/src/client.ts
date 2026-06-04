/**
 * Matrix Rail gRPC client helpers — used by tests, the gauntlet, the CLI, and as
 * the reference any-language agents follow. Unary Invoke + chunked Pipe.
 */
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { matrix, trustless } from "@mneme-ai/core";

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

export function health(client: MatrixClient): Promise<{ ok: boolean; version: string; tools: number; note: string; trustless: boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Promise((resolve, reject) => (client._c as any).Health({}, (e: Error | null, r: { ok: boolean; version: string; tools: number; note: string; trustless: boolean }) => (e ? reject(e) : resolve(r))));
}

/** Phase 4 — verify an Invoke reply's TRUSTLESS proof OFFLINE (provenance + integrity).
 *  Reconstructs {data, _proof} and runs the same Ed25519 + dataHash check the
 *  caller would: the receipt must be a valid signature that commits to the hash of
 *  the reply's data. Returns valid=false when absent/tampered. No Mneme, no network. */
export function verifyReply(reply: ToolReply): { verified: boolean; reason: string } {
  try {
    if (!reply?.proof_json) return { verified: false, reason: "no proof on reply (would have to TRUST it)" };
    const data = reply.data_json ? (JSON.parse(reply.data_json) as Record<string, unknown>) : {};
    const proof = JSON.parse(reply.proof_json) as unknown;
    const v = trustless.verifyToolResult({ ...data, _proof: proof });
    return { verified: v.valid, reason: v.reason };
  } catch (e) { return { verified: false, reason: (e as Error).message }; }
}

export interface ToolInfoWire { name: string; category: string; description: string; input_schema_json: string }
export interface ToolHitWire { name: string; category: string; description: string; score: number; why: string }

/** ListTools — self-describing discovery: the full tool surface + each JSON Schema. */
export function listTools(client: MatrixClient, query = "", limit = 0): Promise<{ tools: ToolInfoWire[]; total: number; returned: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Promise((resolve, reject) => (client._c as any).ListTools({ query, limit }, (e: Error | null, r: { tools: ToolInfoWire[]; total: number; returned: number }) => (e ? reject(e) : resolve(r))));
}

/** Search — intent → ranked tool hits (the autonomous-discovery path). */
export function search(client: MatrixClient, intent: string, limit = 8): Promise<{ hits: ToolHitWire[]; considered: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Promise((resolve, reject) => (client._c as any).Search({ intent, limit }, (e: Error | null, r: { hits: ToolHitWire[]; considered: number }) => (e ? reject(e) : resolve(r))));
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

export interface DeltaAckWire { ok: boolean; doc_hash: string; doc_len: number; delta_bytes: number; error: string }

/** ContextStream (Phase 2): open with a snapshot, stream splice ops, collect the
 *  compact acks. The reference flow any-language agents follow for the delta channel. */
export function contextStream(client: MatrixClient, base: string, ops: matrix.SpliceOp[], channelId = "c1"): Promise<DeltaAckWire[]> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = (client._c as any).ContextStream();
    const acks: DeltaAckWire[] = [];
    call.on("data", (a: DeltaAckWire) => acks.push(a));
    call.on("error", (e: Error) => reject(e));
    call.on("end", () => resolve(acks));
    call.write({ channel_id: channelId, snapshot: true, base, op_json: "" });
    for (const op of ops) call.write({ channel_id: channelId, snapshot: false, base: "", op_json: JSON.stringify(op) });
    call.end();
  });
}
