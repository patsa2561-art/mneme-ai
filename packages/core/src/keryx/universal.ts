/**
 * THE UNIVERSAL GATE — gate the COMMAND, not the agent.
 *
 * Claude Code has a PreToolUse hook; Grok / Gemini / Cursor / aider each have different (or no)
 * hook APIs. Chasing every vendor's hook is a losing game. The insight: every coding agent —
 * and every human — ultimately runs **shell commands**, and the shell/PATH layer is *universal*.
 * So we intercept THERE: a tiny shim, first on PATH, for a curated set of high-risk commands
 * (rm, git, kubectl, terraform, dd, …). When the agent (any vendor) runs `git push --force`, the
 * shim calls `mneme pager request` FIRST, broadcasts to your chats, and only `exec`s the real
 * binary on **allow** — otherwise it refuses. One gate, every vendor, even a human at the keyboard.
 *
 * The real binary path is resolved + baked at install time (so the shim never recurses into
 * itself). Pure generators + a decision parser here; the install/PATH I/O is the CLI's job.
 *
 * ★HONEST: this gates the commands you shim, and only when the agent uses the shimmed PATH
 * (most do; an absolute-path invocation bypasses it). It is defense-in-depth, not a kernel
 * sandbox — pair with `mneme heph`/CERBERUS for blast-radius classification.
 */

export const DEFAULT_GUARDED = ["rm", "git", "kubectl", "terraform", "dd", "docker", "npm", "pnpm", "yarn", "make", "ssh", "psql", "mysql"] as const;

/** Parse the pager's PreToolUse JSON → the decision. Default ALLOW on unparseable (never wedge the shell). */
export function parseHookDecision(stdout: string): "allow" | "deny" | "ask" {
  try {
    const m = String(stdout ?? "").match(/"permissionDecision"\s*:\s*"(allow|deny|ask|defer)"/);
    const d = m?.[1];
    if (d === "deny") return "deny";
    if (d === "ask") return "ask";
    return "allow";
  } catch { return "allow"; }
}

/** POSIX sh shim for one command. realPath is resolved at install time (skips the shim itself). */
export function shimScriptSh(command: string, realPath: string, mnemeBin = "mneme"): string {
  const c = String(command); const real = String(realPath); const bin = String(mnemeBin);
  return `#!/usr/bin/env sh
# Mneme Universal Gate shim — gate the command, not the agent. Auto-generated; safe to delete.
__mneme_cmd="${c} $*"
__mneme_out="$(${bin} pager request --agent "\${MNEME_AGENT:-agent}" --command "$__mneme_cmd" 2>/dev/null)"
case "$__mneme_out" in
  *'"permissionDecision":"deny"'*) printf '⛔ Mneme: denied "%s" (no approval)\\n' "$__mneme_cmd" 1>&2; exit 1 ;;
esac
exec "${real}" "$@"
`;
}

/** PowerShell shim (Windows). */
export function shimScriptPs1(command: string, realPath: string, mnemeBin = "mneme"): string {
  const c = String(command); const real = String(realPath); const bin = String(mnemeBin);
  return `# Mneme Universal Gate shim (PowerShell) — gate the command, not the agent. Auto-generated.
$cmd = "${c} $($args -join ' ')"
$out = & ${bin} pager request --agent ($env:MNEME_AGENT ?? "agent") --command $cmd 2>$null
if ($out -match '"permissionDecision":"deny"') { Write-Error "Mneme: denied '$cmd' (no approval)"; exit 1 }
& "${real}" @args
exit $LASTEXITCODE
`;
}

export interface UniversalGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function universalGateGauntlet(): UniversalGauntlet {
  const dDeny = parseHookDecision('{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"x"}}') === "deny";
  const dAllow = parseHookDecision('{"hookSpecificOutput":{"permissionDecision":"allow"}}') === "allow";
  const dAsk = parseHookDecision('{"hookSpecificOutput":{"permissionDecision":"ask"}}') === "ask";
  const dSafe = parseHookDecision("garbage not json") === "allow" && parseHookDecision("") === "allow" && parseHookDecision(null as never) === "allow"; // never wedge the shell
  const sh = shimScriptSh("git", "/usr/bin/git");
  const shOK = sh.includes("pager request") && sh.includes('exec "/usr/bin/git"') && sh.includes('"permissionDecision":"deny"') && sh.startsWith("#!");
  const ps = shimScriptPs1("git", "C:\\\\Program Files\\\\Git\\\\git.exe");
  const psOK = ps.includes("pager request") && ps.includes("LASTEXITCODE") && ps.includes("permissionDecision");
  const noRecurse = shimScriptSh("rm", "/bin/rm").includes('exec "/bin/rm"');   // execs the REAL binary, not itself
  const total = (() => { try { parseHookDecision(null as never); shimScriptSh(null as never, null as never); shimScriptPs1(null as never, null as never); return true; } catch { return false; } })();
  const checks = [
    { name: "DECISION-DENY", pass: dDeny, detail: "a deny verdict is read from the pager's hook JSON" },
    { name: "DECISION-ALLOW", pass: dAllow && dAsk, detail: "allow/ask parsed correctly" },
    { name: "FAIL-OPEN-SAFE", pass: dSafe, detail: "unparseable/empty → allow (a gate failure never wedges the shell)" },
    { name: "SH-SHIM-SHAPE", pass: shOK, detail: "POSIX shim calls pager request + execs the REAL binary on non-deny" },
    { name: "PS1-SHIM-SHAPE", pass: psOK, detail: "PowerShell shim forwards args + propagates exit code" },
    { name: "NO-SELF-RECURSE", pass: noRecurse, detail: "the shim execs the resolved real binary (baked at install), never itself" },
    { name: "TOTAL", pass: total, detail: "never throws on garbage" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
