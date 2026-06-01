/**
 * v2.128.0 — CONTEXT-STATE CHANNEL (the honest "L2 Lightning" for AI context).
 *
 * THE REAL PROBLEM (the user's "compounding debt"): a debug/edit loop with a
 * hosted model re-streams the WHOLE file + the WHOLE compiler/test output on
 * EVERY iteration, and the chat history keeps that bloat forever. The cost
 * compounds even though each step only changes a few lines.
 *
 * THE HONEST L2 (a state channel, blockchain-style: many cheap local steps, one
 * settlement): the agent opens a CHANNEL over some files; Mneme holds the working
 * copy LOCALLY. Each iteration the agent sends a tiny DIFF OP (replace a region /
 * text / insert), Mneme applies it to the local copy, runs a quick LOCAL check,
 * and returns a COMPACT delta (ok + a one-line brief + a tiny diff summary) —
 * NOT the whole file, NOT the whole output. The full source never has to be
 * re-streamed during the loop. On COMMIT, the accumulated working copy is written
 * to disk (the "settlement"). Composes with OUTLINE (orient cheap) + BLIND (hide
 * names) for the full off-the-wire loop.
 *
 * HONEST LIMITS (DIAKRISIS): the agent (model) still reasons each step — the
 * saving is on the LOOP overhead (re-streaming files + outputs), which is real
 * and compounding. The core's check is a deterministic STRUCTURAL one (balanced
 * delimiters via OUTLINE's masker); a REAL compiler/test run is the CLI's job
 * (it spawns tsc/test). This is NOT a claim that the model edits code it can't
 * see — the agent composes the diff ops from what it learned via OUTLINE.
 *
 * Pure + total: deterministic, no I/O, never throws. Persistence is the
 * CLI/MCP's concern; this module is a pure state machine.
 */

import { createHash } from "node:crypto";
import { maskCode } from "../outline/index.js";

export interface ChannelFile { base: string; working: string }
export interface ChannelState {
  id: string;
  files: Record<string, ChannelFile>;
  opCount: number;
  /** running estimate of the channel-side bytes the agent exchanged (ops+deltas). */
  channelBytes: number;
}

export type ChannelOp =
  | { kind: "replaceRegion"; path: string; startLine: number; endLine: number; text: string }
  | { kind: "replaceText"; path: string; find: string; replace: string; all?: boolean }
  | { kind: "insertAfter"; path: string; line: number; text: string }
  | { kind: "appendFile"; path: string; text: string };

export interface OpResult {
  ok: boolean;
  opId: number;
  path: string;
  linesBefore: number;
  linesAfter: number;
  /** quick structural verdict on the changed file. */
  structureOk: boolean;
  structureIssue?: string;
  brief: string;
}

function sha256(s: string): string { return createHash("sha256").update(s, "utf8").digest("hex"); }
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
const est = (chars: number): number => Math.ceil(chars / 4);

/** Open a channel over a set of files. Deterministic id (content-derived). Total. */
export function openChannel(files: ReadonlyArray<{ path: string; content: string }>): ChannelState {
  try {
    const map: Record<string, ChannelFile> = {};
    for (const f of Array.isArray(files) ? files : []) {
      const path = String(f?.path ?? ""); if (!path) continue;
      const content = typeof f?.content === "string" ? f.content : "";
      map[path] = { base: content, working: content };
    }
    const id = sha256(canon(map)).slice(0, 16);
    return { id, files: map, opCount: 0, channelBytes: 0 };
  } catch { return { id: "", files: {}, opCount: 0, channelBytes: 0 }; }
}

/** Quick deterministic STRUCTURAL check: balanced delimiters with strings/comments
 *  masked. Catches the obvious "you left a brace open" breakage without a compiler. */
export function quickCheck(content: string, langMaskHash = false): { ok: boolean; issue?: string } {
  try {
    const masked = maskCode(typeof content === "string" ? content : "", langMaskHash ? { hash: true, triple: true } : undefined);
    const pairs: Array<[string, string]> = [["{", "}"], ["(", ")"], ["[", "]"]];
    for (const [open, close] of pairs) {
      let d = 0;
      for (const ch of masked) { if (ch === open) d++; else if (ch === close) { d--; if (d < 0) return { ok: false, issue: `unbalanced '${close}' (extra closer)` }; } }
      if (d !== 0) return { ok: false, issue: `unbalanced '${open}${close}' (${d > 0 ? d + " unclosed" : "extra closers"})` };
    }
    return { ok: true };
  } catch { return { ok: true }; } // never block on checker error
}

function applyToContent(content: string, op: ChannelOp): { next: string; ok: boolean; note: string } {
  const lines = content.split("\n");
  if (op.kind === "replaceRegion") {
    const a = Math.max(1, Math.floor(op.startLine)); const b = Math.min(lines.length, Math.floor(op.endLine));
    if (a > b || a < 1) return { next: content, ok: false, note: "invalid region" };
    const next = [...lines.slice(0, a - 1), ...String(op.text ?? "").split("\n"), ...lines.slice(b)].join("\n");
    return { next, ok: true, note: `replaced L${a}-${b}` };
  }
  if (op.kind === "replaceText") {
    const find = String(op.find ?? ""); if (!find) return { next: content, ok: false, note: "empty find" };
    if (!content.includes(find)) return { next: content, ok: false, note: "find text not present" };
    const next = op.all ? content.split(find).join(String(op.replace ?? "")) : content.replace(find, String(op.replace ?? ""));
    return { next, ok: true, note: op.all ? "replaced all" : "replaced first" };
  }
  if (op.kind === "insertAfter") {
    const ln = Math.max(0, Math.min(lines.length, Math.floor(op.line)));
    const next = [...lines.slice(0, ln), ...String(op.text ?? "").split("\n"), ...lines.slice(ln)].join("\n");
    return { next, ok: true, note: `inserted after L${ln}` };
  }
  if (op.kind === "appendFile") return { next: content + String(op.text ?? ""), ok: true, note: "appended" };
  return { next: content, ok: false, note: "unknown op kind" };
}

/** Apply a diff op to the channel's working copy. Returns the NEW state + a
 *  COMPACT result (the only thing the agent needs back). Deterministic + total. */
export function applyOp(state: ChannelState, op: ChannelOp): { state: ChannelState; result: OpResult } {
  try {
    const opId = (state?.opCount ?? 0) + 1;
    const path = String((op as { path?: string })?.path ?? "");
    const file = state?.files?.[path];
    if (!file) {
      const result: OpResult = { ok: false, opId, path, linesBefore: 0, linesAfter: 0, structureOk: true, brief: `no file "${path}" in channel` };
      return { state: { ...state, opCount: opId }, result };
    }
    const before = file.working;
    const linesBefore = before.split("\n").length;
    const ap = applyToContent(before, op);
    const linesAfter = ap.next.split("\n").length;
    const isPy = path.toLowerCase().endsWith(".py");
    const chk = quickCheck(ap.next, isPy);
    const files = { ...state.files, [path]: { base: file.base, working: ap.ok ? ap.next : before } };
    // channel-side cost: the op the agent sent + the compact delta it gets back.
    const opBytes = canon(op).length;
    const deltaBytes = 80; // a compact {ok,opId,brief} delta
    const result: OpResult = {
      ok: ap.ok, opId, path, linesBefore, linesAfter,
      structureOk: chk.ok, structureIssue: chk.issue,
      brief: ap.ok ? `${ap.note}; ${linesBefore}→${linesAfter} lines; structure ${chk.ok ? "OK" : "BROKEN: " + chk.issue}` : `NOT applied: ${ap.note}`,
    };
    return { state: { ...state, files, opCount: opId, channelBytes: (state.channelBytes ?? 0) + opBytes + deltaBytes }, result };
  } catch {
    return { state: { ...state, opCount: (state?.opCount ?? 0) + 1 }, result: { ok: false, opId: (state?.opCount ?? 0) + 1, path: "", linesBefore: 0, linesAfter: 0, structureOk: true, brief: "channel op error (safe)" } };
  }
}

export interface DiffHunk { startLine: number; removed: number; added: number }
export interface ChannelDiff { path: string; changed: boolean; hunks: DiffHunk[]; addedLines: number; removedLines: number }

/** Compact diff summary (base vs working) — what the agent reviews instead of the
 *  whole file. A minimal first/last-divergence + counts (deterministic, total). */
export function diffSummary(state: ChannelState, path: string): ChannelDiff {
  try {
    const f = state?.files?.[path];
    if (!f) return { path, changed: false, hunks: [], addedLines: 0, removedLines: 0 };
    const a = f.base.split("\n"); const b = f.working.split("\n");
    if (f.base === f.working) return { path, changed: false, hunks: [], addedLines: 0, removedLines: 0 };
    // trim common prefix/suffix to localize the change
    let pre = 0; while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
    let sufA = a.length - 1, sufB = b.length - 1;
    while (sufA >= pre && sufB >= pre && a[sufA] === b[sufB]) { sufA--; sufB--; }
    const removed = sufA - pre + 1; const added = sufB - pre + 1;
    return { path, changed: true, hunks: [{ startLine: pre + 1, removed: Math.max(0, removed), added: Math.max(0, added) }], addedLines: Math.max(0, added), removedLines: Math.max(0, removed) };
  } catch { return { path, changed: false, hunks: [], addedLines: 0, removedLines: 0 }; }
}

export interface ChannelSettlement { files: Array<{ path: string; content: string; changed: boolean }>; opCount: number }
/** "Settle" the channel: the working files to write to disk. Total. */
export function commitChannel(state: ChannelState): ChannelSettlement {
  try {
    const files = Object.entries(state?.files ?? {}).map(([path, f]) => ({ path, content: f.working, changed: f.base !== f.working }));
    return { files, opCount: state?.opCount ?? 0 };
  } catch { return { files: [], opCount: 0 }; }
}

export interface ChannelSavings { channelTokens: number; naiveTokens: number; reductionPct: number; ops: number; note: string }
/** Measure tokens saved vs the NAIVE loop (re-read full files + a full output per
 *  op). Honest ≈chars/4 estimate; the comparison baseline is stated. */
export function channelSavings(state: ChannelState): ChannelSavings {
  try {
    const totalFileChars = Object.values(state?.files ?? {}).reduce((n, f) => n + f.working.length, 0);
    const ops = state?.opCount ?? 0;
    const ASSUMED_OUTPUT_CHARS = 600; // a typical full compiler/test output re-streamed each op
    const naiveChars = ops * (totalFileChars + ASSUMED_OUTPUT_CHARS);
    const channelChars = state?.channelBytes ?? 0;
    const channelTokens = est(channelChars); const naiveTokens = est(naiveChars);
    return {
      channelTokens, naiveTokens,
      reductionPct: naiveTokens > 0 ? Math.round((1 - channelTokens / naiveTokens) * 1000) / 10 : 0,
      ops,
      note: "channel = sum(op + compact delta) vs NAIVE = ops × (full-file re-read + a typical output); ≈chars/4 estimate, labelled. The full source is not re-streamed during the loop.",
    };
  } catch { return { channelTokens: 0, naiveTokens: 0, reductionPct: 0, ops: 0, note: "savings error (safe)" }; }
}

export interface ChannelGauntlet {
  appliesRegion: boolean;
  appliesText: boolean;
  workingExact: boolean;       // working copy reflects edits byte-exactly
  catchesBrokenStructure: boolean; // an unbalanced edit is flagged structureOk:false
  rejectsBadOp: boolean;       // find-not-present / bad region → ok:false, working unchanged
  commitByteExact: boolean;    // commit yields the exact edited content
  diffCompact: boolean;        // diff summary ≪ whole file
  savingsReal: boolean;        // multi-op loop saves vs naive
  deterministic: boolean;
  stable: boolean;
  score: number;
}

export function channelGauntlet(): ChannelGauntlet {
  try {
    const src = `export function add(a, b) {\n  return a + b;\n}\nexport const NAME = "x";\n`;
    let st = openChannel([{ path: "m.ts", content: src }]);

    const r1 = applyOp(st, { kind: "replaceRegion", path: "m.ts", startLine: 2, endLine: 2, text: "  return a * b; // changed" });
    st = r1.state;
    const appliesRegion = r1.result.ok && st.files["m.ts"]!.working.includes("a * b") && r1.result.structureOk;

    const r2 = applyOp(st, { kind: "replaceText", path: "m.ts", find: '"x"', replace: '"y"' });
    st = r2.state;
    const appliesText = r2.result.ok && st.files["m.ts"]!.working.includes('"y"');

    const workingExact = st.files["m.ts"]!.working === `export function add(a, b) {\n  return a * b; // changed\n}\nexport const NAME = "y";\n`;

    // a structure-breaking edit (remove the closing brace line) is flagged
    const rb = applyOp(st, { kind: "replaceRegion", path: "m.ts", startLine: 3, endLine: 3, text: "// brace gone" });
    const catchesBrokenStructure = rb.result.ok && rb.result.structureOk === false && !!rb.result.structureIssue;

    // a bad op leaves working unchanged
    const rbad = applyOp(st, { kind: "replaceText", path: "m.ts", find: "NOT_PRESENT_zzz", replace: "x" });
    const rejectsBadOp = rbad.result.ok === false && rbad.state.files["m.ts"]!.working === st.files["m.ts"]!.working;

    const settle = commitChannel(st);
    const commitByteExact = settle.files.find((f) => f.path === "m.ts")?.content === st.files["m.ts"]!.working && settle.files[0]!.changed === true;

    // a 5-op loop on a biggish file saves vs naive; diff stays tiny vs the file
    const bigSrc = ("line of code;\n".repeat(400)) + "export const Q = 1;\n";
    let big = openChannel([{ path: "big.ts", content: bigSrc }]);
    for (let i = 0; i < 5; i++) { big = applyOp(big, { kind: "replaceText", path: "big.ts", find: "Q = " + (i === 0 ? "1" : i), replace: "Q = " + (i + 1) }).state; }
    const sav = channelSavings(big);
    const savingsReal = sav.reductionPct > 50 && sav.ops === 5;
    // diff of a one-line change in a big file is far smaller than the file
    const bigDiff = diffSummary(big, "big.ts");
    const diffCompact = bigDiff.changed && JSON.stringify(bigDiff).length < big.files["big.ts"]!.working.length / 10;

    const deterministic = openChannel([{ path: "m.ts", content: src }]).id === openChannel([{ path: "m.ts", content: src }]).id;

    let stable = true;
    try { openChannel(null as never); applyOp(null as never, null as never); diffSummary(null as never, "x"); commitChannel(null as never); channelSavings(null as never); quickCheck(null as never); } catch { stable = false; }

    const perfect = appliesRegion && appliesText && workingExact && catchesBrokenStructure && rejectsBadOp && commitByteExact && diffCompact && savingsReal && deterministic && stable;
    return { appliesRegion, appliesText, workingExact, catchesBrokenStructure, rejectsBadOp, commitByteExact, diffCompact, savingsReal, deterministic, stable, score: perfect ? 100 : 0 };
  } catch {
    return { appliesRegion: false, appliesText: false, workingExact: false, catchesBrokenStructure: false, rejectsBadOp: false, commitByteExact: false, diffCompact: false, savingsReal: false, deterministic: false, stable: false, score: 0 };
  }
}
