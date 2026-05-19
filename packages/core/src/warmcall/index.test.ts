/**
 * v2.19.70 — unit tests for WARM CALL frame + allowlist primitives.
 *
 *   Server-side end-to-end (daemon-spawn-and-warmcall) tests would
 *   need a live daemon process, which the vitest sandbox can't
 *   stand up reliably across platforms.  Those are covered by the
 *   Windows CI smoke gate (.github/workflows/windows-install-smoke.yml).
 *
 *   This file pins the pure-function primitives:
 *     - socket path is per-user, per-OS (no privilege escalation)
 *     - allowlist contains exactly the safe heads, no destructive ones
 *     - isWarmCallSafe refuses forbidden flags even on allowlisted heads
 *     - frame round-trip is lossless
 *     - parseFrames handles partial buffers + malformed lines safely
 */

import { describe, it, expect } from "vitest";
import {
  WARMCALL_ALLOWLIST,
  WARMCALL_PROTOCOL_VERSION,
  isWarmCallSafe,
  warmcallSocketPath,
  encodeFrame,
  parseFrames,
} from "./index.js";

describe("WARM CALL — protocol version", () => {
  it("PROTOCOL_VERSION is exposed + stable", () => {
    expect(WARMCALL_PROTOCOL_VERSION).toBe(1);
  });
});

describe("WARM CALL — socket path", () => {
  it("Windows uses named pipe, POSIX uses tmpdir UDS", () => {
    const p = warmcallSocketPath();
    if (process.platform === "win32") {
      expect(p).toMatch(/^\\\\\.\\pipe\\mneme-warmcall-/);
    } else {
      expect(p).toMatch(/mneme-warmcall-.+\.sock$/);
    }
  });

  it("path is per-user (no collision across users on the same machine)", () => {
    const p = warmcallSocketPath();
    // Path MUST contain SOMETHING that identifies the current user —
    // either a numeric uid or a sanitised username — so two users
    // running mneme on the same multi-user box never share a socket.
    expect(p).toMatch(/mneme-warmcall-[A-Za-z0-9_-]+/);
  });
});

describe("WARM CALL — allowlist invariants", () => {
  it("contains the read-only / pure-compute commands", () => {
    for (const head of ["welcome", "status", "verify", "ask", "why", "honesty", "phoenix"]) {
      expect(WARMCALL_ALLOWLIST.has(head), `${head} must be on allowlist`).toBe(true);
    }
  });

  it("does NOT contain destructive heads (daemon lifecycle, upgrade, init, index)", () => {
    for (const head of ["daemon", "upgrade", "init", "index", "mcp", "uninstall"]) {
      expect(WARMCALL_ALLOWLIST.has(head), `${head} MUST NOT be on allowlist`).toBe(false);
    }
  });

  it("isWarmCallSafe accepts safe argv vectors", () => {
    expect(isWarmCallSafe(["welcome"])).toBe(true);
    expect(isWarmCallSafe(["welcome", "--json", "{}"])).toBe(true);
    expect(isWarmCallSafe(["verify", "Mneme has 711 tools"])).toBe(true);
    expect(isWarmCallSafe(["system", "upgrade", "--json", '{"mode":"check"}'])).toBe(true);
    expect(isWarmCallSafe(["phoenix", "extract_status", "--json", "{}"])).toBe(true);
  });

  it("isWarmCallSafe rejects non-allowlisted heads", () => {
    expect(isWarmCallSafe(["daemon", "stop"])).toBe(false);
    expect(isWarmCallSafe(["upgrade"])).toBe(false);
    expect(isWarmCallSafe(["init"])).toBe(false);
    expect(isWarmCallSafe(["index", "--cap", "100"])).toBe(false);
  });

  it("isWarmCallSafe rejects empty argv", () => {
    expect(isWarmCallSafe([])).toBe(false);
  });

  it("isWarmCallSafe rejects forbidden flags even on allowlisted heads", () => {
    // `mneme welcome --install` would not actually do anything destructive,
    // but the defence-in-depth refuses any --install/--apply/--reset flag
    // appearing ANYWHERE in argv as a precaution.
    expect(isWarmCallSafe(["welcome", "--install"])).toBe(false);
    expect(isWarmCallSafe(["verify", "claim", "--apply"])).toBe(false);
    expect(isWarmCallSafe(["honesty", "audit", "--rotate"])).toBe(false);
    expect(isWarmCallSafe(["phoenix", "extract", "--reset"])).toBe(false);
  });
});

describe("WARM CALL — frame encode/decode", () => {
  it("encodes a run-frame as newline-delimited JSON", () => {
    const encoded = encodeFrame({
      v: 1,
      type: "run",
      cwd: "/tmp/x",
      argv: ["welcome", "--json", "{}"],
      env: { TERM: "xterm-256color" },
    });
    expect(encoded.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(encoded);
    expect(parsed.type).toBe("run");
    expect(parsed.argv).toEqual(["welcome", "--json", "{}"]);
  });

  it("encodes stdout / stderr / exit frames", () => {
    expect(JSON.parse(encodeFrame({ type: "stdout", data: "hello\n" }))).toEqual({ type: "stdout", data: "hello\n" });
    expect(JSON.parse(encodeFrame({ type: "stderr", data: "warn\n" }))).toEqual({ type: "stderr", data: "warn\n" });
    expect(JSON.parse(encodeFrame({ type: "exit", code: 0 }))).toEqual({ type: "exit", code: 0 });
  });
});

describe("WARM CALL — parseFrames", () => {
  it("parses multiple complete frames in one buffer", () => {
    const buf =
      JSON.stringify({ type: "stdout", data: "line 1\n" }) + "\n" +
      JSON.stringify({ type: "stdout", data: "line 2\n" }) + "\n" +
      JSON.stringify({ type: "exit", code: 0 }) + "\n";
    const { frames, rest } = parseFrames(buf);
    expect(frames.length).toBe(3);
    expect(frames[0]).toEqual({ type: "stdout", data: "line 1\n" });
    expect(frames[2]).toEqual({ type: "exit", code: 0 });
    expect(rest).toBe("");
  });

  it("returns partial trailing fragment in `rest` for the caller to buffer", () => {
    const buf =
      JSON.stringify({ type: "stdout", data: "complete\n" }) + "\n" +
      `{"type":"stdout","data":"partial`;
    const { frames, rest } = parseFrames(buf);
    expect(frames.length).toBe(1);
    expect(frames[0]).toEqual({ type: "stdout", data: "complete\n" });
    expect(rest).toBe(`{"type":"stdout","data":"partial`);
  });

  it("silently drops malformed JSON lines (best-effort protocol)", () => {
    const buf =
      `{this is not json}\n` +
      JSON.stringify({ type: "stdout", data: "ok\n" }) + "\n" +
      `another garbage line\n`;
    const { frames } = parseFrames(buf);
    // Only the valid middle line survives.
    expect(frames.length).toBe(1);
    expect(frames[0]).toEqual({ type: "stdout", data: "ok\n" });
  });

  it("ignores blank lines + whitespace", () => {
    const buf = "\n\n" + JSON.stringify({ type: "exit", code: 7 }) + "\n   \n";
    const { frames } = parseFrames(buf);
    expect(frames.length).toBe(1);
    expect(frames[0]).toEqual({ type: "exit", code: 7 });
  });
});
