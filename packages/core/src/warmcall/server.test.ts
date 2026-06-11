/**
 * v2.19.71 — server-side WARM CALL tests focused on the N6 stderr-leak
 *            bug class.
 *
 *   N6 (user-reported 2026-05-19): every `mneme --version` invocation
 *   through the WARM CALL path emitted a phantom stderr line:
 *
 *     $ mneme --version
 *     2.19.69
 *     warmcall: warmcall: process.exit intercepted
 *
 *   Root cause: the exit-interceptor threw a generic Error whose
 *   `.message` started with "warmcall:".  The catch block in
 *   runRequestFrame then re-prefixed it as `warmcall: <message>` and
 *   piped that to the client as a stderr frame.  Worst case: also
 *   overwrote the captured exit code (0 for `--version`) with 1.
 *
 *   v2.19.71 introduces a private sentinel class `WarmCallExitSignal`,
 *   thrown by the interceptor and matched by `instanceof` in the catch.
 *   The catch swallows the sentinel (it's daemon-internal control flow,
 *   not an error) and preserves the exit code captured by `onExit`.
 *
 *   The tests below spin up a REAL server on a per-test temp socket,
 *   talk to it with a real socket client, and assert:
 *     1. `process.exit(0)` from the run() body → exit frame {code:0},
 *        ZERO stderr frames
 *     2. `process.exit(7)` from the run() body → exit frame {code:7},
 *        ZERO stderr frames
 *     3. commander-style throw (`{exitCode: 2}`) → exit frame {code:2},
 *        ZERO stderr frames
 *     4. genuine throw (`throw new Error("boom")`) → exit frame {code:1},
 *        EXACTLY ONE stderr frame matching /warmcall: boom\n/
 *     5. stdout writes from the run() body → exit frame {code:0},
 *        ZERO stderr frames (the success path)
 *     6. allowlist refusal (non-allowlisted argv) → exit frame {code:99},
 *        ONE stderr frame with the refusal message
 *
 *   Test #4 verifies the bug class FOR genuine errors is NOT regressed
 *   — we still want stderr noise when something real goes wrong.
 *   Tests #1-3+5 verify the N6 bug class is extinct for the internal
 *   exit-intercept mechanism (the "control flow that should be quiet").
 */

import { describe, it, expect, afterEach, beforeAll, afterAll } from "vitest";
import { createConnection, Socket } from "node:net";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startWarmCallServer, type WarmCallServer } from "./server.js";
import type { Frame } from "./index.js";

/** Per-test unique socket path so we don't collide with a real
 *  daemon running on the dev machine + don't collide with other
 *  parallel vitest workers.  Windows named-pipes have no fs
 *  presence so unique pipe names work the same way. */
function uniqueTestSocketPath(): string {
  const tag = `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return process.platform === "win32"
    ? `\\\\.\\pipe\\mneme-warmcall-test-${tag}`
    : join(tmpdir(), `mneme-warmcall-test-${tag}.sock`);
}

/** Collect every frame a client receives from the server, resolving
 *  once the daemon closes the socket. */
async function callWarmCallServer(
  server: WarmCallServer,
  argv: string[],
): Promise<{ frames: Frame[]; closed: boolean }> {
  return new Promise<{ frames: Frame[]; closed: boolean }>((resolve, reject) => {
    const client: Socket = createConnection(server.socketPath);
    let buf = "";
    const frames: Frame[] = [];
    let resolved = false;

    const settle = (closed: boolean) => {
      if (resolved) return;
      resolved = true;
      try { client.destroy(); } catch { /* */ }
      resolve({ frames, closed });
    };

    const timer = setTimeout(() => {
      if (!resolved) reject(new Error("warmcall test: server did not respond within 5s"));
    }, 5000);

    client.setEncoding("utf8");
    client.on("connect", () => {
      client.write(
        JSON.stringify({ v: 1, type: "run", cwd: process.cwd(), argv, env: {} }) + "\n",
      );
    });
    client.on("data", (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        try { frames.push(JSON.parse(line) as Frame); }
        catch { /* drop garbage */ }
      }
    });
    client.on("end", () => { clearTimeout(timer); settle(true); });
    client.on("close", () => { clearTimeout(timer); settle(true); });
    client.on("error", (err) => {
      clearTimeout(timer);
      if (!resolved) reject(err);
    });
  });
}

function stdoutFrames(frames: Frame[]): string[] {
  return frames.filter((f) => (f as any).type === "stdout").map((f) => (f as any).data as string);
}
function stderrFrames(frames: Frame[]): string[] {
  return frames.filter((f) => (f as any).type === "stderr").map((f) => (f as any).data as string);
}
function exitFrame(frames: Frame[]): { type: "exit"; code: number } | null {
  const last = frames[frames.length - 1];
  if (last && (last as any).type === "exit") return last as { type: "exit"; code: number };
  return null;
}

describe("WARM CALL — server end-to-end (N6 stderr-leak suite)", () => {
  let activeServer: WarmCallServer | null = null;

  afterEach(async () => {
    if (activeServer) {
      const path = activeServer.socketPath;
      try { activeServer.close(); } catch { /* */ }
      // v2.19.73 CI-stability fix — give libuv a tick to drain any
      // half-closed sockets before the next test binds.  Without this,
      // an in-flight `sock.end()` from the previous test could still
      // hold the FD on slow ARM CI runners, which previously caused
      // the tinypool worker to receive an unhandled close event +
      // exit unexpectedly.
      await new Promise<void>((r) => setImmediate(r));
      if (process.platform !== "win32" && existsSync(path)) {
        try { unlinkSync(path); } catch { /* */ }
      }
      activeServer = null;
    }
  });

  // v2.19.73 CI-stability — keep any stray unhandled promise rejection
  // contained to the test that produced it instead of killing the
  // tinypool worker process (which would tank the entire vitest run).
  // The rejection handler is installed once + restored after the
  // suite to avoid leaking it into other test files.
  let __origUnhandledRejection: NodeJS.UnhandledRejectionListener[] = [];
  beforeAll(() => {
    __origUnhandledRejection = process.listeners("unhandledRejection").slice();
    process.removeAllListeners("unhandledRejection");
    process.on("unhandledRejection", () => { /* swallow during warmcall tests */ });
  });
  afterAll(() => {
    process.removeAllListeners("unhandledRejection");
    for (const l of __origUnhandledRejection) process.on("unhandledRejection", l);
  });

  it("process.exit(0) inside run() → exit code 0 + ZERO stderr frames (the headline N6 fix)", async () => {
    activeServer = await startWarmCallServer({
      socketPath: uniqueTestSocketPath(),
      run: async () => {
        // Simulate commander.exitOverride.  Commander prints something
        // first, then calls process.exit(0).  Our interceptor throws a
        // WarmCallExitSignal which the catch block must SWALLOW.
        process.stdout.write("2.19.71\n");
        (process.exit as (code?: number) => never)(0);
      },
    });
    const { frames } = await callWarmCallServer(activeServer, ["welcome"]);
    expect(exitFrame(frames)?.code, `frames: ${JSON.stringify(frames)}`).toBe(0);
    expect(stdoutFrames(frames).join("")).toContain("2.19.71");
    expect(stderrFrames(frames), "N6 invariant: stderr MUST be empty on intercepted exit").toEqual([]);
  });

  it("process.exit(7) inside run() → exit code 7 preserved + ZERO stderr frames", async () => {
    activeServer = await startWarmCallServer({
      socketPath: uniqueTestSocketPath(),
      run: async () => {
        (process.exit as (code?: number) => never)(7);
      },
    });
    const { frames } = await callWarmCallServer(activeServer, ["welcome"]);
    expect(exitFrame(frames)?.code).toBe(7);
    expect(stderrFrames(frames)).toEqual([]);
  });

  it("commander-style {exitCode: 2} throw → exit code 2 + ZERO stderr frames", async () => {
    activeServer = await startWarmCallServer({
      socketPath: uniqueTestSocketPath(),
      run: async () => {
        // commander.exitOverride throws a CommanderError instance with
        // `.exitCode` — we treat that exactly like an intercepted exit.
        const err = new Error("(outputHelp)") as Error & { exitCode: number };
        err.exitCode = 2;
        throw err;
      },
    });
    const { frames } = await callWarmCallServer(activeServer, ["welcome"]);
    expect(exitFrame(frames)?.code).toBe(2);
    expect(stderrFrames(frames)).toEqual([]);
  });

  it("genuine throw → exit code 1 + EXACTLY ONE stderr frame with `warmcall: ` prefix (not regressed)", async () => {
    activeServer = await startWarmCallServer({
      socketPath: uniqueTestSocketPath(),
      run: async () => { throw new Error("boom"); },
    });
    const { frames } = await callWarmCallServer(activeServer, ["welcome"]);
    expect(exitFrame(frames)?.code).toBe(1);
    const stderr = stderrFrames(frames);
    expect(stderr.length).toBe(1);
    // The genuine-error path MUST still report through stderr — that's
    // what users expect when something actually breaks.  Exactly one
    // `warmcall: ` prefix (not double-prefixed like the N6 bug).
    expect(stderr[0]).toBe("warmcall: boom\n");
  });

  it("success path with stdout writes → exit code 0 + ZERO stderr frames", async () => {
    activeServer = await startWarmCallServer({
      socketPath: uniqueTestSocketPath(),
      run: async () => {
        process.stdout.write('{"v":1,"data":"ok"}\n');
      },
    });
    const { frames } = await callWarmCallServer(activeServer, ["welcome"]);
    expect(exitFrame(frames)?.code).toBe(0);
    expect(stdoutFrames(frames).join("")).toBe('{"v":1,"data":"ok"}\n');
    expect(stderrFrames(frames)).toEqual([]);
  });

  it("argv not on allowlist → exit code 99 + ONE refusal stderr frame", async () => {
    let runCalled = false;
    activeServer = await startWarmCallServer({
      socketPath: uniqueTestSocketPath(),
      run: async () => { runCalled = true; },
    });
    const { frames } = await callWarmCallServer(activeServer, ["upgrade"]); // NOT on allowlist
    expect(runCalled, "server MUST refuse non-allowlisted commands before invoking run()").toBe(false);
    expect(exitFrame(frames)?.code).toBe(99);
    expect(stderrFrames(frames).length).toBe(1);
    expect(stderrFrames(frames)[0]).toMatch(/not on allowlist/);
  });

  it("a command that prints then process.exit(0) → exit code 0 + clean stdout + ZERO stderr", async () => {
    // The N6 server contract: a `run` callback that prints then calls
    // process.exit(0) must yield exit 0 + the stdout, and leak NOTHING to
    // stderr (pre-N6 this leaked "warmcall: process.exit intercepted").
    // NOTE: uses `status` (a warm-callable command) — `--version` is
    // deliberately NOT warm-callable anymore (it must reflect the running
    // bin's own package.json, never a stale daemon), but the server's
    // exit-interception contract is identical for any command.
    activeServer = await startWarmCallServer({
      socketPath: uniqueTestSocketPath(),
      run: async () => {
        process.stdout.write("2.19.71\n");
        (process.exit as (code?: number) => never)(0);
      },
    });
    const { frames } = await callWarmCallServer(activeServer, ["status"]);
    expect(exitFrame(frames)?.code).toBe(0);
    expect(stdoutFrames(frames).join("").trim()).toBe("2.19.71");
    expect(stderrFrames(frames)).toEqual([]);
  });

  it("version queries are NOT warm-callable — they must reflect the running bin, never a stale daemon", async () => {
    const { isWarmCallSafe } = await import("./index.js");
    expect(isWarmCallSafe(["--version"])).toBe(false);
    expect(isWarmCallSafe(["-V"])).toBe(false);
    expect(isWarmCallSafe(["version"])).toBe(false);
    expect(isWarmCallSafe(["status"])).toBe(true);   // still warm-callable
  });
});
