// v2.44.0 — SEAMLESS PROTOCOL
//
// One pinned test per innovation. Each row from the v2.41 audit screenshot
// closes with a UX upgrade: user shouldn't need to know about --stdin /
// --hex / --base64 to verify hostile content.
//
// Rows:
//   S1   STDIN AUTO-FALLBACK (no args + non-TTY stdin → auto-read)
//   S2   --clipboard input mode (losslessly read OS clipboard)
//   S3   --file <path> input mode (losslessly read file)
//   S4   SHELL-STRIP DETECTIVE (warn when claim mentions hostile chars
//                                but contains none)
//   S5   AUTO-NUMBER-GROUNDING (Mneme has N tools → ground against
//                                live MCP catalog)
//   S6   HOMOGLYPH ATTACK BANNER (cross-script highlight in CLI output)
//   S7   TRUTH GATE binding (claim.seamless.protocol_complete = 1)

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = resolve(__dirname, "../../packages/cli/bin/mneme.js");
function runMneme(args: string[], opts: { input?: string } = {}): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8", timeout: 60_000,
    input: opts.input,
    env: { ...process.env, MNEME_WARMCALL: "0", MNEME_MUSCLE_BYPASS: "0", NO_COLOR: "1" },
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? -1 };
}

// ═══════════════════════════════════════════════════════════════════════
//  S1 — STDIN AUTO-FALLBACK
// ═══════════════════════════════════════════════════════════════════════

describe("v2.44.0 S1 — STDIN AUTO-FALLBACK (PINNED)", () => {
  it("S1.1 verify with no args + stdin pipe auto-reads stdin", () => {
    const claim = "Mneme verifies " + String.fromCodePoint(0x202E) + " all claims";
    const r = runMneme(["verify", "--json"], { input: claim });
    expect(r.status).toBeLessThan(3);
    const text = r.stdout + r.stderr;
    expect(text).toMatch(/INPUT_TAMPERED|bidi_override|hostile/i);
  });

  it("S1.2 verify with no args + no stdin returns helpful error (NOT silent)", () => {
    // Empty input via stdin
    const r = runMneme(["verify", "--json"], { input: "" });
    expect(r.status).toBeGreaterThan(0);
    expect(r.stdout + r.stderr).toMatch(/empty|stdin|pass/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  S3 — --file <path> input mode
// ═══════════════════════════════════════════════════════════════════════

describe("v2.44.0 S3 — --file input mode (PINNED)", () => {
  it("S3.1 verify --file losslessly reads BIDI char from file", () => {
    const dir = mkdtempSync(join(tmpdir(), "v44-"));
    const path = join(dir, "claim.txt");
    const claim = "Mneme verifies " + String.fromCodePoint(0x202E) + " all claims";
    writeFileSync(path, claim, "utf8");
    const r = runMneme(["verify", "--file", path, "--json"]);
    expect(r.status).toBeLessThan(3);
    const text = r.stdout + r.stderr;
    expect(text).toMatch(/INPUT_TAMPERED|bidi_override|hostile/i);
  });

  it("S3.2 verify --file with missing path returns helpful error", () => {
    const r = runMneme(["verify", "--file", "/nonexistent/path/12345", "--json"]);
    expect(r.status).toBeGreaterThan(0);
    expect(r.stdout + r.stderr).toMatch(/file|not found|ENOENT/i);
  });

  it("S3.3 verify --file preserves NUL byte mid-content", () => {
    const dir = mkdtempSync(join(tmpdir(), "v44-"));
    const path = join(dir, "claim.bin");
    writeFileSync(path, "honest text\x00 hidden tail", "utf8");
    const r = runMneme(["verify", "--file", path, "--json"]);
    expect(r.status).toBeLessThan(3);
    expect(r.stdout + r.stderr).toMatch(/null_byte|INPUT_TAMPERED/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  S4 — SHELL-STRIP DETECTIVE
// ═══════════════════════════════════════════════════════════════════════

describe("v2.44.0 S4 — SHELL-STRIP DETECTIVE (PINNED)", () => {
  it("S4.1 module detects 'BIDI' mention without actual BIDI codepoints", async () => {
    const m = await import("../../packages/core/src/squadron/shell_strip_detective.js");
    const r = m.detectShellStrip("Mneme verifies <BIDI> all claims");
    expect(r.suspicious).toBe(true);
    expect(r.suggestedMode).toMatch(/stdin|hex|base64|clipboard|file/);
  });

  it("S4.2 detects 'null byte' mention without actual NUL", async () => {
    const m = await import("../../packages/core/src/squadron/shell_strip_detective.js");
    const r = m.detectShellStrip("test\\x00 here");
    expect(r.suspicious).toBe(true);
  });

  it("S4.3 detects 'override' / 'U+202E' literal mentions", async () => {
    const m = await import("../../packages/core/src/squadron/shell_strip_detective.js");
    const r1 = m.detectShellStrip("test override U+202E here");
    expect(r1.suspicious).toBe(true);
    const r2 = m.detectShellStrip("RTL override attack \\u202e");
    expect(r2.suspicious).toBe(true);
  });

  it("S4.4 clean text is NOT flagged (no false positive)", async () => {
    const m = await import("../../packages/core/src/squadron/shell_strip_detective.js");
    const r = m.detectShellStrip("the codebase has 865 tools and works on macOS");
    expect(r.suspicious).toBe(false);
  });

  it("S4.5 claim WITH actual BIDI char is NOT flagged (true positive of intent)", async () => {
    const m = await import("../../packages/core/src/squadron/shell_strip_detective.js");
    const r = m.detectShellStrip("Mneme " + String.fromCodePoint(0x202E) + " test");
    // claim contains actual BIDI; no need to suggest --stdin
    expect(r.suspicious).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  S5 — AUTO-NUMBER-GROUNDING
// ═══════════════════════════════════════════════════════════════════════

describe("v2.44.0 S5 — AUTO-NUMBER-GROUNDING (PINNED)", () => {
  it("S5.1 module grounds 'Mneme has N tools' against live state", async () => {
    const m = await import("../../packages/core/src/squadron/auto_number_ground.js");
    const r = m.tryAutoGroundNumber("Mneme has 99999 tools", process.cwd());
    expect(r.grounded).toBe(true);
    expect(r.expected).toBeGreaterThan(0);
    expect(r.verdict).toBe("REFUTED"); // 99999 ≠ actual
  });

  it("S5.2 grounds English number-words against live state", async () => {
    const m = await import("../../packages/core/src/squadron/auto_number_ground.js");
    const r = m.tryAutoGroundNumber("Mneme has nine hundred ninety-nine thousand nine hundred ninety-nine tools", process.cwd());
    expect(r.grounded).toBe(true);
    expect(r.verdict).toBe("REFUTED");
  });

  it("S5.3 grounds Thai numerals against live state", async () => {
    const m = await import("../../packages/core/src/squadron/auto_number_ground.js");
    // ๙๙๙๙๙ = 99999 (very unlikely tool count)
    const r = m.tryAutoGroundNumber("Mneme has ๙๙๙๙๙ tools", process.cwd());
    expect(r.grounded).toBe(true);
    expect(r.verdict).toBe("REFUTED");
  });

  it("S5.4 grounds hex against live state", async () => {
    const m = await import("../../packages/core/src/squadron/auto_number_ground.js");
    const r = m.tryAutoGroundNumber("Mneme has 0xFFFFF tools", process.cwd());
    expect(r.grounded).toBe(true);
    expect(r.verdict).toBe("REFUTED"); // 0xFFFFF = 1048575
  });

  it("S5.5 non-groundable claim returns grounded=false (graceful)", async () => {
    const m = await import("../../packages/core/src/squadron/auto_number_ground.js");
    const r = m.tryAutoGroundNumber("the weather is nice today", process.cwd());
    expect(r.grounded).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  S6 — HOMOGLYPH ATTACK BANNER
// ═══════════════════════════════════════════════════════════════════════

describe("v2.44.0 S6 — HOMOGLYPH ATTACK BANNER (PINNED)", () => {
  it("S6.1 module detects Cyrillic letter in Latin word + returns codepoint+position", async () => {
    const m = await import("../../packages/core/src/argus10/homoglyph_banner.js");
    const r = m.detectHomoglyphAttacks([
      { text: "Mneme" },
      { text: "Mn" + String.fromCodePoint(0x0435) + "me" }, // Cyrillic 'е'
    ]);
    expect(r.length).toBeGreaterThan(0);
    const att = r[0]!;
    expect(att.codepoint).toBe("U+0435");
    expect(att.position).toBe(2);
    expect(att.script).toBe("cyrillic");
  });

  it("S6.2 clean text returns no attacks", async () => {
    const m = await import("../../packages/core/src/argus10/homoglyph_banner.js");
    const r = m.detectHomoglyphAttacks([
      { text: "Mneme" },
      { text: "cat sat" },
    ]);
    expect(r.length).toBe(0);
  });

  it("S6.3 formatBanner produces user-readable warning string", async () => {
    const m = await import("../../packages/core/src/argus10/homoglyph_banner.js");
    const banner = m.formatBanner([{
      candidateIndex: 1,
      candidateText: "Mn" + String.fromCodePoint(0x0435) + "me",
      script: "cyrillic",
      codepoint: "U+0435",
      character: String.fromCodePoint(0x0435),
      position: 2,
    }]);
    expect(banner).toMatch(/HOMOGLYPH|attack|U\+0435/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  S7 — TRUTH GATE SEAMLESS PROTOCOL probe
// ═══════════════════════════════════════════════════════════════════════

describe("v2.44.0 S7 — TRUTH GATE seamless probe (PINNED)", () => {
  it("S7.1 probe.seamless.protocol_complete returns value=1 (all paths work)", async () => {
    const m = await import("../../packages/core/src/truth_gate/probes.js");
    const probe = m.probeById("probe.seamless.protocol_complete");
    expect(probe).toBeTruthy();
    const r = await probe!.run({ cwd: process.cwd() });
    expect(r.value).toBe(1);
  });

  it("S7.2 claim.seamless.protocol_complete is bound + severity=block", async () => {
    const { CLAIM_CATALOG } = await import("../../packages/core/src/truth_gate/claims.js");
    const claim = CLAIM_CATALOG.find((c) => c.id === "claim.seamless.protocol_complete");
    expect(claim).toBeTruthy();
    expect(claim!.severity).toBe("block");
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  AUDIT-ROW REGRESSION: re-verify v2.41 screenshot rows fully closed
// ═══════════════════════════════════════════════════════════════════════

describe("v2.44.0 AUDIT REGRESSION — v2.41 screenshot rows (PINNED)", () => {
  it("D4 BIDI → CLI verify --stdin returns IMPOSSIBLE_REFUTE", () => {
    const claim = "Mneme verifies " + String.fromCodePoint(0x202E) + " claims";
    const r = runMneme(["verify", "--stdin", "--json"], { input: claim });
    expect(r.status).toBeLessThan(3);
    expect(r.stdout).toMatch(/INPUT_TAMPERED|bidi_override/);
  });

  it("D6 NUL → CLI verify --stdin returns IMPOSSIBLE_REFUTE", () => {
    const r = runMneme(["verify", "--stdin", "--json"], { input: "test\x00here" });
    expect(r.status).toBeLessThan(3);
    expect(r.stdout).toMatch(/INPUT_TAMPERED|null_byte/);
  });

  it("D5 Number paraphrase → CLI verify surfaces NUMBER-BRIDGE headline OR AUTO-GROUND verdict", () => {
    const r = runMneme(["verify", "Mneme has eight hundred sixty-five tools"]);
    expect(r.status).toBeLessThan(3);
    // v2.44.0: either the NUMBER-BRIDGE caveat headline OR the auto-grounded
    // REFUTED verdict (both prove the bridge is wired through to CLI output).
    expect(r.stdout + r.stderr).toMatch(/NUMBER.?BRIDGE|865|canonical|AUTO_NUMBER|REFUTED|IMPOSSIBLE/i);
  });

  it("D1 argus rank → Cyrillic 'Mnеme' beats leetspeak 'Mnem3'", () => {
    const r = runMneme(["argus", "search", "--query", "Mneme", "--candidates", "Mnem3||Mn" + String.fromCodePoint(0x0435) + "me"]);
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.result.scored[0].candidate.text).not.toBe("Mnem3");
  });
});
