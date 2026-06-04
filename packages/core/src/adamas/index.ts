/**
 * ADAMAS (ἀδάμας, "unbreakable / diamond") — QEC-INSPIRED SELF-HEALING MEMORY.
 *
 * Quantum error correction protects ONE logical qubit by spreading it
 * redundantly across MANY physical qubits and measuring a *syndrome* that
 * locates + corrects corruption. ADAMAS steals the ALGORITHM, not the hardware:
 * a fact is encoded with a real MDS erasure code (a Cauchy matrix over GF(256),
 * the Reed-Solomon family) into K data + M parity shards; a per-shard SHA-256
 * syndrome locates any corrupted / tampered / missing shard; the code recovers
 * the original BYTE-IDENTICAL as long as >= K of the K+M shards survive (it
 * tolerates up to M bad shards). Beyond M it returns UNRECOVERABLE — it NEVER
 * guesses a value it cannot prove (prove-or-unknown).
 *
 * A block-level `root` (hash over the ordered shard hashes) makes coordinated
 * tamper (rewrite a shard AND its stored hash) detectable; the CLI/MCP layer
 * signs the block with NOTARY (Ed25519) so the whole thing verifies offline.
 *
 * HONEST (DIAKRISIS): this is a classical, deterministic, textbook MDS code —
 * NOT a qubit and NOT "quantum hardware". The substance is provable
 * self-healing memory + tamper-evidence (measured: recovers <=M corruptions
 * byte-identical, refuses >M). The genuine future-proofing is that QEC is the
 * real classical->quantum bridge concept (stabilizer codes), so a memory layer
 * that already thinks in logical-vs-physical + syndromes is honestly better
 * positioned — with zero vaporware.
 *
 * Pure + total: no Date, no randomness, no I/O. Signing/timestamps live at the
 * CLI/MCP edge, exactly like every other Mneme core module.
 */
import { createHash } from "node:crypto";

// ─── GF(256) arithmetic (primitive polynomial 0x11d, generator 2) ──────────
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

const gfMul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]);
const gfInv = (a: number): number => GF_EXP[(255 - GF_LOG[a]) % 255]; // a != 0
const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

/** Invert a K×K matrix over GF(256) via Gauss-Jordan. Returns null if singular. */
function gfMatInvert(m: number[][]): number[][] | null {
  const n = m.length;
  // augment [m | I]
  const a = m.map((row, i) => [...row, ...row.map((_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    // find pivot
    let piv = -1;
    for (let r = col; r < n; r++) if (a[r][col] !== 0) { piv = r; break; }
    if (piv === -1) return null; // singular
    if (piv !== col) { const t = a[piv]; a[piv] = a[col]; a[col] = t; }
    const inv = gfInv(a[col][col]);
    for (let j = 0; j < 2 * n; j++) a[col][j] = gfMul(a[col][j], inv);
    for (let r = 0; r < n; r++) {
      if (r === col || a[r][col] === 0) continue;
      const f = a[r][col];
      for (let j = 0; j < 2 * n; j++) a[r][j] ^= gfMul(f, a[col][j]);
    }
  }
  return a.map((row) => row.slice(n));
}

/** M×K Cauchy matrix: A[i][j] = 1/(x_i ⊕ y_j), x_i=i, y_j=M+j (disjoint → MDS). */
function cauchy(m: number, k: number): number[][] {
  const A: number[][] = [];
  for (let i = 0; i < m; i++) {
    const row: number[] = [];
    for (let j = 0; j < k; j++) row.push(gfInv(i ^ (m + j)));
    A.push(row);
  }
  return A;
}

// ─── types ─────────────────────────────────────────────────────────────────
export interface AdamasShard { idx: number; role: "data" | "parity"; b64: string; hash: string }
export interface AdamasBlock {
  v: 1;
  k: number;          // data shards
  m: number;          // parity shards (tolerates up to m bad shards)
  origLen: number;    // original byte length (for unpad)
  shardLen: number;   // bytes per shard
  shards: AdamasShard[];
  root: string;       // sha256 over ordered shard hashes — block-level tamper seal
}
export interface AdamasSyndrome { healthy: boolean; badShards: number[]; recoverable: boolean; k: number; m: number; rootOk: boolean }
export interface AdamasDecode { ok: boolean; value?: string; corrected: number[]; recovered: boolean; reason?: string }

const b64 = (u: Uint8Array): string => Buffer.from(u).toString("base64");
const unb64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "base64"));
const rootOf = (shards: AdamasShard[]): string => sha(Buffer.from(shards.map((s) => s.hash).join("|")));

/** Encode a fact into K data + M parity shards (systematic MDS code). */
export function encodeFact(value: string, opts: { k?: number; m?: number } = {}): AdamasBlock {
  const k = Math.max(1, Math.min(64, Math.floor(opts.k ?? 6)));
  const m = Math.max(1, Math.min(64, Math.floor(opts.m ?? 3)));
  if (k + m > 256) throw new Error("adamas: k+m must be <= 256");
  const bytes = new Uint8Array(Buffer.from(value, "utf8"));
  const origLen = bytes.length;
  const shardLen = Math.max(1, Math.ceil(origLen / k));
  // pad to k*shardLen
  const padded = new Uint8Array(k * shardLen);
  padded.set(bytes);
  // systematic data shards
  const data: Uint8Array[] = [];
  for (let j = 0; j < k; j++) data.push(padded.subarray(j * shardLen, (j + 1) * shardLen));
  // parity shards via Cauchy matrix
  const A = cauchy(m, k);
  const parity: Uint8Array[] = [];
  for (let i = 0; i < m; i++) {
    const p = new Uint8Array(shardLen);
    for (let col = 0; col < shardLen; col++) {
      let acc = 0;
      for (let j = 0; j < k; j++) acc ^= gfMul(A[i][j], data[j][col]);
      p[col] = acc;
    }
    parity.push(p);
  }
  const shards: AdamasShard[] = [];
  for (let j = 0; j < k; j++) shards.push({ idx: j, role: "data", b64: b64(data[j]), hash: sha(data[j]) });
  for (let i = 0; i < m; i++) shards.push({ idx: k + i, role: "parity", b64: b64(parity[i]), hash: sha(parity[i]) });
  return { v: 1, k, m, origLen, shardLen, shards, root: rootOf(shards) };
}

/** Measure the syndrome: which shards are corrupt (bytes≠storedHash) or missing. */
export function checkSyndrome(block: AdamasBlock): AdamasSyndrome {
  const { k, m } = block;
  const n = k + m;
  const bad: number[] = [];
  const present = new Set<number>();
  for (const s of block.shards) {
    present.add(s.idx);
    let ok = false;
    try { ok = sha(unb64(s.b64)) === s.hash; } catch { ok = false; }
    if (!ok) bad.push(s.idx);
  }
  for (let i = 0; i < n; i++) if (!present.has(i) && !bad.includes(i)) bad.push(i); // missing = bad
  bad.sort((a, b) => a - b);
  const rootOk = rootOf([...block.shards].sort((a, b) => a.idx - b.idx)) === block.root;
  const surviving = n - bad.length;
  return { healthy: bad.length === 0 && rootOk, badShards: bad, recoverable: surviving >= k, k, m, rootOk };
}

/** Decode + auto-heal. Byte-identical recovery if <=M shards bad; else UNRECOVERABLE. */
export function decodeFact(block: AdamasBlock): AdamasDecode {
  const syn = checkSyndrome(block);
  const { k, m, shardLen, origLen } = block;
  const badSet = new Set(syn.badShards);
  if (!syn.recoverable) {
    return { ok: false, corrected: [], recovered: false, reason: `UNRECOVERABLE: ${syn.badShards.length} bad shards > M=${m}` };
  }
  // gather good shards by idx
  const byIdx = new Map<number, AdamasShard>();
  for (const s of block.shards) if (!badSet.has(s.idx)) byIdx.set(s.idx, s);
  const A = cauchy(m, k);
  const coeffRow = (idx: number): number[] => {
    if (idx < k) { const r = new Array(k).fill(0); r[idx] = 1; return r; } // data row = unit vector
    return A[idx - k].slice(); // parity row
  };

  let dataShards: Uint8Array[];
  if (syn.healthy) {
    dataShards = [];
    for (let j = 0; j < k; j++) dataShards.push(unb64(byIdx.get(j)!.b64));
  } else {
    // pick first K surviving shards → build K×K matrix → invert → recover all data
    const chosen: number[] = [];
    for (let i = 0; i < k + m && chosen.length < k; i++) if (byIdx.has(i)) chosen.push(i);
    const R = chosen.map((idx) => coeffRow(idx));
    const Rinv = gfMatInvert(R);
    if (!Rinv) return { ok: false, corrected: [], recovered: false, reason: "UNRECOVERABLE: surviving shards not independent" };
    const chosenBytes = chosen.map((idx) => unb64(byIdx.get(idx)!.b64));
    dataShards = [];
    for (let j = 0; j < k; j++) dataShards.push(new Uint8Array(shardLen));
    for (let col = 0; col < shardLen; col++) {
      for (let j = 0; j < k; j++) {
        let acc = 0;
        for (let t = 0; t < k; t++) acc ^= gfMul(Rinv[j][t], chosenBytes[t][col]);
        dataShards[j][col] = acc;
      }
    }
  }
  const full = new Uint8Array(k * shardLen);
  for (let j = 0; j < k; j++) full.set(dataShards[j], j * shardLen);
  const value = Buffer.from(full.subarray(0, origLen)).toString("utf8");
  return { ok: true, value, corrected: syn.badShards, recovered: !syn.healthy };
}

/** Decode then RE-encode → a fresh fully-healthy block (persist this to undo drift). */
export function repair(block: AdamasBlock): { ok: boolean; block?: AdamasBlock; corrected: number[]; reason?: string } {
  const d = decodeFact(block);
  if (!d.ok || d.value === undefined) return { ok: false, corrected: [], reason: d.reason ?? "decode failed" };
  return { ok: true, block: encodeFact(d.value, { k: block.k, m: block.m }), corrected: d.corrected };
}

// ─── gauntlet ────────────────────────────────────────────────────────────────
export interface GauntletCheck { name: string; pass: boolean; detail: string }
export interface GauntletResult { score: number; checks: GauntletCheck[] }

/** Deterministic pseudo-corruption (no Math.random — varies by seed). */
function pick(seed: number, mod: number): number { return Math.abs(((seed * 2654435761) ^ (seed >>> 3)) % mod); }

export function adamasGauntlet(): GauntletResult {
  const checks: GauntletCheck[] = [];
  const facts = ["", "x", "x=42", "เส้นเลือดในร่างกาย ~100,000 km 🩸", "k".repeat(5000), JSON.stringify({ a: 1, b: [1, 2, 3], s: "δ" })];
  const params: Array<[number, number]> = [[4, 2], [6, 3], [3, 1], [8, 4]];

  // 1. healthy round-trip byte-identical
  let rt = true;
  for (const f of facts) for (const [k, m] of params) { const d = decodeFact(encodeFact(f, { k, m })); if (!d.ok || d.value !== f) { rt = false; } }
  checks.push({ name: "ROUND-TRIP", pass: rt, detail: `${facts.length} facts × ${params.length} (k,m) decode byte-identical` });

  // 2. recovers up to M corrupted shards byte-identical
  let healAll = true; let healCount = 0;
  for (const f of facts) for (const [k, m] of params) {
    for (let c = 1; c <= m; c++) {
      const blk = encodeFact(f, { k, m });
      const idxs = new Set<number>();
      for (let s = 0; idxs.size < c; s++) idxs.add(pick(s + f.length + k * 7 + c, k + m));
      for (const i of idxs) { const sh = blk.shards.find((x) => x.idx === i)!; const bytes = unb64(sh.b64); bytes[0] ^= 0xff; sh.b64 = b64(bytes); } // corrupt bytes, leave stale hash → syndrome catches
      const d = decodeFact(blk);
      if (!d.ok || d.value !== f || d.corrected.length !== c) healAll = false; else healCount++;
    }
  }
  checks.push({ name: "SELF-HEAL ≤M", pass: healAll, detail: `${healCount} cases recovered byte-identical (1..M corrupted shards)` });

  // 3. > M corruptions → UNRECOVERABLE, NEVER a wrong value (prove-or-unknown)
  let refuses = true; let neverWrong = true;
  for (const f of facts.filter((x) => x.length > 0)) for (const [k, m] of params) {
    const blk = encodeFact(f, { k, m });
    const idxs = new Set<number>();
    for (let s = 0; idxs.size < m + 1; s++) idxs.add(pick(s * 3 + f.length + k, k + m));
    for (const i of idxs) { const sh = blk.shards.find((x) => x.idx === i)!; const bytes = unb64(sh.b64); for (let z = 0; z < bytes.length; z++) bytes[z] ^= 0xa5; sh.b64 = b64(bytes); }
    const d = decodeFact(blk);
    if (d.ok) refuses = false;               // must refuse beyond M
    if (d.ok && d.value !== f) neverWrong = false; // and must NEVER emit a wrong value
  }
  checks.push({ name: "REFUSE >M", pass: refuses, detail: "beyond M bad shards → UNRECOVERABLE (never guesses)" });
  checks.push({ name: "NEVER-WRONG", pass: neverWrong, detail: "no wrong value ever emitted past tolerance (prove-or-unknown)" });

  // 4. erasure (missing shard) recovers — distinct from byte-corruption
  let erasureOk = true;
  for (const [k, m] of params) {
    const blk = encodeFact("erasure-test δ", { k, m });
    blk.shards = blk.shards.filter((s) => s.idx !== 0 && s.idx !== k); // drop a data + a parity shard
    const d = decodeFact(blk);
    if (m >= 2 && (!d.ok || d.value !== "erasure-test δ")) erasureOk = false;
  }
  checks.push({ name: "ERASURE", pass: erasureOk, detail: "missing shards (not just flipped bytes) recover when survivors ≥ K" });

  // 5. block-root catches coordinated tamper (rewrite shard bytes AND its hash)
  const tampered = encodeFact("authoritative-fact", { k: 4, m: 2 });
  const ts = tampered.shards[1]; const tb = unb64(ts.b64); tb[0] ^= 0x11; ts.b64 = b64(tb); ts.hash = sha(tb); // fix per-shard hash too
  const syn = checkSyndrome(tampered);
  checks.push({ name: "ROOT-SEAL", pass: !syn.rootOk && !syn.healthy, detail: "coordinated tamper (bytes+hash) caught by block root" });

  // 6. repair → fresh fully-healthy block
  const blk6 = encodeFact("repair me", { k: 5, m: 3 });
  const c6 = unb64(blk6.shards[2].b64); c6[0] ^= 0x7e; blk6.shards[2].b64 = b64(c6);
  const r6 = repair(blk6);
  const repaired = r6.ok && !!r6.block && checkSyndrome(r6.block).healthy && decodeFact(r6.block).value === "repair me";
  checks.push({ name: "REPAIR", pass: repaired, detail: "repair() returns a fresh, fully-healthy, byte-identical block" });

  // 7. GF(256) sanity — field invertibility (the engine's bedrock)
  let gfOk = true;
  for (let a = 1; a < 256; a++) if (gfMul(a, gfInv(a)) !== 1) gfOk = false;
  checks.push({ name: "GF(256)", pass: gfOk, detail: "every nonzero element has a multiplicative inverse" });

  const passed = checks.filter((c) => c.pass).length;
  return { score: Math.round((passed / checks.length) * 100), checks };
}
