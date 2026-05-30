/**
 * v2.112.0 — NEGATIVE-KNOWLEDGE LEDGER (NKL): "what we PROVED does not work".
 *
 * Every other memory layer records what HAPPENED or what WORKED. The rarest,
 * highest-leverage knowledge is the opposite: the approaches that were tried
 * and PROVEN to be dead ends. Knowing them lets an agent save tokens + time by
 * NOT walking a path a past session (or another vendor) already proved is a
 * trap — the cheapest work is the work you don't do.
 *
 * THE AUTO PROPERTY (the whole point — the user never types a command):
 *   - It LEARNS by itself. NKL derives dead-ends DETERMINISTICALLY from the
 *     LOOPGUARD event ledger that `mneme absorb` already fills as a side-effect
 *     of normal use. No manual recording, ever.
 *   - It DECIDES by itself. A "dead end" is a crisp, falsifiable definition —
 *     a base command whose failures repeated ≥N times across ALL recorded
 *     history with ZERO successes on that base. Not a guess; a measured fact.
 *   - It SURFACES by itself. DISTILL folds a "DEAD-END" warning into the brief;
 *     LOOPGUARD/the agent manifest check it before a retry. The knowledge
 *     reaches the agent through channels it already uses.
 *
 * HONESTY (Padgett guard): a dead-end is ADVISORY, never a hard block — an
 * approach that "never worked YET" might work after a real change. We say
 * "proven dead-end so far", we never forbid. Pure + total (108-error rule):
 * deterministic, no I/O, no LLM, never throws. CLI/MCP own the ledger read.
 */

import { type LoopEvent, baseKey } from "../loopguard/index.js";

export interface DeadEnd {
  /** the base command (verb[:sub]) proven to be a dead end. */
  base: string;
  /** the dominant failure signature for that base. */
  signature: string;
  /** how many times it failed across all recorded history. */
  failures: number;
  /** the most informative failure excerpt seen. */
  excerpt: string;
  /** first + last time it was attempted (epoch ms). */
  firstSeen: number;
  lastSeen: number;
}

/**
 * Derive the proven dead-ends from the full event history. A base command is a
 * dead end iff: it has ≥minFailures failing events AND zero success events on
 * that base anywhere in the history. Deterministic + total.
 */
export function deriveDeadEnds(events: LoopEvent[], opts?: { minFailures?: number }): DeadEnd[] {
  try {
    const minFailures = Math.max(2, Math.floor(opts?.minFailures ?? 2));
    const evs = Array.isArray(events) ? events.filter((e) => e && typeof e.at === "number") : [];
    if (evs.length === 0) return [];

    const succeededBase = new Set<string>();
    for (const e of evs) if (!e.hadError) succeededBase.add(e.base || baseKey(e.command));

    // group failures by base
    const byBase = new Map<string, LoopEvent[]>();
    for (const e of evs) {
      if (!e.hadError || !e.signature) continue;
      const b = e.base || baseKey(e.command);
      const arr = byBase.get(b) ?? [];
      arr.push(e);
      byBase.set(b, arr);
    }

    const out: DeadEnd[] = [];
    for (const [base, arr] of byBase) {
      if (succeededBase.has(base)) continue;          // it worked at least once → not a dead end
      if (arr.length < minFailures) continue;          // not enough evidence yet
      // dominant signature (most frequent) for this base
      const sigCount = new Map<string, number>();
      for (const e of arr) sigCount.set(e.signature, (sigCount.get(e.signature) ?? 0) + 1);
      let sig = arr[0]!.signature; let best = 0;
      for (const [s, c] of sigCount) if (c > best || (c === best && s < sig)) { sig = s; best = c; }
      const ats = arr.map((e) => e.at).sort((a, b) => a - b);
      const excerpt = (arr.find((e) => e.excerpt && e.signature === sig)?.excerpt) || arr[arr.length - 1]!.excerpt || "";
      out.push({ base, signature: sig, failures: arr.length, excerpt, firstSeen: ats[0]!, lastSeen: ats[ats.length - 1]! });
    }
    // most-failed first (deterministic tiebreak by base name)
    return out.sort((a, b) => b.failures - a.failures || a.base.localeCompare(b.base));
  } catch {
    return [];
  }
}

export interface ApproachVerdict {
  /** is this command's base a proven dead-end (advisory, not a block)? */
  isDeadEnd: boolean;
  base: string;
  signature: string;
  failures: number;
  /** plain-language, non-forbidding explanation. */
  reason: string;
  excerpt: string;
}

/**
 * Check whether a command's APPROACH is a proven dead-end before trying it.
 * Advisory (Padgett guard) — never forbids. Deterministic + total. */
export function checkApproach(events: LoopEvent[], command: string, opts?: { minFailures?: number }): ApproachVerdict {
  try {
    const base = baseKey(command);
    if (!base) return { isDeadEnd: false, base: "", signature: "", failures: 0, reason: "no command", excerpt: "" };
    const de = deriveDeadEnds(events, opts).find((d) => d.base === base);
    if (!de) return { isDeadEnd: false, base, signature: "", failures: 0, reason: "no proven dead-end for this approach", excerpt: "" };
    return {
      isDeadEnd: true,
      base: de.base,
      signature: de.signature,
      failures: de.failures,
      reason: `\`${de.base}\` was tried ${de.failures}× and never succeeded here — proven dead-end so far; try a genuinely different approach (advisory, not a block)`,
      excerpt: de.excerpt,
    };
  } catch {
    return { isDeadEnd: false, base: "", signature: "", failures: 0, reason: "engine error (safe)", excerpt: "" };
  }
}

export interface NklStats {
  totalEvents: number;
  totalFailures: number;
  deadEnds: number;
  /** the dead-end bases (most-failed first), capped. */
  bases: Array<{ base: string; failures: number }>;
}

/** Summarise the negative-knowledge corpus. Total. */
export function nklStats(events: LoopEvent[]): NklStats {
  try {
    const evs = Array.isArray(events) ? events.filter(Boolean) : [];
    const de = deriveDeadEnds(evs);
    return {
      totalEvents: evs.length,
      totalFailures: evs.filter((e) => e && e.hadError).length,
      deadEnds: de.length,
      bases: de.slice(0, 20).map((d) => ({ base: d.base, failures: d.failures })),
    };
  } catch {
    return { totalEvents: 0, totalFailures: 0, deadEnds: 0, bases: [] };
  }
}

export interface NklGauntlet {
  /** ≥minFailures failures with no success → dead-end. */
  detectsDeadEnd: boolean;
  /** a success on that base clears it → NOT a dead-end (it worked once). */
  successClears: boolean;
  /** below minFailures → not yet a dead-end (no premature condemnation). */
  noPrematureCondemn: boolean;
  /** checkApproach agrees with deriveDeadEnds. */
  checkConsistent: boolean;
  /** deterministic. */
  deterministic: boolean;
  /** total on garbage. */
  stable: boolean;
  score: number;
}

/** Prove the NKL engine. Total + deterministic. */
export function nklGauntlet(): NklGauntlet {
  try {
    const t = 1_000_000;
    const mk = (cmd: string, sig: string, hadError: boolean, at: number, excerpt = ""): LoopEvent =>
      ({ command: cmd, signature: sig, base: baseKey(cmd), hadError, at, excerpt });

    // a base that failed 3× and never succeeded → dead-end
    const dead = [
      mk("docker build", "docker:build:1:", true, t, "layer cache miss"),
      mk("docker build", "docker:build:1:", true, t + 1000, "layer cache miss"),
      mk("docker build", "docker:build:1:", true, t + 2000, "layer cache miss"),
    ];
    const d1 = deriveDeadEnds(dead);
    const detectsDeadEnd = d1.length === 1 && d1[0]!.base === "docker:build" && d1[0]!.failures === 3;

    // add a success on that base → cleared
    const cleared = [...dead, mk("docker build", "", false, t + 3000)];
    const successClears = deriveDeadEnds(cleared).length === 0;

    // only 1 failure → not yet condemned
    const noPrematureCondemn = deriveDeadEnds(dead.slice(0, 1)).length === 0;

    const v = checkApproach(dead, "docker build --no-cache");
    const checkConsistent = v.isDeadEnd === true && v.base === "docker:build" && v.failures === 3
      && checkApproach(cleared, "docker build").isDeadEnd === false;

    const deterministic = JSON.stringify(deriveDeadEnds(dead)) === JSON.stringify(deriveDeadEnds(dead));

    let stable = true;
    try { deriveDeadEnds(null as never); checkApproach(null as never, null as never); nklStats(null as never); } catch { stable = false; }

    const perfect = detectsDeadEnd && successClears && noPrematureCondemn && checkConsistent && deterministic && stable;
    return { detectsDeadEnd, successClears, noPrematureCondemn, checkConsistent, deterministic, stable, score: perfect ? 100 : 0 };
  } catch {
    return { detectsDeadEnd: false, successClears: false, noPrematureCondemn: false, checkConsistent: false, deterministic: false, stable: false, score: 0 };
  }
}
