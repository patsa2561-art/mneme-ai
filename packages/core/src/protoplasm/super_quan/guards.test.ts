/**
 * 🛡 Tests for HOMOGRAPH GUARD + INPUT SIZE GUARD
 *
 * Direct regression pin for the 2 v2.70 vulns user reported.
 */

import { describe, it, expect } from "vitest";
import { canonicalize, shouldReVerify } from "./homograph_guard.js";
import { checkInputSize, emitEnvelope, detectInputSource } from "./input_size_guard.js";

describe("🛡 HOMOGRAPH GUARD — Vuln #1 closure", () => {
  it("REGRESSION: '٢.70.0' (Arabic-Indic ٢) canonicalizes to '2.70.0'", () => {
    const r = canonicalize("Mneme is ٢.70.0");
    expect(r.canonical).toContain("2.70.0");
    expect(r.flags).toContain("homograph_detected");
    expect(r.digitsTransliterated).toBeGreaterThanOrEqual(1);
    expect(shouldReVerify(r)).toBe(true);
  });

  it("Thai digits ๒.๗๐.๐ → 2.70.0", () => {
    const r = canonicalize("version ๒.๗๐.๐");
    expect(r.canonical).toContain("2.70.0");
    expect(r.flags).toContain("homograph_detected");
  });

  it("Fullwidth digits ２.７０.０ → 2.70.0", () => {
    const r = canonicalize("see ２.７０.０ here");
    expect(r.canonical).toContain("2.70.0");
    expect(r.digitsTransliterated).toBeGreaterThanOrEqual(4);
  });

  it("Bengali digits ২.৭০.০ → 2.70.0", () => {
    const r = canonicalize("v ২.৭০.০");
    expect(r.canonical).toContain("2.70.0");
  });

  it("Math bold digits 𝟐.𝟕𝟎.𝟎 → 2.70.0", () => {
    const r = canonicalize("𝟐.𝟕𝟎.𝟎");
    expect(r.canonical).toContain("2.70.0");
  });

  it("Cyrillic 'а' (U+0430) → Latin 'a'", () => {
    const r = canonicalize("аpple");      // first char is Cyrillic
    expect(r.canonical).toBe("apple");
    expect(r.flags).toContain("homograph_detected");
    expect(r.confusablesReplaced).toBeGreaterThanOrEqual(1);
  });

  it("BIDI override (U+202E) detected and stripped", () => {
    const r = canonicalize("hello‮world");
    expect(r.flags).toContain("rtl_override");
    expect(r.canonical).toBe("helloworld");
  });

  it("Zero-width space stripped", () => {
    const r = canonicalize("hello​world");
    expect(r.flags).toContain("zwsp_injected");
    expect(r.canonical).toBe("helloworld");
  });

  it("Control chars stripped", () => {
    const r = canonicalize("hello\x00world\x07");
    expect(r.flags).toContain("control_char_injected");
    expect(r.canonical).toBe("helloworld");
  });

  it("Pure ASCII input passes unchanged (no flags)", () => {
    const r = canonicalize("Mneme is 2.70.0");
    expect(r.canonical).toBe("Mneme is 2.70.0");
    expect(r.flags.length).toBe(0);
    expect(shouldReVerify(r)).toBe(false);
  });

  it("Mixed-script Latin+Cyrillic flagged", () => {
    // Use a Cyrillic letter that's NOT in our confusable map so canonicalize
    // keeps it as Cyrillic → mixed script remains
    const r = canonicalize("hello Жорж");
    expect(r.flags).toContain("mixed_script");
  });

  it("All homograph defenses compose: BIDI + zwsp + Arabic-Indic together", () => {
    const r = canonicalize("‮v​٢.٧٠.٠\x00");
    expect(r.flags).toContain("rtl_override");
    expect(r.flags).toContain("zwsp_injected");
    expect(r.flags).toContain("control_char_injected");
    expect(r.flags).toContain("homograph_detected");
    expect(r.canonical).toContain("v2.70.0");
  });
});

describe("🛡 INPUT SIZE GUARD — Vuln #2 closure", () => {
  it("REGRESSION: 28K char argv input → rejected with JSON envelope (NOT silent)", () => {
    const big = "a".repeat(28_000);
    const r = checkInputSize(big, { source: "argv" });
    expect(r.ok).toBe(false);
    expect(r.envelope.error).toBe("INPUT_TOO_LARGE");
    expect(r.envelope.sizeReceived).toBe(28_000);
    expect(r.envelope.hint).toContain("stdin");
    expect(r.receipt).toContain("28000B");
  });

  it("Same 28K input via stdin → accepted (10MB limit)", () => {
    const big = "a".repeat(28_000);
    const r = checkInputSize(big, { source: "stdin" });
    expect(r.ok).toBe(true);
    expect(r.envelope.error).toBeUndefined();
  });

  it("--allow-truncate accepts oversized input + flags truncation", () => {
    const big = "x".repeat(50_000);
    const r = checkInputSize(big, { source: "argv", allowTruncate: true });
    expect(r.ok).toBe(true);
    expect(r.truncated).toBe(true);
    expect(r.truncatedAt).toBe(24_000);
    expect(r.envelope.hint).toContain("first");
  });

  it("emitEnvelope always writes JSON, returns appropriate exit code", () => {
    const collected: string[] = [];
    const big = "a".repeat(30_000);
    const r = checkInputSize(big, { source: "argv" });
    const exitCode = emitEnvelope(r, (s) => collected.push(s));
    expect(collected.length).toBe(1);
    const parsed = JSON.parse(collected[0]);
    expect(parsed.ok).toBe(false);
    expect(exitCode).toBe(2);          // distinct from generic crash exit 1
  });

  it("Small input via argv passes through", () => {
    const r = checkInputSize("hello world", { source: "argv" });
    expect(r.ok).toBe(true);
    expect(r.truncated).toBe(false);
    expect(r.envelope.ok).toBe(true);
  });

  it("Custom limit honored", () => {
    const r = checkInputSize("12345", { source: "argv", customLimit: 3 });
    expect(r.ok).toBe(false);
    expect(r.limit).toBe(3);
  });

  it("Receipt includes head + tail for tamper-evident size proof", () => {
    const r = checkInputSize("hello world this is a test input", { source: "argv" });
    expect(r.receipt).toContain("hello");
    expect(r.receipt).toMatch(/B head=/);
  });

  it("Envelope is a single-line JSON (safe for shell consumers)", () => {
    const big = "x".repeat(40_000);
    const r = checkInputSize(big, { source: "argv" });
    const lines: string[] = [];
    emitEnvelope(r, (s) => lines.push(s));
    expect(lines.length).toBe(1);
    expect(lines[0].endsWith("\n")).toBe(true);
    // No newlines inside JSON body
    expect(lines[0].slice(0, -1).split("\n").length).toBe(1);
  });

  it("detectInputSource returns a valid source", () => {
    const s = detectInputSource();
    expect(["argv", "stdin", "file", "unknown"]).toContain(s);
  });
});
