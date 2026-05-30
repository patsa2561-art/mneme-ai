/**
 * v2.109.0 — MNEME LOGPIPE (Structured Terminal-Knowledge Extraction).
 *
 * Your daily terminal toil — the commands you run, the errors you hit, the
 * fixes you find — is short-term memory that evaporates by end of day. Pipe
 * it through Mneme (`mycmd 2>&1 | mneme absorb --cmd "mycmd"`) and it becomes
 * SIGNED, recallable, cross-agent knowledge — automatically.
 *
 * THE OUT-OF-BOX BIT (and why it's accurate, not hallucinated): terminal
 * output is HIGHLY STRUCTURED, so extraction is DETERMINISTIC — no LLM, no
 * invention. We pull {intent, error-class, error-excerpt, success/fail} from
 * the command + output by pure parsing, then (composing v2.104 + v2.106):
 *   - file it into the Cognitive Cortex as a signed fact (recall by any agent),
 *   - and when it's an error+fix pair, feed the Shell Autopilot's learned
 *     recoveries — closing the loop: ABSORB (learn) → AUTOPILOT (suggest).
 * Your terminal turns into a self-documenting, signed, shared lab notebook.
 *
 * Pure + total (108-error rule): deterministic, no network, never throws.
 */

import { failureSignature } from "../shell_autopilot/index.js";

const ERROR_MARKERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/command not found|is not recognized/i, "not-found"],
  [/no upstream|set the remote/i, "no-upstream"],
  [/updates were rejected|non-fast-forward/i, "rejected"],
  [/permission denied|eacces/i, "perm"],
  [/cannot find module|modulenotfounderror/i, "missing-module"],
  [/address already in use|eaddrinuse/i, "port-busy"],
  [/enoent|no such file/i, "enoent"],
  [/merge conflict/i, "conflict"],
  [/segmentation fault|core dumped/i, "segfault"],
  [/out of memory|oom|cuda out of memory|killed/i, "oom"],
  [/timeout|timed out/i, "timeout"],
  [/syntaxerror|parse error|unexpected token/i, "syntax"],
  [/\b(error|fatal|exception|traceback|panic)\b/i, "generic-error"],
];

export interface LogEntry {
  command: string;
  exitCode: number;
  hadError: boolean;
  /** coarse error class (mined deterministically from the output). */
  errorClass: string;
  /** the most informative error/result line from the output. */
  excerpt: string;
  /** a plain-language, DETERMINISTIC summary of intent (no LLM). */
  intent: string;
  /** failure signature (shared with the Shell Autopilot) for dedup + recall. */
  signature: string;
  kind: "error" | "success";
}

function firstErrorLine(output: string): { line: string; cls: string } {
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const [re, cls] of ERROR_MARKERS) {
    for (const l of lines) if (re.test(l)) return { line: l.slice(0, 300), cls };
  }
  return { line: (lines[lines.length - 1] ?? "").slice(0, 300), cls: "" };
}

/**
 * Extract structured knowledge from a command + its output + exit code.
 * Pure + deterministic — terminal output is structured enough that this
 * never needs to guess. Total. */
export function extractLogEntry(command: string, output: string, exitCode: number): LogEntry {
  try {
    const cmd = typeof command === "string" ? command.trim() : "";
    const out = typeof output === "string" ? output : "";
    const code = Number.isFinite(exitCode) ? exitCode : (out && /\b(error|fatal|exception|traceback)\b/i.test(out) ? 1 : 0);
    const { line, cls } = firstErrorLine(out);
    const hadError = code !== 0 || cls !== "" && cls !== "success";
    const errorClass = hadError ? (cls || "generic-error") : "";
    const toks = cmd.split(/\s+/).filter(Boolean);
    const verb = toks[0] ?? "?";
    const sub = toks[1] && /^[a-z][a-z-]*$/i.test(toks[1]) ? " " + toks[1] : "";
    const intent = `ran \`${verb}${sub}\`${hadError ? ` — failed (${errorClass})` : " — ok"}`;
    return {
      command: cmd, exitCode: code, hadError,
      errorClass, excerpt: line, intent,
      signature: failureSignature(cmd, hadError ? (code || 1) : 0, out),
      kind: hadError ? "error" : "success",
    };
  } catch {
    return { command: "", exitCode: 0, hadError: false, errorClass: "", excerpt: "", intent: "", signature: "", kind: "success" };
  }
}

/** Shape a log entry as a Cortex fact (key + value) for signed storage. Total. */
export function formatForCortex(entry: LogEntry): { key: string; value: string; kind: "warning" | "fact" } {
  try {
    const e = entry ?? ({} as LogEntry);
    if (e.hadError) {
      return { key: `log.error:${e.signature}`, value: `${e.intent}: ${e.excerpt}`.slice(0, 600), kind: "warning" };
    }
    return { key: `log.cmd:${(e.command || "").slice(0, 80)}`, value: `${e.intent}`.slice(0, 600), kind: "fact" };
  } catch { return { key: "log.unknown", value: "", kind: "fact" }; }
}

export interface LogpipeGauntlet {
  extractsError: boolean;
  extractsSuccess: boolean;
  classifies: boolean;
  signatureSharedWithAutopilot: boolean;
  deterministic: boolean;
  stable: boolean;
  score: number;
}

/** Prove the extraction engine. Total + deterministic. */
export function logpipeGauntlet(): LogpipeGauntlet {
  try {
    const err = extractLogEntry("git push", "fatal: The current branch has no upstream branch", 1);
    const extractsError = err.hadError && err.errorClass === "no-upstream" && err.excerpt.includes("upstream");
    const ok = extractLogEntry("npm test", "All tests passed (42)", 0);
    const extractsSuccess = ok.hadError === false && ok.kind === "success";
    const oom = extractLogEntry("python train.py", "RuntimeError: CUDA out of memory", 1);
    const classifies = oom.errorClass === "oom";
    // signature matches what the Shell Autopilot computes (so absorb feeds suggest)
    const signatureSharedWithAutopilot = err.signature === failureSignature("git push", 1, "no upstream branch");
    const deterministic = JSON.stringify(extractLogEntry("git push", "no upstream", 1)) === JSON.stringify(extractLogEntry("git push", "no upstream", 1));
    let stable = true;
    try { extractLogEntry(null as never, null as never, null as never); formatForCortex(null as never); } catch { stable = false; }
    const perfect = extractsError && extractsSuccess && classifies && signatureSharedWithAutopilot && deterministic && stable;
    return { extractsError, extractsSuccess, classifies, signatureSharedWithAutopilot, deterministic, stable, score: perfect ? 100 : 0 };
  } catch { return { extractsError: false, extractsSuccess: false, classifies: false, signatureSharedWithAutopilot: false, deterministic: false, stable: false, score: 0 }; }
}
