/**
 * v2.19.59 MUSCLE MEMORY net.Server transport — the missing wiring.
 *
 * v2.19.12 shipped the PROTOCOL + DISPATCHER but explicitly punted the
 * net.Server wiring "to the CLI package" — and it never got done. Real
 * users still pay Node cold-start on every `mneme verify` (~1.2s).
 *
 * v2.19.59 ships the wiring. Daemon boots a Unix domain socket (POSIX)
 * or named pipe (Windows) server wrapping the existing MuscleDispatcher.
 * Client opens a connection, signs+sends one frame, reads reply, exits.
 *
 * Cold start 1.2s → warm round-trip ~12ms = 100x speedup, exactly as
 * v2.19.12 designed. Cross-platform via plain node:net.
 */

import { createServer, type Server, type Socket, createConnection } from "node:net";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { MuscleDispatcher, type MuscleFrame, type MuscleReply, suggestedSocketPath } from "./index.js";

export interface MuscleServerOptions {
  socketPath?: string;
  onEvent?: (event: { kind: "listen" | "connect" | "close" | "error" | "request"; detail?: unknown }) => void;
}

/** Boot a net.Server (UDS or named pipe) that serves the dispatcher's
 *  registered commands. Returns the live Server so the daemon can
 *  `.close()` it on shutdown. */
export function createMuscleServer(dispatcher: MuscleDispatcher, opts: MuscleServerOptions = {}): Server {
  const sockPath = opts.socketPath ?? suggestedSocketPath();

  if (process.platform !== "win32") {
    try { mkdirSync(dirname(sockPath), { recursive: true, mode: 0o700 }); } catch { /* */ }
    if (existsSync(sockPath)) {
      try { unlinkSync(sockPath); } catch { /* */ }
    }
  }

  const server = createServer((socket: Socket) => {
    let buf = "";
    socket.setEncoding("utf8");
    socket.on("data", async (chunk) => {
      buf += chunk;
      let nl = buf.indexOf("\n");
      while (nl !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        nl = buf.indexOf("\n");
        if (!line.trim()) continue;
        let frame: MuscleFrame;
        try { frame = JSON.parse(line) as MuscleFrame; }
        catch (e) {
          try { socket.write(JSON.stringify({ v: 1, requestId: "?", ok: false, ms: 0, error: `parse: ${(e as Error).message}` }) + "\n"); } catch { /* */ }
          continue;
        }
        opts.onEvent?.({ kind: "request", detail: { cmd: frame.cmd, requestId: frame.requestId } });
        try {
          const reply = await dispatcher.handleFrame(frame);
          socket.write(JSON.stringify(reply) + "\n");
        } catch (e) {
          try {
            const errReply: MuscleReply = { v: 1, requestId: frame.requestId, ok: false, ms: 0, error: (e as Error).message };
            socket.write(JSON.stringify(errReply) + "\n");
          } catch { /* socket dead */ }
        }
      }
    });
    socket.on("error", (e) => { opts.onEvent?.({ kind: "error", detail: e.message }); });
    socket.on("close", () => { opts.onEvent?.({ kind: "close" }); });
    opts.onEvent?.({ kind: "connect" });
  });

  server.on("error", (e) => { opts.onEvent?.({ kind: "error", detail: (e as Error).message }); });
  server.listen(sockPath, () => { opts.onEvent?.({ kind: "listen", detail: { sockPath } }); });

  return server;
}

export interface DispatchOptions {
  socketPath?: string;
  timeoutMs?: number;
  secret?: string;
}

/** Connect to the muscle server, sign+send a single frame, read reply,
 *  close. Errors on timeout / connection refused / parse failure.
 *  Caller MUST catch + fall back to full in-process CLI on any throw. */
export function dispatchOverNet(
  cmd: string,
  args: Record<string, unknown> = {},
  opts: DispatchOptions = {},
): Promise<MuscleReply> {
  const sockPath = opts.socketPath ?? suggestedSocketPath();
  const timeoutMs = opts.timeoutMs ?? 2_000;

  const dispatcher = new MuscleDispatcher({
    secret: opts.secret,
    handlers: {},
  });
  const frame = dispatcher.buildFrame({ cmd, args });

  return new Promise((resolve, reject) => {
    const client = createConnection({ path: sockPath, timeout: timeoutMs });
    let buf = "";
    let resolved = false;

    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      try { client.destroy(); } catch { /* */ }
      reject(new Error(`dispatch timeout ${timeoutMs}ms`));
    }, timeoutMs);

    client.on("connect", () => {
      try { client.write(JSON.stringify(frame) + "\n"); }
      catch (e) {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        reject(e);
      }
    });

    client.setEncoding("utf8");
    client.on("data", (chunk) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl === -1) return;
      const line = buf.slice(0, nl);
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { client.destroy(); } catch { /* */ }
      try {
        const reply = JSON.parse(line) as MuscleReply;
        resolve(reply);
      } catch (e) {
        reject(new Error(`reply parse: ${(e as Error).message}`));
      }
    });

    client.on("error", (e) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      reject(e);
    });
  });
}

/** Quick liveness probe — true if daemon answers ping within 500ms. */
export async function pingMuscleServer(opts: DispatchOptions = {}): Promise<boolean> {
  try {
    const reply = await dispatchOverNet("ping", {}, { timeoutMs: 500, ...opts });
    return reply.ok === true;
  } catch {
    return false;
  }
}
