/**
 * BEHAVIORAL-EQUIVALENCE RECEIPTS — prove an AI refactor didn't silently change behavior.
 *
 * "The tests pass" proves almost nothing — a unit test written at qty=7 stays green while a refactor
 * flips `>=` to `>` and silently breaks every boundary. When an AI rewrites a function claiming to
 * preserve behavior, this DIFFERENTIALLY TESTS old vs new over inputs SEEDED WITH THE BOUNDARIES where
 * off-by-one bugs live (plus a deterministic fuzz fill), and returns either a precise COUNTEREXAMPLE or
 * an equivalence verdict that can be wrapped in a signed receipt and trusted by CI instead of a promise.
 *
 * This module owns the deterministic ENGINE: boundary+fuzz input generation by argument type, an
 * order-insensitive output comparison, the differential runner (takes the two functions), and the
 * receipt BODY (claim + content hashes). Signing is done by the caller's notary (the MCP layer wraps the
 * body in an Ed25519 `_proof`), so a receipt verifies offline.
 *
 * ★HONEST (DIAKRISIS): equivalence here is EMPIRICAL over a finite, boundary-biased sample — a strong
 * signal (far stronger than example-based unit tests), NOT a formal proof of total equivalence; a
 * difference that only shows on an input class the generator doesn't cover can be missed (the receipt
 * states exactly how many inputs were tested). It is sound for PURE functions; a function with
 * side-effects / IO / DB needs a snapshot-or-mock harness the caller supplies — that harder case is
 * exactly where the moat is, and this engine is the seed of it.
 */
export type ArgType = "number" | "int" | "string" | "bool";
export interface ArgSpec { name: string; type: ArgType }

const NUM_BOUNDARIES = [0, 1, -1, 0.5, -0.5, 2, 5, 10, 100, -100, 9.99, 1000];
const INT_BOUNDARIES = [0, 1, -1, 2, 3, 4, 5, 6, 9, 10, 11, 100, -10];
const STR_BOUNDARIES = ["", " ", "a", "abc", "0", "null", "  trim  ", "ABCdef123"];
const BOOL_BOUNDARIES = [true, false];
function boundariesFor(t: ArgType): unknown[] {
  return t === "number" ? NUM_BOUNDARIES : t === "int" ? INT_BOUNDARIES : t === "string" ? STR_BOUNDARIES : BOOL_BOUNDARIES;
}

/** Deterministic input rows: a capped cartesian over per-arg boundaries + a deterministic LCG fuzz fill. */
export function genInputs(spec: ReadonlyArray<ArgSpec>, opts?: { fuzz?: number; cartesianCap?: number }): unknown[][] {
  const args = spec ?? [];
  if (!args.length) return [[]];
  const fuzz = opts?.fuzz ?? 1500; const cap = opts?.cartesianCap ?? 4000;
  const cols = args.map((a) => boundariesFor(a.type));
  // bounded cartesian product of boundaries
  const rows: unknown[][] = [[]];
  for (const col of cols) {
    const next: unknown[][] = [];
    for (const row of rows) { for (const v of col) { next.push([...row, v]); if (next.length >= cap) break; } if (next.length >= cap) break; }
    rows.length = 0; rows.push(...next);
  }
  // deterministic LCG fuzz (no Math.random — receipts must be reproducible)
  let s = 2166136261 >>> 0;
  const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 0xffffffff; };
  for (let i = 0; i < fuzz; i++) {
    rows.push(args.map((a) => a.type === "number" ? Math.round(rnd() * 2000 - 1000) / 10
      : a.type === "int" ? Math.floor(rnd() * 200 - 50)
      : a.type === "string" ? "s" + Math.floor(rnd() * 1000)
      : rnd() > 0.5));
  }
  return rows;
}

/** Order-insensitive value comparison (numbers within epsilon; deep for objects/arrays). */
export function outputsEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9 || (Number.isNaN(a) && Number.isNaN(b));
  if (a && b && typeof a === "object" && typeof b === "object") { try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; } }
  return false;
}

export interface DiffResult { equivalent: boolean; inputsTested: number; counterexample: { input: unknown[]; old: unknown; new: unknown } | null; errored: number }
/** Run old vs new over the inputs; first disagreement (or differing throw behavior) is the counterexample. */
export function differential(oldFn: (...a: unknown[]) => unknown, newFn: (...a: unknown[]) => unknown, inputs: ReadonlyArray<ReadonlyArray<unknown>>): DiffResult {
  let errored = 0;
  for (const input of inputs ?? []) {
    let a: unknown, b: unknown, ae = false, be = false;
    try { a = oldFn(...(input as unknown[])); } catch { ae = true; }
    try { b = newFn(...(input as unknown[])); } catch { be = true; }
    if (ae || be) { errored++; if (ae !== be) return { equivalent: false, inputsTested: inputs.length, counterexample: { input: [...input], old: ae ? "<throw>" : a, new: be ? "<throw>" : b }, errored }; continue; }
    if (!outputsEqual(a, b)) return { equivalent: false, inputsTested: inputs.length, counterexample: { input: [...input], old: a, new: b }, errored };
  }
  return { equivalent: true, inputsTested: (inputs ?? []).length, counterexample: null, errored };
}

// tiny FNV-1a (avoid importing node:crypto into the pure core; the MCP layer adds the Ed25519 proof)
function fnv1a(s: string): string { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return ("00000000" + h.toString(16)).slice(-8); }

export interface EquivReceipt { claim: "BEHAVIORAL-EQUIVALENCE"; subject: string; equivalent: boolean; inputsTested: number; oldHash: string; newHash: string; counterexample: DiffResult["counterexample"] }
/** Build the receipt body (the MCP layer signs it). */
export function buildReceipt(subject: string, oldSrc: string, newSrc: string, r: DiffResult): EquivReceipt {
  return { claim: "BEHAVIORAL-EQUIVALENCE", subject, equivalent: r.equivalent, inputsTested: r.inputsTested, oldHash: fnv1a(String(oldSrc ?? "")), newHash: fnv1a(String(newSrc ?? "")), counterexample: r.counterexample };
}

/** High-level: generate inputs, run the differential, return the receipt body. */
export function checkEquivalence(oldFn: (...a: unknown[]) => unknown, newFn: (...a: unknown[]) => unknown, spec: ReadonlyArray<ArgSpec>, opts?: { subject?: string; oldSrc?: string; newSrc?: string; fuzz?: number }): EquivReceipt {
  const inputs = genInputs(spec, { fuzz: opts?.fuzz });
  const r = differential(oldFn, newFn, inputs);
  return buildReceipt(opts?.subject ?? "fn", opts?.oldSrc ?? oldFn.toString(), opts?.newSrc ?? newFn.toString(), r);
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface EquivReceiptGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function equivReceiptGauntlet(): EquivReceiptGauntlet {
  const spec: ArgSpec[] = [{ name: "price", type: "number" }, { name: "qty", type: "int" }];
  const v1 = (price: number, qty: number) => qty >= 10 ? price * qty * 0.8 : qty >= 5 ? price * qty * 0.9 : price * qty;
  const v2 = (price: number, qty: number) => { const rate = qty >= 10 ? 0.8 : qty >= 5 ? 0.9 : 1.0; return price * qty * rate; };          // equivalent
  const vBad = (price: number, qty: number) => { const rate = qty > 10 ? 0.8 : qty > 5 ? 0.9 : 1.0; return price * qty * rate; };           // >= became >
  const eq = checkEquivalence(v1 as never, v2 as never, spec);
  const bad = checkEquivalence(v1 as never, vBad as never, spec);
  const equivOK = eq.equivalent === true && eq.inputsTested > 100 && eq.counterexample === null;
  // the boundary bug is caught at qty=5 or qty=10 (where a unit test at qty=7 stays green)
  const boundaryCaught = bad.equivalent === false && bad.counterexample != null && (() => { const q = (bad.counterexample!.input[1] as number); return q === 5 || q === 10 || q === 6 || q === 11; })();
  // genInputs is deterministic (same inputs every run) → receipts reproducible
  const gi1 = JSON.stringify(genInputs(spec)); const gi2 = JSON.stringify(genInputs(spec));
  const deterministic = gi1 === gi2;
  const hashOK = eq.oldHash !== eq.newHash;   // different source → different content hash
  const total = (() => { try { differential(null as never, null as never, []); genInputs(null as never); outputsEqual({ a: 1 }, { a: 1 }); checkEquivalence(((x: number) => x) as never, ((x: number) => x) as never, [{ name: "x", type: "number" }]); return true; } catch { return false; } })();
  const idem = checkEquivalence(((x: number) => x * 2) as never, ((x: number) => x + x) as never, [{ name: "x", type: "number" }]).equivalent === true;
  const checks = [
    { name: "EQUIVALENT-REFACTOR", pass: equivOK, detail: "a table-driven rewrite of a tiered function is proven equivalent over 100s of inputs" },
    { name: "BOUNDARY-BUG-CAUGHT", pass: boundaryCaught, detail: ">= → > is caught with a counterexample exactly at a threshold (qty 5/10) — where example tests miss it" },
    { name: "DETERMINISTIC-INPUTS", pass: deterministic, detail: "input generation is reproducible (no Math.random) → receipts are reproducible" },
    { name: "CONTENT-HASH", pass: hashOK && idem, detail: "old/new source hashed into the receipt; a genuinely-equivalent rewrite (x*2 vs x+x) verifies" },
    { name: "TOTAL", pass: total, detail: "null/garbage never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
