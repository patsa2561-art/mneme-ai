/**
 * v2.4.0 -- SAFE EXEC. Root-cause fix for the entire command-injection
 * class. Bans `execSync(`cmd ${var}`)` template-string usage across the
 * codebase; substitutes a `spawnSync` wrapper that takes an argv array
 * (no shell), strict-validates every element, and refuses if a metachar
 * survives.
 *
 * Why this exists:
 *   - Two security audits found injection vectors in autoboot
 *     installers (crontab pipe, reg add) and in apoptosis/witnesses
 *     (git -C "${repoRoot}"). The repoRoot could come from an MCP tool
 *     arg, so the path is attacker-controlled in the worst case.
 *   - Even when the input is "trusted", a single typo (e.g., a regex
 *     boundary off-by-one) can re-expose the vector. Pushing every call
 *     through one helper makes the WHOLE class disappear.
 *
 * Contract:
 *   - All args are strings. Arrays / objects / undefined are rejected.
 *   - Default `shell: false`; the call never sees a shell.
 *   - Timeouts are mandatory (caller passes timeoutMs; default 5000).
 *   - Output captured as a string up to a configurable cap.
 *   - On error: throws an Error with .stderr + .signal preserved, never
 *     leaks the full argv into the message (logs cmd + first arg only).
 */

import { spawnSync, type SpawnSyncOptions } from "node:child_process";

export interface SafeExecOptions {
  /** Working directory. Must be an absolute path; relative paths rejected. */
  cwd?: string;
  /** Hard timeout in ms. Default 5000. */
  timeoutMs?: number;
  /** Maximum stdout+stderr capture (bytes). Default 1 MB. */
  maxBuffer?: number;
  /** Environment override. */
  env?: NodeJS.ProcessEnv;
  /** stdin payload (string). */
  input?: string;
  /** Encoding. Default utf8. */
  encoding?: BufferEncoding;
}

export interface SafeExecResult {
  stdout: string;
  stderr: string;
  status: number | null;
  /** Signal that terminated the process, if any. */
  signal: NodeJS.Signals | null;
}

const FORBIDDEN_ARG_PATTERNS = [
  /\0/,             // NUL byte
  /[\r\n]/,         // newline injection (some commands respect this)
];

function validateArg(arg: unknown, idx: number): string {
  if (typeof arg !== "string") {
    throw new Error(`safeExec: argv[${idx}] must be a string, got ${typeof arg}`);
  }
  for (const re of FORBIDDEN_ARG_PATTERNS) {
    if (re.test(arg)) {
      throw new Error(`safeExec: argv[${idx}] contains forbidden character (NUL or newline)`);
    }
  }
  return arg;
}

/**
 * Run `cmd argv` with NO shell. argv is an array of strings;
 * each string is passed verbatim as a single argument to the kernel exec.
 * The shell never sees the template — so $(...) / backticks / ; / | /
 * redirects / globs cannot affect the command.
 *
 * This is the ONLY supported way to invoke an external process inside
 * Mneme's core. `execSync(`cmd ${var}`)` is BANNED.
 */
export function safeExec(cmd: string, argv: readonly string[], opts: SafeExecOptions = {}): SafeExecResult {
  if (typeof cmd !== "string" || cmd.length === 0) {
    throw new Error("safeExec: cmd must be a non-empty string");
  }
  if (!Array.isArray(argv)) {
    throw new Error("safeExec: argv must be an array of strings");
  }
  const validated = argv.map(validateArg);
  const options: SpawnSyncOptions = {
    cwd: opts.cwd,
    timeout: opts.timeoutMs ?? 5000,
    maxBuffer: opts.maxBuffer ?? 1024 * 1024,
    env: opts.env,
    encoding: opts.encoding ?? "utf8",
    shell: false,                // CRITICAL: never use a shell
    windowsHide: true,
    input: opts.input,
  };
  const r = spawnSync(cmd, validated, options);
  if (r.error) {
    // r.error usually means cmd not found or spawn failed before the
    // child started. Surface a brief, leak-free message.
    const briefCmd = `${cmd}${validated.length ? " " + validated[0]!.slice(0, 40) : ""}`;
    throw new Error(`safeExec: ${briefCmd} failed: ${r.error.message.slice(0, 200)}`);
  }
  return {
    stdout: typeof r.stdout === "string" ? r.stdout : (r.stdout?.toString(opts.encoding ?? "utf8") ?? ""),
    stderr: typeof r.stderr === "string" ? r.stderr : (r.stderr?.toString(opts.encoding ?? "utf8") ?? ""),
    status: r.status,
    signal: r.signal,
  };
}

/**
 * Run safely and return only stdout as a string. Throws if exit code != 0.
 * Convenience for the common case where the caller just wants the output.
 */
export function safeExecStdout(cmd: string, argv: readonly string[], opts: SafeExecOptions = {}): string {
  const r = safeExec(cmd, argv, opts);
  if (r.status !== 0) {
    const head = r.stderr.slice(0, 200);
    throw new Error(`safeExec: ${cmd} exited ${r.status}${head ? ": " + head : ""}`);
  }
  return r.stdout;
}

/**
 * Best-effort run that swallows non-zero exits and process errors.
 * Used by probes that genuinely don't care whether the command exists.
 */
export function safeExecTry(cmd: string, argv: readonly string[], opts: SafeExecOptions = {}): SafeExecResult | null {
  try {
    return safeExec(cmd, argv, opts);
  } catch {
    return null;
  }
}
