/**
 * THE MATRIX RAIL — the pipe core (transport-agnostic, gRPC-ready).
 *
 * The promise: ANY payload — 0 bytes, 1 byte, 50 MB, raw binary with NULs, emoji,
 * deeply-nested JSON — flows through the rail SMOOTHLY and arrives BYTE-IDENTICAL,
 * or the rail says exactly why (it never silently corrupts). gRPC's default 4 MB
 * message cap is not a wall here: a large payload is auto-split into ordered,
 * compressed, hash-manifested FRAMES and reassembled with a full integrity check.
 *
 * This is the substance under the gRPC transport (packages/matrix wraps it in
 * @grpc/grpc-js) — but it is PURE (node built-ins only: zlib + crypto), so the
 * "the pipe never breaks" guarantee is provable deterministically WITHOUT a live
 * server, and the size A/B is measured, not asserted.
 *
 * ★ NOVEL (the black-sheep core): every transmission carries a manifest hash so a
 *   dropped / reordered / duplicated / flipped chunk is caught at reassembly; the
 *   wire form is compressed (measured win); and the response can ride a TRUSTLESS
 *   Ed25519 `_proof` (verify offline). No other AI-context rail combines
 *   adaptive-chunking + per-stream integrity + proof-per-message.
 *
 * ★ HONEST (DIAKRISIS): the size A/B measures raw-JSON-utf8 vs gzipped-frame bytes
 *   (a real, built-in compression win) — NOT a Protobuf-specific number (that is
 *   measured in packages/matrix once @grpc/grpc-js lands). Chunking guarantees
 *   delivery integrity, NOT semantic correctness. Pure + total.
 */
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

const sha256 = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");
const enc = new TextEncoder();
const dec = new TextDecoder();
const toBytes = (p: Uint8Array | string): Uint8Array => (typeof p === "string" ? enc.encode(p) : p);

/** One frame on the wire: a compressed slice + the manifest needed to reassemble. */
export interface Frame {
  /** stream id (sha256 of the whole ORIGINAL payload — also the integrity manifest). */
  id: string;
  seq: number;        // 0-based order
  total: number;      // total frame count
  origBytes: number;  // length of the ORIGINAL (decompressed) payload
  gz: boolean;        // this frame's data is gzip-compressed
  data: Uint8Array;   // the (possibly compressed) slice
}

export interface ReassembleVerdict {
  ok: boolean;
  payload: Uint8Array;   // empty on failure
  reason: string;
}

const DEFAULT_CHUNK = 256 * 1024; // 256 KB compressed-slice target — well under gRPC's 4 MB cap

/**
 * Split any payload into ordered, compressed, manifest-bound frames. Total: an
 * empty payload yields exactly one (empty) frame so a 0-byte message still flows.
 */
export function chunkFrame(payload: Uint8Array | string, maxChunk = DEFAULT_CHUNK): Frame[] {
  try {
    const orig = toBytes(payload);
    const id = sha256(orig);
    const cap = Math.max(1024, Math.floor(maxChunk) || DEFAULT_CHUNK);
    // compress the WHOLE payload once, then slice the compressed bytes — so the
    // size win is real and the slices are uniform. Tiny/empty payloads skip gzip
    // (gzip overhead would make them bigger) and travel raw.
    let body: Uint8Array, gz: boolean;
    if (orig.length >= 64) { body = gzipSync(orig); gz = true; }
    else { body = orig; gz = false; }
    const slices: Uint8Array[] = [];
    for (let i = 0; i < body.length; i += cap) slices.push(body.subarray(i, Math.min(i + cap, body.length)));
    if (slices.length === 0) slices.push(new Uint8Array(0)); // 0-byte payload → one empty frame
    return slices.map((data, seq) => ({ id, seq, total: slices.length, origBytes: orig.length, gz, data }));
  } catch {
    return [];
  }
}

/**
 * Reassemble frames into the original bytes, verifying: every frame present, no
 * gaps/dupes, consistent manifest, and the sha256 of the result matches the id.
 * Catches dropped / reordered / duplicated / tampered chunks. Total.
 */
export function reassemble(frames: Frame[]): ReassembleVerdict {
  try {
    const list = Array.isArray(frames) ? frames.filter((f) => f && typeof f.seq === "number") : [];
    if (list.length === 0) return { ok: false, payload: new Uint8Array(0), reason: "no frames" };
    const id = list[0]!.id, total = list[0]!.total, gz = list[0]!.gz, origBytes = list[0]!.origBytes;
    // manifest consistency across all frames
    for (const f of list) {
      if (f.id !== id || f.total !== total || f.gz !== gz || f.origBytes !== origBytes) {
        return { ok: false, payload: new Uint8Array(0), reason: "frame manifest mismatch (mixed streams or tampered)" };
      }
    }
    // exactly-once coverage of [0, total)
    const bySeq = new Map<number, Frame>();
    for (const f of list) {
      if (f.seq < 0 || f.seq >= total) return { ok: false, payload: new Uint8Array(0), reason: `seq ${f.seq} out of range 0..${total - 1}` };
      if (bySeq.has(f.seq)) return { ok: false, payload: new Uint8Array(0), reason: `duplicate seq ${f.seq}` };
      bySeq.set(f.seq, f);
    }
    if (bySeq.size !== total) return { ok: false, payload: new Uint8Array(0), reason: `missing chunk(s): have ${bySeq.size}/${total}` };
    // concat in order
    let len = 0; for (const f of bySeq.values()) len += f.data.length;
    const body = new Uint8Array(len);
    let off = 0;
    for (let i = 0; i < total; i++) { const f = bySeq.get(i)!; body.set(f.data, off); off += f.data.length; }
    const orig = gz ? gunzipSync(body) : body;
    // integrity: the result must hash to the manifest id AND match origBytes
    if (orig.length !== origBytes) return { ok: false, payload: new Uint8Array(0), reason: `length mismatch: ${orig.length} != manifest ${origBytes}` };
    if (sha256(orig) !== id) return { ok: false, payload: new Uint8Array(0), reason: "integrity hash mismatch (corrupted/tampered)" };
    return { ok: true, payload: orig, reason: "ok" };
  } catch (e) {
    return { ok: false, payload: new Uint8Array(0), reason: `reassemble error: ${(e as Error).message}` };
  }
}

/** Round-trip a payload through the pipe (chunk → reassemble). Convenience + the
 *  thing the gauntlet hammers with pathological inputs. */
export function pipeRoundTrip(payload: Uint8Array | string, maxChunk = DEFAULT_CHUNK): ReassembleVerdict {
  return reassemble(chunkFrame(payload, maxChunk));
}

// ─────────────────────────── size A/B (measured) ───────────────────────────

export interface WireSize {
  rawBytes: number;       // JSON utf8 bytes (the status quo)
  wireBytes: number;      // gzipped frame bytes (what the rail sends)
  savedPct: number;       // 0..100, one decimal
  frames: number;
}

/** Measure the wire cost of a value: raw JSON utf8 vs the rail's compressed frames. */
export function wireSize(value: unknown, maxChunk = DEFAULT_CHUNK): WireSize {
  try {
    const json = JSON.stringify(value) ?? "null";
    const raw = enc.encode(json);
    const frames = chunkFrame(raw, maxChunk);
    const wire = frames.reduce((n, f) => n + f.data.length, 0);
    const savedPct = raw.length > 0 ? Math.round((1 - wire / raw.length) * 1000) / 10 : 0;
    return { rawBytes: raw.length, wireBytes: wire, savedPct, frames: frames.length };
  } catch {
    return { rawBytes: 0, wireBytes: 0, savedPct: 0, frames: 0 };
  }
}

// ─────────────────────────── the Invoke contract ───────────────────────────

export interface MatrixRequest { tool: string; argsJson: string; heldRoot?: string }
export interface MatrixResponse { dataJson: string; wisdom: string; proof?: { dataHash: string; receipt: unknown } }

/** Decode a request payload (already reassembled bytes) into a typed request. Total. */
export function decodeRequest(bytes: Uint8Array): MatrixRequest | null {
  try {
    const o = JSON.parse(dec.decode(bytes)) as MatrixRequest;
    if (!o || typeof o.tool !== "string") return null;
    return { tool: o.tool, argsJson: typeof o.argsJson === "string" ? o.argsJson : "{}", ...(o.heldRoot ? { heldRoot: o.heldRoot } : {}) };
  } catch { return null; }
}

// ───────────────────── CONTEXT STREAM — the delta channel (Phase 2) ─────────────────────
// "Send the DELTA, not the whole packet." A long edit/debug loop re-streams the
// whole context every turn — the compounding token cost the rail is built to kill.
// ContextStream holds the document on the server; the client streams tiny splice
// ops, the server applies them + returns a COMPACT ack (a hash + sizes, never the
// whole doc). Reconstruction is byte-exact (the ack hash == local hash) and the
// byte saving vs re-sending the full doc each turn is MEASURED. Pure + total.

/** A minimal, total text edit: delete `del` chars at `at`, insert `ins`. */
export interface SpliceOp { at: number; del: number; ins: string }

/** Apply one splice op to a document. Total — out-of-range is clamped, never throws. */
export function applySplice(doc: string, op: SpliceOp): string {
  const s = typeof doc === "string" ? doc : "";
  const at = Math.max(0, Math.min(s.length, Math.floor(op?.at ?? 0)));
  const del = Math.max(0, Math.min(s.length - at, Math.floor(op?.del ?? 0)));
  const ins = typeof op?.ins === "string" ? op.ins : "";
  return s.slice(0, at) + ins + s.slice(at + del);
}

export interface DeltaStreamResult {
  finalDoc: string;
  finalHash: string;      // sha256(finalDoc) — byte-exact reconstruction proof
  steps: number;
  deltaBytes: number;     // bytes actually sent (sum of op JSON) — the channel cost
  fullResendBytes: number; // bytes if you re-sent the WHOLE doc after each op — the naive cost
  savedPct: number;       // 1 - deltaBytes/fullResendBytes (0..1)
  hashes: string[];       // per-step doc hash (the compact acks the server returns)
}

/** Replay a base doc + a sequence of splice ops; measure delta-vs-full-resend. */
export function deltaStream(base: string, ops: SpliceOp[]): DeltaStreamResult {
  let doc = typeof base === "string" ? base : "";
  let deltaBytes = enc.encode(JSON.stringify({ snapshot: doc })).length; // initial snapshot is sent once
  let fullResendBytes = 0;
  const hashes: string[] = [];
  for (const op of ops ?? []) {
    deltaBytes += enc.encode(JSON.stringify(op)).length;   // we send only the op
    doc = applySplice(doc, op);
    fullResendBytes += enc.encode(doc).length;              // naive loop re-sends the whole doc
    hashes.push(sha256(enc.encode(doc)));
  }
  const finalHash = sha256(enc.encode(doc));
  const savedPct = fullResendBytes > 0 ? Math.max(0, 1 - deltaBytes / fullResendBytes) : 0;
  return { finalDoc: doc, finalHash, steps: (ops ?? []).length, deltaBytes, fullResendBytes, savedPct, hashes };
}

/** A stateful server-side channel: holds the doc, applies ops, returns compact acks. */
export interface DeltaAck { ok: boolean; docHash: string; docLen: number; deltaBytes: number; error?: string }
export class ContextChannel {
  private doc = "";
  private sent = 0;
  constructor(base = "") { this.doc = typeof base === "string" ? base : ""; this.sent = enc.encode(JSON.stringify({ snapshot: this.doc })).length; }
  /** Apply one op; return a COMPACT ack (hash + sizes) — never the whole doc. */
  apply(op: SpliceOp): DeltaAck {
    try {
      const opBytes = enc.encode(JSON.stringify(op)).length;
      this.sent += opBytes;
      this.doc = applySplice(this.doc, op);
      return { ok: true, docHash: sha256(enc.encode(this.doc)), docLen: this.doc.length, deltaBytes: opBytes };
    } catch (e) { return { ok: false, docHash: "", docLen: this.doc.length, deltaBytes: 0, error: (e as Error).message }; }
  }
  snapshot(): string { return this.doc; }
  bytesSent(): number { return this.sent; }
}

export interface DeltaGauntlet { score: number; savedPct: number; byteExact: boolean; checks: Array<{ name: string; pass: boolean; detail: string }> }

/** Prove the delta channel: byte-exact reconstruction + a real, measured saving on
 *  a realistic loop (many small edits on a large doc). Pure + deterministic. */
export function deltaGauntlet(): DeltaGauntlet {
  const checks: Array<{ name: string; pass: boolean; detail: string }> = [];
  // a 40KB doc, then 60 small edits (a realistic debug/edit loop)
  const base = "function x(){\n" + "  const a = 1;\n".repeat(3000) + "}\n";
  const ops: SpliceOp[] = [];
  for (let i = 0; i < 60; i++) ops.push({ at: (i * 53) % base.length, del: i % 3, ins: `/*e${i}*/` });
  const r = deltaStream(base, ops);

  // 1) byte-exact reconstruction via the stateful channel (server's view) == replay
  const ch = new ContextChannel(base);
  let lastAck = "";
  for (const op of ops) lastAck = ch.apply(op).docHash;
  const byteExact = ch.snapshot() === r.finalDoc && lastAck === r.finalHash;
  checks.push({ name: "BYTE-EXACT", pass: byteExact, detail: "stateful channel reconstructs the same doc + final hash as the pure replay" });

  // 2) a real, measured saving (delta stream << re-sending the full doc each turn)
  checks.push({ name: "MEASURED-SAVING", pass: r.savedPct > 0.9, detail: `delta ${r.deltaBytes}B vs full-resend ${r.fullResendBytes}B → saved ${(r.savedPct * 100).toFixed(1)}%` });

  // 3) compact acks — each ack is tiny (a hash + 2 ints), never the whole doc
  const ackBytes = enc.encode(JSON.stringify({ ok: true, docHash: r.finalHash, docLen: r.finalDoc.length, deltaBytes: 7 })).length;
  checks.push({ name: "COMPACT-ACK", pass: ackBytes < r.finalDoc.length, detail: `ack ${ackBytes}B ≪ doc ${r.finalDoc.length}B` });

  // 4) total — out-of-range / garbage ops never throw
  let total = true;
  try { applySplice("", { at: 999, del: 999, ins: "x" }); applySplice("abc", { at: -5, del: -2, ins: "" } as SpliceOp); deltaStream("", []); } catch { total = false; }
  checks.push({ name: "TOTAL", pass: total, detail: "out-of-range / empty ops are clamped, never throw" });

  const passed = checks.filter((c) => c.pass).length;
  return { score: Math.round((passed / checks.length) * 100), savedPct: r.savedPct, byteExact, checks };
}

// ─────────────────────────── falsifiable proof ───────────────────────────

export interface MatrixGauntlet {
  score: number;
  pipe: { cases: number; passed: number };
  corruption: { cases: number; caught: number };
  ab: WireSize;
  checks: Array<{ name: string; pass: boolean; detail: string }>;
}

function randomBytes(n: number, seed: number): Uint8Array {
  // deterministic but HIGH-ENTROPY (incompressible) — a sha256 keystream, so large
  // payloads genuinely span many frames (an LCG's low byte is periodic and gzip
  // would crush it to one frame, making multi-chunk corruption tests degenerate).
  const out = new Uint8Array(n);
  let off = 0, ctr = 0;
  while (off < n) {
    const block = createHash("sha256").update(`${seed}:${ctr++}`).digest();
    const take = Math.min(block.length, n - off);
    out.set(block.subarray(0, take), off);
    off += take;
  }
  return out;
}

/** Prove the pipe never breaks for ANY payload + catches every corruption + the
 *  size win is real. Pure + deterministic. */
export function matrixGauntlet(): MatrixGauntlet {
  const checks: Array<{ name: string; pass: boolean; detail: string }> = [];

  // 1) PIPE INTEGRITY — pathological payloads must round-trip BYTE-IDENTICAL.
  const pathological: Array<{ name: string; bytes: Uint8Array }> = [
    { name: "empty (0 B)", bytes: new Uint8Array(0) },
    { name: "1 byte", bytes: new Uint8Array([0x42]) },
    { name: "all-NUL 1KB", bytes: new Uint8Array(1024) },
    { name: "binary 50KB", bytes: randomBytes(50_000, 7) },
    { name: "large 5MB (multi-chunk)", bytes: randomBytes(5_000_000, 13) },
    { name: "unicode/emoji", bytes: enc.encode("héllo 世界 🌍🔥   mixed 😀".repeat(500)) },
    { name: "deeply-nested JSON", bytes: enc.encode(JSON.stringify({ a: Array.from({ length: 2000 }, (_, i) => ({ i, v: "x".repeat(20) })) })) },
  ];
  let passed = 0;
  for (const p of pathological) {
    const r = pipeRoundTrip(p.bytes, 64 * 1024); // small chunk to force multi-frame
    const identical = r.ok && r.payload.length === p.bytes.length && Buffer.from(r.payload).equals(Buffer.from(p.bytes));
    if (identical) passed++;
  }
  checks.push({ name: "any payload round-trips byte-identical", pass: passed === pathological.length, detail: `${passed}/${pathological.length}` });

  // 2) CORRUPTION — every tamper class must be CAUGHT (never silently passed).
  const base = chunkFrame(randomBytes(300_000, 21), 64 * 1024); // ~5 frames
  const corruptions: Array<{ name: string; frames: Frame[] }> = [
    { name: "dropped chunk", frames: base.slice(0, base.length - 1) },
    { name: "reordered+truncated", frames: [base[2]!, base[0]!] },
    { name: "duplicate chunk", frames: [...base, base[0]!] },
    { name: "flipped byte", frames: base.map((f, i) => (i === 1 ? { ...f, data: (() => { const d = Uint8Array.from(f.data); if (d.length) d[0] = d[0]! ^ 0xff; return d; })() } : f)) },
    { name: "manifest tamper (origBytes)", frames: base.map((f) => ({ ...f, origBytes: f.origBytes + 1 })) },
  ];
  let caught = 0;
  for (const c of corruptions) { if (!reassemble(c.frames).ok) caught++; }
  checks.push({ name: "every corruption caught (no silent pass)", pass: caught === corruptions.length, detail: `${caught}/${corruptions.length}` });

  // 3) SIZE A/B — a representative context packet is smaller on the wire.
  const ctx = { history: Array.from({ length: 200 }, (_, i) => ({ role: i % 2 ? "user" : "assistant", text: `turn ${i}: ` + "lorem ipsum dolor sit amet ".repeat(8) })) };
  const ab = wireSize(ctx);
  checks.push({ name: "wire smaller than raw JSON (measured)", pass: ab.savedPct > 0 && ab.wireBytes < ab.rawBytes, detail: `${ab.rawBytes}→${ab.wireBytes} B (−${ab.savedPct}%)` });

  // 4) 0-byte still produces a flowable frame (the off-by-one trap)
  checks.push({ name: "0-byte payload still flows", pass: chunkFrame("").length === 1 && pipeRoundTrip("").ok, detail: "one empty frame" });

  // 5) deterministic
  checks.push({ name: "deterministic", pass: JSON.stringify(wireSize(ctx)) === JSON.stringify(wireSize(ctx)), detail: "same input → same frames/size" });

  // 6) total — garbage never throws
  let total = true;
  try { chunkFrame(null as unknown as string); reassemble(null as unknown as Frame[]); decodeRequest(new Uint8Array([0xff, 0xfe])); } catch { total = false; }
  checks.push({ name: "total (never throws)", pass: total, detail: "garbage degraded" });

  const pass = checks.every((c) => c.pass);
  return {
    score: pass ? 100 : 0,
    pipe: { cases: pathological.length, passed },
    corruption: { cases: corruptions.length, caught },
    ab,
    checks,
  };
}
