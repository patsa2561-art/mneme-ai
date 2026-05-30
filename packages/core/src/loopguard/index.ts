/**
 * v2.110.0 — MNEME LOOPGUARD (Objective Thrash Detection + Deterministic Resume).
 *
 * The honest, measurable core of "Terminal Cognitive Telemetry". We do NOT
 * read your stress, your keystrokes, or your mood — that is unmeasurable
 * theatre. We detect ONE thing, deterministically and provably: you (or an AI
 * agent) are THRASHING — the SAME failure-signature has repeated ≥N times in a
 * window with no success in between. That is an objective signal a human or an
 * agent is stuck in a loop, and it is the moment to break the loop by surfacing
 * the knowledge already accumulated (cortex recall / a learned recovery).
 *
 * Two powers, both deterministic (a sequence of events → a verdict, no LLM):
 *   1. detectStuck()     — "are we thrashing on the same failure right now?"
 *   2. summarizeSession() — `mneme resume`: where you left off, last error,
 *                           whether it was resolved, and the known next move.
 *
 * THE KILLER FOR AI AGENTS: agents (CrewAI / Devin / a tool-loop) silently
 * burn time + tokens retrying a failing approach. `mneme.loopguard.check` is a
 * boolean an agent can ask itself — "have I tried this failing thing too many
 * times? stop and recall what's known" — measurable, not mind-reading.
 *
 * Events are fed by LOGPIPE (v2.109): every `absorb` appends one. This module
 * is PURE + total (108-error rule): no I/O, no network, never throws. The CLI
 * /MCP layers own the ledger I/O; the engine here is fully unit-testable.
 */

/** Relative path (under repo root) of the append-only event ledger. */
export const LOOPGUARD_LEDGER = ".mneme/loopguard/events.jsonl";

/** One terminal/agent event. `signature` is the Shell-Autopilot failure
 *  signature (shared, so a thrash maps to a known recovery); for a success it
 *  is the empty string. `base` is verb[+sub] — used to detect resolution. */
export interface LoopEvent {
  command: string;
  signature: string;
  base: string;
  hadError: boolean;
  at: number;
  excerpt?: string;
}

/** Derive a stable base key (verb[+sub]) from a command. Deterministic. */
export function baseKey(command: string): string {
  const c = typeof command === "string" ? command.trim() : "";
  const toks = c.split(/\s+/).filter(Boolean);
  const verb = (toks[0] ?? "").toLowerCase();
  const sub = toks[1] && /^[a-z][a-z-]*$/i.test(toks[1]) ? ":" + toks[1].toLowerCase() : "";
  return verb + sub;
}

/** Build a LoopEvent from a logpipe LogEntry-shaped object. Pure + total. */
export function toEvent(
  entry: { command?: string; signature?: string; hadError?: boolean; excerpt?: string },
  at: number,
): LoopEvent {
  const command = typeof entry?.command === "string" ? entry.command : "";
  return {
    command,
    signature: typeof entry?.signature === "string" ? entry.signature : "",
    base: baseKey(command),
    hadError: entry?.hadError === true,
    at: Number.isFinite(at) ? at : 0,
    excerpt: typeof entry?.excerpt === "string" ? entry.excerpt.slice(0, 300) : "",
  };
}

/** Parse the JSONL ledger into events (skips bad lines). Pure + total. */
export function parseLedger(text: string): LoopEvent[] {
  const out: LoopEvent[] = [];
  if (typeof text !== "string" || text.length === 0) return out;
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    try {
      const o = JSON.parse(l) as Record<string, unknown>;
      const command = typeof o["command"] === "string" ? (o["command"] as string) : "";
      out.push({
        command,
        signature: typeof o["signature"] === "string" ? (o["signature"] as string) : "",
        base: typeof o["base"] === "string" ? (o["base"] as string) : baseKey(command),
        hadError: o["hadError"] === true,
        at: typeof o["at"] === "number" && Number.isFinite(o["at"]) ? (o["at"] as number) : 0,
        excerpt: typeof o["excerpt"] === "string" ? (o["excerpt"] as string) : "",
      });
    } catch { /* skip malformed line */ }
  }
  return out;
}

export interface StuckVerdict {
  /** are we thrashing on one failing signature right now? */
  stuck: boolean;
  /** the thrashing failure signature (empty when not stuck). */
  signature: string;
  /** a representative command for that signature. */
  command: string;
  /** how many failed repeats of that signature inside the window. */
  repeats: number;
  /** span (ms) of the thrash, from first to last repeat. */
  spanMs: number;
  /** the threshold used. */
  threshold: number;
  /** plain-language explanation (never alarmist). */
  reason: string;
}

const NOT_STUCK = (threshold: number, reason: string): StuckVerdict => ({
  stuck: false, signature: "", command: "", repeats: 0, spanMs: 0, threshold, reason,
});

/**
 * Detect objective thrashing: the SAME failure-signature repeated ≥threshold
 * times inside the trailing window, with NO success on the same base command
 * after the most recent failure (an intervening success = the loop is broken).
 *
 * Deterministic — same events → same verdict. Total: garbage → not-stuck.
 */
export function detectStuck(
  events: LoopEvent[],
  opts?: { threshold?: number; windowMs?: number; now?: number },
): StuckVerdict {
  try {
    const threshold = Math.max(2, Math.floor(opts?.threshold ?? 3));
    const windowMs = Math.max(1, Math.floor(opts?.windowMs ?? 15 * 60_000));
    const evs = Array.isArray(events) ? events.filter((e) => e && typeof e.at === "number") : [];
    if (evs.length === 0) return NOT_STUCK(threshold, "no events");
    const sorted = [...evs].sort((a, b) => a.at - b.at);
    const now = Number.isFinite(opts?.now as number) ? (opts!.now as number) : sorted[sorted.length - 1]!.at;
    const windowStart = now - windowMs;
    const inWindow = sorted.filter((e) => e.at >= windowStart && e.at <= now);
    if (inWindow.length === 0) return NOT_STUCK(threshold, "no recent events");

    // tally failed events by signature within the window
    const bySig = new Map<string, LoopEvent[]>();
    for (const e of inWindow) {
      if (!e.hadError || !e.signature) continue;
      const arr = bySig.get(e.signature) ?? [];
      arr.push(e);
      bySig.set(e.signature, arr);
    }
    // pick the most-repeated failing signature (ties → most recent last failure)
    let best: { sig: string; arr: LoopEvent[] } | null = null;
    for (const [sig, arr] of bySig) {
      if (arr.length < threshold) continue;
      if (!best || arr.length > best.arr.length ||
        (arr.length === best.arr.length && arr[arr.length - 1]!.at > best.arr[best.arr.length - 1]!.at)) {
        best = { sig, arr };
      }
    }
    if (!best) return NOT_STUCK(threshold, "no signature repeated past the threshold");

    // resolution check: a success on the SAME base command AFTER the last
    // failure means the loop was broken — not stuck.
    const lastFail = best.arr[best.arr.length - 1]!;
    const base = lastFail.base || baseKey(lastFail.command);
    const resolvedAfter = inWindow.some(
      (e) => !e.hadError && e.at > lastFail.at && (e.base || baseKey(e.command)) === base,
    );
    if (resolvedAfter) return NOT_STUCK(threshold, "the last failure was followed by a success (loop broken)");

    const spanMs = lastFail.at - best.arr[0]!.at;
    return {
      stuck: true,
      signature: best.sig,
      command: lastFail.command,
      repeats: best.arr.length,
      spanMs,
      threshold,
      reason: `the same failure (\`${base}\`) repeated ${best.arr.length}× with no success in between — surface what's already known instead of retrying blind`,
    };
  } catch {
    return NOT_STUCK(3, "engine error (safe)");
  }
}

export interface ResumeSummary {
  /** the most recent command run. */
  lastCommand: string;
  /** the most recent UNRESOLVED error's excerpt (null if none / resolved). */
  lastError: string | null;
  /** was the most recent error followed by a success on the same base? */
  resolved: boolean;
  /** failing signatures seen, with counts (most frequent first). */
  repeatedFailures: Array<{ signature: string; count: number; base: string }>;
  /** the thrash verdict (so `resume` doubles as a stuck check). */
  stuck: StuckVerdict;
  /** a known recovery for the unresolved error, if `recall` provided one. */
  suggestion: string | null;
  /** a one-line, deterministic "here's where you were" line. */
  headline: string;
}

/**
 * `mneme resume` — reconstruct, deterministically, where a session left off
 * from the event ledger. `recall(signature)` is an optional lookup (the CLI/MCP
 * wires it to the cortex's learned recoveries) — pure here, no I/O.
 *
 * Total: empty/garbage → an honest empty summary, never a throw. */
export function summarizeSession(
  events: LoopEvent[],
  recall?: (signature: string) => string | null,
  opts?: { now?: number; windowMs?: number; threshold?: number },
): ResumeSummary {
  try {
    const evs = Array.isArray(events) ? events.filter((e) => e && typeof e.at === "number") : [];
    const stuck = detectStuck(evs, opts);
    if (evs.length === 0) {
      return { lastCommand: "", lastError: null, resolved: false, repeatedFailures: [], stuck, suggestion: null, headline: "no recorded terminal activity yet — run commands through `mneme absorb` to build a resume" };
    }
    const sorted = [...evs].sort((a, b) => a.at - b.at);
    const last = sorted[sorted.length - 1]!;
    // most recent error and whether a later success resolved its base
    let lastErrEvent: LoopEvent | null = null;
    for (let i = sorted.length - 1; i >= 0; i--) { if (sorted[i]!.hadError && sorted[i]!.signature) { lastErrEvent = sorted[i]!; break; } }
    let resolved = false;
    if (lastErrEvent) {
      const base = lastErrEvent.base || baseKey(lastErrEvent.command);
      resolved = sorted.some((e) => !e.hadError && e.at > lastErrEvent!.at && (e.base || baseKey(e.command)) === base);
    }
    // tally failing signatures
    const counts = new Map<string, { count: number; base: string }>();
    for (const e of sorted) {
      if (!e.hadError || !e.signature) continue;
      const cur = counts.get(e.signature) ?? { count: 0, base: e.base || baseKey(e.command) };
      cur.count += 1;
      counts.set(e.signature, cur);
    }
    const repeatedFailures = [...counts.entries()]
      .map(([signature, v]) => ({ signature, count: v.count, base: v.base }))
      .sort((a, b) => b.count - a.count || a.signature.localeCompare(b.signature));
    const lastError = lastErrEvent && !resolved ? (lastErrEvent.excerpt || lastErrEvent.command) : null;
    let suggestion: string | null = null;
    if (lastErrEvent && !resolved && typeof recall === "function") {
      try { const s = recall(lastErrEvent.signature); suggestion = typeof s === "string" && s.length > 0 ? s : null; } catch { suggestion = null; }
    }
    const headline = lastError
      ? `last ran \`${last.command || baseKey(last.command)}\`; unresolved error: ${lastError.slice(0, 120)}${suggestion ? ` — known fix: ${suggestion}` : ""}`
      : `last ran \`${last.command || baseKey(last.command)}\` — ${resolved ? "the last error was resolved" : "no open errors"}`;
    return { lastCommand: last.command, lastError, resolved, repeatedFailures, stuck, suggestion, headline };
  } catch {
    return { lastCommand: "", lastError: null, resolved: false, repeatedFailures: [], stuck: NOT_STUCK(3, "engine error (safe)"), suggestion: null, headline: "resume unavailable (safe)" };
  }
}

export interface LoopguardGauntlet {
  /** ≥threshold same failures in window → stuck. */
  detectsThrash: boolean;
  /** an intervening success breaks the loop → not stuck. */
  successBreaksLoop: boolean;
  /** below threshold → not stuck (no false alarm). */
  noFalseAlarm: boolean;
  /** distinct failures don't aggregate into a thrash. */
  distinctNotStuck: boolean;
  /** resume reconstructs last command + unresolved error + recall fix. */
  resumeReconstructs: boolean;
  /** deterministic: same events → same verdict. */
  deterministic: boolean;
  /** total on garbage. */
  stable: boolean;
  score: number;
}

/** Prove the loopguard engine end-to-end. Total + deterministic. */
export function loopguardGauntlet(): LoopguardGauntlet {
  try {
    const t = 1_000_000;
    const mk = (cmd: string, sig: string, hadError: boolean, at: number, excerpt = ""): LoopEvent => toEvent({ command: cmd, signature: sig, hadError, excerpt }, at);
    // thrash: git push fails with same signature 3× inside the window
    const thrash = [
      mk("git push", "git:push:1:no-upstream", true, t, "no upstream branch"),
      mk("git push", "git:push:1:no-upstream", true, t + 1000, "no upstream branch"),
      mk("git push", "git:push:1:no-upstream", true, t + 2000, "no upstream branch"),
    ];
    const v1 = detectStuck(thrash, { now: t + 2500 });
    const detectsThrash = v1.stuck && v1.repeats === 3 && v1.signature === "git:push:1:no-upstream";

    // a later success on the same base breaks the loop
    const broken = [...thrash, mk("git push -u origin HEAD", "", false, t + 3000)];
    const v2 = detectStuck(broken, { now: t + 3500 });
    const successBreaksLoop = v2.stuck === false;

    // below threshold (2 < 3) → not stuck
    const v3 = detectStuck(thrash.slice(0, 2), { now: t + 2500 });
    const noFalseAlarm = v3.stuck === false;

    // 3 DISTINCT failures don't aggregate
    const distinct = [
      mk("git push", "git:push:1:no-upstream", true, t),
      mk("npm test", "npm:test:1:", true, t + 1000),
      mk("python a.py", "python:1:oom", true, t + 2000),
    ];
    const v4 = detectStuck(distinct, { now: t + 2500 });
    const distinctNotStuck = v4.stuck === false;

    // resume: reconstruct + recall a known fix for the unresolved error
    const recall = (sig: string) => (sig === "git:push:1:no-upstream" ? "git push -u origin HEAD" : null);
    const r = summarizeSession(thrash, recall, { now: t + 2500 });
    const resumeReconstructs = r.lastCommand === "git push" && r.lastError !== null && r.resolved === false
      && r.suggestion === "git push -u origin HEAD" && r.stuck.stuck === true
      && r.repeatedFailures.length === 1 && r.repeatedFailures[0]!.count === 3;

    const deterministic = JSON.stringify(detectStuck(thrash, { now: t + 2500 })) === JSON.stringify(detectStuck(thrash, { now: t + 2500 }));

    let stable = true;
    try {
      detectStuck(null as never);
      detectStuck([null as never, { at: "x" } as never]);
      summarizeSession(null as never);
      parseLedger(null as never);
      toEvent(null as never, NaN);
      baseKey(null as never);
    } catch { stable = false; }

    const perfect = detectsThrash && successBreaksLoop && noFalseAlarm && distinctNotStuck && resumeReconstructs && deterministic && stable;
    return { detectsThrash, successBreaksLoop, noFalseAlarm, distinctNotStuck, resumeReconstructs, deterministic, stable, score: perfect ? 100 : 0 };
  } catch {
    return { detectsThrash: false, successBreaksLoop: false, noFalseAlarm: false, distinctNotStuck: false, resumeReconstructs: false, deterministic: false, stable: false, score: 0 };
  }
}
