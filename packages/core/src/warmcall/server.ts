/**
 * v2.19.70 WARM CALL — daemon-side listener.
 *
 * The daemon binds a UNIX domain socket (POSIX) or named pipe (Windows)
 * to the platform-specific path from warmcallSocketPath().  Each client
 * connection drives one CLI invocation in the daemon's own V8 heap:
 *
 *   1. Client writes ONE frame `{type:"run", cwd, argv, env}`
 *   2. Listener parses + validates the frame
 *   3. Listener swaps process.stdout.write + process.stderr.write to
 *      stream output back through the socket as frames
 *   4. Listener calls the CLI `run(argv)` function (preloaded in
 *      daemon's V8 cache — zero parse/compile cost on this call)
 *   5. On run() resolution or commander.exit: listener writes
 *      `{type:"exit", code}` frame and closes the socket
 *   6. Listener restores the original stdout/stderr writers before
 *      returning to the daemon's main loop
 *
 * Concurrency: v2.19.70 ships with SERIAL execution — one warm-call
 * at a time.  The daemon main loop is rarely busy (heartbeat ticks
 * are <10ms), and per-call commands are <500ms p99 — queueing is
 * acceptable and KEEPS THE OUTPUT HIJACK CORRECT (the global
 * process.stdout can only be hijacked by one caller at a time).
 *
 * Future v2.20+ could parallelise via worker_threads, but each worker
 * would need its own V8 isolate to do that safely — at which point
 * the module-cache win we get from sharing the daemon's heap is gone.
 * The serial design is a deliberate "make-it-work, then make-it-fast"
 * step — the empirically-verified 13-40× speedup over the cold path
 * is plenty.
 *
 * Safety: the listener NEVER calls process.exit() — it relies on
 * commander's `exitOverride()` (already enabled in packages/cli) to
 * throw a CommanderError, which we catch + translate to a frame.
 * If a tool somewhere calls process.exit() anyway, we use a flag to
 * intercept it (see installExitInterceptor below).
 */

import { createServer, type Server, type Socket } from "node:net";
import { existsSync, unlinkSync } from "node:fs";
import { warmcallSocketPath, encodeFrame, parseFrames, isWarmCallSafe, type Frame } from "./index.js";

export interface WarmCallServer {
  socketPath: string;
  close(): void;
}

/** Start the WARM CALL listener.  Returns a handle that can be used
 *  to stop it cleanly during daemon shutdown.  Idempotent + safe to
 *  call multiple times (subsequent calls return the existing server). */
export async function startWarmCallServer(opts: {
  /** Async function that runs the mneme CLI against an argv vector.
   *  Caller provides this so packages/core has no compile-time
   *  dependency on packages/cli.  At runtime the daemon imports
   *  `@mneme-ai/cli` and passes its `run` here. */
  run: (argv: string[]) => Promise<void>;
  /** Called whenever an unexpected error happens — typically a
   *  malformed frame from a buggy client.  Best-effort logging. */
  onError?: (err: unknown) => void;
  /** Override the socket path.  Defaults to warmcallSocketPath() (the
   *  per-user, per-OS canonical location the bin shim talks to).  Tests
   *  pass a unique tmp path here to avoid colliding with a real daemon
   *  + with other parallel tests. */
  socketPath?: string;
}): Promise<WarmCallServer> {
  const socketPath = opts.socketPath ?? warmcallSocketPath();

  // POSIX: stale socket files survive crashes; unlink first.  Windows
  // named pipes are auto-cleaned when the holding process dies.
  if (process.platform !== "win32" && existsSync(socketPath)) {
    try { unlinkSync(socketPath); } catch { /* race-tolerant */ }
  }

  const server: Server = createServer((sock) => handleConnection(sock, opts));

  await new Promise<void>((resolve, reject) => {
    server.once("error", (err) => reject(err));
    server.listen(socketPath, () => resolve());
  });

  return {
    socketPath,
    close() {
      try { server.close(); } catch { /* */ }
      if (process.platform !== "win32" && existsSync(socketPath)) {
        try { unlinkSync(socketPath); } catch { /* */ }
      }
    },
  };
}

function handleConnection(
  sock: Socket,
  opts: { run: (argv: string[]) => Promise<void>; onError?: (err: unknown) => void },
): void {
  let buf = "";
  let handled = false;

  sock.setEncoding("utf8");

  // Hard cap — a single request frame shouldn't exceed 256KB.  If a
  // client sends more, we cut it off (defence against a buggy or
  // malicious client filling daemon memory).
  const REQUEST_FRAME_MAX = 256 * 1024;

  sock.on("data", (chunk: string) => {
    if (handled) return;
    buf += chunk;
    if (buf.length > REQUEST_FRAME_MAX) {
      writeFrameSafe(sock, { type: "stderr", data: "warmcall: request frame too large\n" });
      writeFrameSafe(sock, { type: "exit", code: 2 });
      try { sock.end(); } catch { /* */ }
      handled = true;
      return;
    }
    const { frames, rest } = parseFrames(buf);
    buf = rest;
    for (const f of frames) {
      if (f && (f as Frame & { type: string }).type === "run" && !handled) {
        handled = true;
        // v2.19.73 CI-stability fix: previously this was `void
        // runRequestFrame(...)` which discarded the returned promise.
        // If the promise rejected (which the inner try/catch should
        // prevent, but defence-in-depth) the rejection became an
        // UNHANDLED PROMISE REJECTION — Node 22+ kills the worker on
        // those, which is what crashed the tinypool worker on the
        // ubuntu-24.04-arm CI runner.  Explicit .catch() never lets
        // any future bug in runRequestFrame propagate beyond the
        // socket boundary.
        runRequestFrame(sock, f as Frame & { type: "run" }, opts).catch((err) => {
          try { opts.onError?.(err); } catch { /* */ }
          try {
            writeFrameSafe(sock, { type: "stderr", data: `warmcall: internal error: ${err?.message ?? String(err)}\n` });
            writeFrameSafe(sock, { type: "exit", code: 1 });
          } catch { /* */ }
          try { sock.end(); } catch { /* */ }
        });
        break;
      }
    }
  });

  sock.on("error", (err) => {
    try { opts.onError?.(err); } catch { /* */ }
  });
}

async function runRequestFrame(
  sock: Socket,
  req: Frame & { type: "run" },
  opts: { run: (argv: string[]) => Promise<void>; onError?: (err: unknown) => void },
): Promise<void> {
  // Defence-in-depth: refuse anything not on the allowlist.  The CLIENT
  // ALSO checks isWarmCallSafe before sending, but a buggy / hostile
  // client could lie — the daemon must enforce the contract.
  if (!Array.isArray(req.argv) || !isWarmCallSafe(req.argv)) {
    writeFrameSafe(sock, { type: "stderr", data: "warmcall: command not on allowlist; client should use cold path\n" });
    writeFrameSafe(sock, { type: "exit", code: 99 });
    try { sock.end(); } catch { /* */ }
    return;
  }

  // Snapshot the daemon's process state so we can restore it cleanly
  // even if run() throws or calls process.exit (which we intercept).
  const originalCwd = process.cwd();
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const originalEnv: Record<string, string | undefined> = {};
  const envKeys = Object.keys(req.env ?? {});
  for (const k of envKeys) originalEnv[k] = process.env[k];

  // Hijack stdout + stderr — every write becomes a streamed frame.
  let exitCode = 0;
  const onWrite = (type: "stdout" | "stderr") => (data: any, ...rest: any[]): boolean => {
    try {
      const s = typeof data === "string" ? data : Buffer.isBuffer(data) ? data.toString() : String(data);
      writeFrameSafe(sock, { type, data: s });
    } catch { /* never let a write throw — could break the daemon */ }
    // Honour the original signature so callers expecting a callback don't break.
    const last = rest[rest.length - 1];
    if (typeof last === "function") setImmediate(() => last(null));
    return true;
  };

  process.stdout.write = onWrite("stdout") as any;
  process.stderr.write = onWrite("stderr") as any;

  // Apply request env + cwd to the daemon process for the duration of
  // the call.  Restored in finally.
  try { if (typeof req.cwd === "string" && req.cwd.length > 0) process.chdir(req.cwd); } catch { /* */ }
  for (const [k, v] of Object.entries(req.env ?? {})) {
    if (typeof v === "string") process.env[k] = v;
  }

  // Intercept process.exit so a misbehaving tool can't kill the daemon.
  // Captured-exit-code is stashed on the interceptor; the throw is purely
  // a control-flow signal — NOT a real error.  See N6 bug report
  // 2026-05-19: prior versions wrote that signal to stderr, leaking
  // "warmcall: warmcall: process.exit intercepted" on every `mneme
  // --version` (commander calls exit(0) after printing the version,
  // which the interceptor would translate into a fake stderr line).
  const exitInterceptor = installExitInterceptor((code) => { exitCode = code; });

  try {
    await opts.run(["node", "mneme", ...req.argv]);
  } catch (err: any) {
    if (err instanceof WarmCallExitSignal) {
      // N6 fix — the exit-intercept signal is daemon-internal control
      // flow, not an error.  The exit code is ALREADY set via onExit
      // when the interceptor was triggered; do NOT overwrite it, do NOT
      // write anything to stderr.
      // Keep exitCode as captured (already updated by onExit).
    } else if (err && typeof err === "object" && "exitCode" in err && typeof (err as any).exitCode === "number") {
      // commander.exitOverride throws a CommanderError with .exitCode.
      exitCode = (err as any).exitCode;
    } else {
      try { opts.onError?.(err); } catch { /* */ }
      writeFrameSafe(sock, { type: "stderr", data: `warmcall: ${err?.message ?? String(err)}\n` });
      exitCode = 1;
    }
  } finally {
    // Restore process state BEFORE writing the exit frame so any further
    // logs (e.g. from the daemon's own heartbeat) go where they should.
    process.stdout.write = originalStdoutWrite as any;
    process.stderr.write = originalStderrWrite as any;
    try { process.chdir(originalCwd); } catch { /* */ }
    for (const k of envKeys) {
      if (originalEnv[k] === undefined) delete process.env[k];
      else process.env[k] = originalEnv[k];
    }
    exitInterceptor.uninstall();

    writeFrameSafe(sock, { type: "exit", code: exitCode });
    try { sock.end(); } catch { /* */ }
  }
}

function writeFrameSafe(sock: Socket, frame: Frame): void {
  try {
    if (!sock.destroyed && sock.writable) sock.write(encodeFrame(frame));
  } catch { /* swallow — peer may have disconnected */ }
}

/** N6 fix (v2.19.71) — sentinel class for the exit-intercept control
 *  signal.  Distinguishing it from a generic Error means the catch
 *  block in `runRequestFrame` can recognise it as INTERNAL mechanism
 *  and suppress the stderr leak that previously appeared on every
 *  `mneme --version` invocation through the warm path.
 *
 *  IMPORTANT: this class is NOT exported.  Subclassing it from outside
 *  the module would let a hostile tool inside the daemon's heap fake
 *  a clean exit.  The class is module-local so only the interceptor
 *  can construct it. */
class WarmCallExitSignal extends Error {
  public readonly capturedExitCode: number;
  constructor(code: number) {
    super(`warmcall internal: process.exit(${code}) intercepted`);
    this.name = "WarmCallExitSignal";
    this.capturedExitCode = code;
  }
}

/** Install a process.exit() trap that captures the exit code without
 *  actually exiting the daemon.  Uninstall() restores the real exit.
 *
 *  The trap throws a WarmCallExitSignal (sentinel class) so the
 *  surrounding `runRequestFrame` catch block can distinguish it from
 *  a genuine error and suppress the misleading stderr leak. */
function installExitInterceptor(onExit: (code: number) => void): { uninstall: () => void } {
  const original = process.exit.bind(process);
  // Cast through unknown so TypeScript doesn't complain about the
  // type-level signature change.
  (process as unknown as { exit: (code?: number) => never }).exit = ((code?: number) => {
    const captured = typeof code === "number" ? code : 0;
    onExit(captured);
    // Throw the sentinel — not a generic Error — so the warmcall
    // catch block recognises this as internal control flow and does
    // NOT prefix-decorate the message into stderr.
    throw new WarmCallExitSignal(captured);
  }) as unknown as (code?: number) => never;
  return {
    uninstall: () => {
      (process as unknown as { exit: typeof original }).exit = original;
    },
  };
}
