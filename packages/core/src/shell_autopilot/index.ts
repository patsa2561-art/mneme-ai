/**
 * v2.106.0 — SHELL AUTOPILOT (the last piece of the Zero-Effort Flow).
 *
 * The user keeps typing on the same black terminal. When a command FAILS,
 * Mneme shows a faint phantom recovery suggestion; one keystroke runs it.
 * No command to memorise — the safety net is just there.
 *
 * THE WILD-BUT-HONEST INNOVATION: the recovery is not a frozen heuristic.
 * When a failure is followed by a command that SUCCEEDS, Mneme learns
 * (failure-signature → recovery) and signs it into the COGNITIVE CORTEX —
 * so the suggestion gets smarter from the user's OWN "dark data" (their
 * real terminal history, never uploaded), and a recovery PROVEN on this
 * machine becomes a signed fact EVERY agent (any vendor) can recall. The
 * autopilot is the surface of the Sovereign Memory Bus. Built-in rules are
 * the cold-start; the cortex is the flywheel.
 *
 * This module is PURE + total (108-error rule): signature + suggestion are
 * deterministic functions, no I/O, never throw. The CLI wires the cortex
 * lookup + the shell hook; the engine here is fully unit-testable.
 */

/**
 * Normalise a failed command + exit code into a stable SIGNATURE, so
 * "git push origin feature-x" and "git push origin feature-y" share one
 * learned recovery. Variable parts (paths, hashes, quoted args, numbers)
 * are masked. Deterministic.
 */
export function failureSignature(cmd: string, code: number, stderr?: string): string {
  const c = typeof cmd === "string" ? cmd.trim() : "";
  const toks = c.split(/\s+/).filter(Boolean);
  const verb = (toks[0] ?? "").toLowerCase();
  const sub = (toks[1] && /^[a-z][a-z-]*$/i.test(toks[1]) ? toks[1].toLowerCase() : "");
  // a coarse error class mined from stderr (first matching keyword)
  const err = (typeof stderr === "string" ? stderr : "").toLowerCase();
  let errClass = "";
  for (const [k, cls] of ERR_CLASSES) if (err.includes(k)) { errClass = cls; break; }
  const codeN = Number.isFinite(code) ? code : 0;
  return [verb, sub, codeN, errClass].filter((x) => x !== "").join(":");
}

const ERR_CLASSES: ReadonlyArray<readonly [string, string]> = [
  ["command not found", "not-found"], ["is not recognized", "not-found"],
  ["no upstream", "no-upstream"], ["set the remote", "no-upstream"],
  ["updates were rejected", "rejected"], ["non-fast-forward", "rejected"],
  ["permission denied", "perm"], ["eacces", "perm"],
  ["cannot find module", "missing-module"], ["modulenotfounderror", "missing-module"],
  ["address already in use", "port-busy"], ["eaddrinuse", "port-busy"],
  ["enoent", "enoent"], ["no such file", "enoent"],
  ["merge conflict", "conflict"], ["detached head", "detached"],
];

export interface RecoveryRule {
  id: string;
  /** does this rule apply? */
  match: (verb: string, code: number, errClass: string, cmd: string) => boolean;
  /** the suggested recovery command. */
  recovery: (cmd: string) => string;
  reason: string;
}

/** Built-in, deterministic cold-start recovery rules for common failures.
 *  All advisory — the user runs them by choice. Order = priority. */
export const RECOVERY_RULES: ReadonlyArray<RecoveryRule> = [
  { id: "git-no-upstream", match: (v, _c, e) => v === "git" && e === "no-upstream", recovery: () => "git push -u origin HEAD", reason: "the branch has no upstream — push + set it" },
  { id: "git-rejected", match: (v, _c, e) => v === "git" && e === "rejected", recovery: () => "git pull --rebase", reason: "remote has commits you don't — rebase onto them, then push" },
  { id: "node-missing-module", match: (_v, _c, e) => e === "missing-module", recovery: () => "npm install", reason: "a module isn't installed — install dependencies" },
  { id: "port-busy", match: (_v, _c, e) => e === "port-busy", recovery: () => "npx kill-port 3000   # change the port number to the busy one", reason: "the port is already in use — free it (verify the port first)" },
  { id: "perm", match: (_v, _c, e) => e === "perm", recovery: (cmd) => `chmod +x ${(cmd.split(/\s+/).pop() ?? "<file>")}   # or re-run with the right permissions`, reason: "permission denied — adjust permissions (review before running)" },
  { id: "enoent-pkg", match: (v, _c, e) => v === "npm" && e === "enoent", recovery: () => "cd <your-project-dir>   # run npm where package.json lives", reason: "npm couldn't find package.json — you're likely in the wrong directory" },
  { id: "not-found", match: (_v, _c, e) => e === "not-found", recovery: (cmd) => `# '${(cmd.split(/\s+/)[0] ?? "")}' isn't on PATH — check the spelling or install it`, reason: "command not found — typo or not installed" },
];

export interface Suggestion {
  recovery: string | null;
  source: "learned" | "rule" | "none";
  confidence: "high" | "medium" | "low";
  reason: string;
  signature: string;
}

/**
 * Suggest a recovery for a failed command. LEARNED recoveries (proven on
 * this machine, from the cortex) win over the built-in rules. Pure + total:
 * garbage in → a "none" suggestion, never a throw, never a destructive auto-run.
 */
export function suggestRecovery(cmd: string, code: number, stderr?: string, learned?: Record<string, string>): Suggestion {
  try {
    const c = typeof cmd === "string" ? cmd : "";
    const codeN = Number.isFinite(code) ? code : 0;
    if (!c.trim() || codeN === 0) return { recovery: null, source: "none", confidence: "low", reason: "no failed command", signature: "" };
    const sig = failureSignature(c, codeN, stderr);
    // 1) learned (proven) recovery from the user's own dark data wins.
    if (learned && typeof learned[sig] === "string" && learned[sig]!.length > 0) {
      return { recovery: learned[sig]!, source: "learned", confidence: "high", reason: "proven on this machine before (recalled from the shared cortex)", signature: sig };
    }
    // 2) built-in deterministic rule.
    const verb = (c.trim().split(/\s+/)[0] ?? "").toLowerCase();
    const err = (typeof stderr === "string" ? stderr : "").toLowerCase();
    let errClass = "";
    for (const [k, cls] of ERR_CLASSES) if (err.includes(k)) { errClass = cls; break; }
    for (const r of RECOVERY_RULES) {
      if (r.match(verb, codeN, errClass, c)) return { recovery: r.recovery(c), source: "rule", confidence: "medium", reason: r.reason, signature: sig };
    }
    return { recovery: null, source: "none", confidence: "low", reason: "no known recovery — left to the user", signature: sig };
  } catch { return { recovery: null, source: "none", confidence: "low", reason: "engine error (safe)", signature: "" }; }
}

export type ShellKind = "powershell" | "bash" | "zsh";

/** The cortex key under which a learned recovery for a signature is stored. */
export function recoveryKey(signature: string): string { return `shell.recovery:${signature}`; }

/**
 * Generate the shell hook script (sentinel-bracketed, fail-open,
 * non-destructive). It prints a faint suggestion after a failed command and
 * binds a hotkey to insert it — it NEVER auto-runs anything. `binInvoke` is
 * how to call mneme (default "mneme"; tests/CI may pass a node+path form).
 * Total + deterministic.
 */
export function generateHook(shell: ShellKind, binInvoke = "mneme"): string {
  const BEGIN = "# >>> mneme shell autopilot >>>";
  const END = "# <<< mneme shell autopilot <<<";
  if (shell === "powershell") {
    return [
      BEGIN,
      "# Non-destructive: prints a faint recovery after a failed command; Alt+r inserts it (never auto-runs). Fail-open.",
      "if (-not (Test-Path variable:global:__mneme_prevPrompt)) { $global:__mneme_prevPrompt = $function:prompt }",
      "function global:prompt {",
      "  try {",
      "    $code = $LASTEXITCODE",
      "    if ($code -ne $null -and $code -ne 0) {",
      "      $last = (Get-History -Count 1 -ErrorAction SilentlyContinue).CommandLine",
      "      if ($last) {",
      `        $j = & ${binInvoke} shell suggest --cmd "$last" --code $code --json 2>$null | ConvertFrom-Json`,
      "        if ($j.recovery) { Write-Host \"  mneme ↻ $($j.recovery)  [Alt+r]\" -ForegroundColor DarkGray; $global:__mneme_suggestion = $j.recovery }",
      "      }",
      "    }",
      "  } catch { }",
      "  & $global:__mneme_prevPrompt",
      "}",
      "if (Get-Module -ListAvailable PSReadLine) { Set-PSReadLineKeyHandler -Chord 'Alt+r' -ScriptBlock { if ($global:__mneme_suggestion) { [Microsoft.PowerShell.PSConsoleReadLine]::Insert($global:__mneme_suggestion) } } }",
      END,
    ].join("\n");
  }
  // bash / zsh share the same precmd-style logic.
  const widget = shell === "zsh";
  return [
    BEGIN,
    "# Non-destructive: prints a faint recovery after a failed command; the suggestion is in $MNEME_SUGGESTION (never auto-runs). Fail-open.",
    "__mneme_autopilot() {",
    "  local code=$?",
    `  [ "$code" -eq 0 ] && return`,
    "  local last; last=$(fc -ln -1 2>/dev/null | sed 's/^[[:space:]]*//')",
    `  [ -z "$last" ] && return`,
    `  local s; s=$(${binInvoke} shell suggest --cmd "$last" --code "$code" --field recovery 2>/dev/null)`,
    `  if [ -n "$s" ]; then export MNEME_SUGGESTION="$s"; printf '  \\033[2mmneme \\342\\206\\273 %s\\033[0m\\n' "$s"; fi`,
    "}",
    widget
      ? "autoload -Uz add-zsh-hook 2>/dev/null && add-zsh-hook precmd __mneme_autopilot"
      : "case \"$PROMPT_COMMAND\" in *__mneme_autopilot*) ;; *) PROMPT_COMMAND=\"__mneme_autopilot;${PROMPT_COMMAND}\" ;; esac",
    END,
  ].join("\n");
}

export interface AutopilotGauntlet {
  /** known failures map to the right recovery (deterministic). */
  rulesFire: boolean;
  /** a learned recovery overrides the built-in rule. */
  learnedWins: boolean;
  /** the signature is stable across variable args. */
  signatureStable: boolean;
  /** hook scripts are non-destructive (no auto-run) + sentinel-bracketed. */
  hookSafe: boolean;
  /** total on garbage. */
  stable: boolean;
  score: number;
}

/** Prove the autopilot engine. Total + deterministic. */
export function autopilotGauntlet(): AutopilotGauntlet {
  try {
    const git = suggestRecovery("git push", 1, "fatal: The current branch has no upstream branch");
    const rulesFire = git.source === "rule" && git.recovery === "git push -u origin HEAD";
    const learned = { [failureSignature("git push", 1, "no upstream")]: "git push --set-upstream origin HEAD" };
    const l = suggestRecovery("git push", 1, "no upstream branch", learned);
    const learnedWins = l.source === "learned" && l.recovery === "git push --set-upstream origin HEAD";
    const signatureStable = failureSignature("git push origin feat-a", 1, "no upstream") === failureSignature("git push origin feat-b", 1, "no upstream");
    const ps = generateHook("powershell"); const bash = generateHook("bash");
    const hookSafe = ps.includes(">>> mneme shell autopilot >>>") && ps.includes("Alt+r") && !ps.includes("Invoke-Expression")
      && bash.includes("__mneme_autopilot") && !/eval .\$s/.test(bash);
    let stable = true;
    try { suggestRecovery(null as never, null as never); failureSignature(null as never, null as never); generateHook("bash"); } catch { stable = false; }
    const perfect = rulesFire && learnedWins && signatureStable && hookSafe && stable;
    return { rulesFire, learnedWins, signatureStable, hookSafe, stable, score: perfect ? 100 : 0 };
  } catch { return { rulesFire: false, learnedWins: false, signatureStable: false, hookSafe: false, stable: false, score: 0 }; }
}
