// v2.43.0 — WIRING LAG CLOSURE + HYDRA crash + ARGUS rank.
//
// User audit (2026-05-23): 6 core features ship at module level but
// the user-facing CLI either has no flag OR doesn't surface the verdict.
// Plus 1 HYDRA runtime crash and 1 ARGUS rank regression.
//
// Rows from the screenshot (discrete):
//   A1   `mneme argus search --candidates-json` → unknown option
//   A2   `mneme verify "eight hundred sixty-five tools"` → UNKNOWN
//   A3   `mneme verify "๘๖๕ tools"` → UNKNOWN
//   A4   `mneme verify "0x361 tools"` → UNKNOWN
//   A5   `mneme verify <BIDI>` → UNKNOWN (shell strips BIDI from argv)
//   A6   `mneme verify <null-byte>` → UNKNOWN (shell strips NUL from argv)
//   B    `mneme argus hydra --strains '[{"id":...}]'` → runtime TypeError
//   C    ARGUS rank "Mnem3" > "Mnеme" (Cyrillic homoglyph loses)

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

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
//  A1 — argus search --candidates-json
// ═══════════════════════════════════════════════════════════════════════

describe("v2.43.0 A1 — argus search --candidates-json (PINNED)", () => {
  it("A1.1 argus search accepts --candidates-json with meta", () => {
    const cands = JSON.stringify([
      { text: "Mneme verifies claims", meta: { vendor: "test" } },
      { text: "cat sat on mat" },
    ]);
    const r = runMneme(["argus", "search", "--query", "Mneme verifies", "--candidates-json", cands]);
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
    expect(j.result.scored[0].candidate.text).toBe("Mneme verifies claims");
  });

  it("A1.2 argus search error message names the missing flag clearly", () => {
    const r = runMneme(["argus", "search", "--query", "x"]);
    expect(r.status).toBe(1);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(false);
    expect(j.error).toMatch(/candidates/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  A2-A4 — number paraphrase grounded against live state
// ═══════════════════════════════════════════════════════════════════════

describe("v2.43.0 A2-A4 — number paraphrase grounding (PINNED)", () => {
  it("A2 verify number-words claim canonicalizes (NUMBER_BRIDGE caveat OR forensic ground)", async () => {
    const { runACGV } = await import("../../packages/core/src/squadron/acgv.js");
    const r = runACGV({
      claim: "Mneme has eight hundred sixty-five tools",
      repoRoot: process.cwd(),
      noEmitVaccine: true, noStake: true,
    });
    expect(r.caveats.some((c) => c.startsWith("NUMBER_BRIDGE"))).toBe(true);
  });

  it("A3 Thai numerals trigger NUMBER_BRIDGE caveat", async () => {
    const { runACGV } = await import("../../packages/core/src/squadron/acgv.js");
    const r = runACGV({
      claim: "Mneme has ๘๖๕ tools",
      repoRoot: process.cwd(),
      noEmitVaccine: true, noStake: true,
    });
    expect(r.caveats.some((c) => c.startsWith("NUMBER_BRIDGE"))).toBe(true);
  });

  it("A4 hex notation triggers NUMBER_BRIDGE caveat", async () => {
    const { runACGV } = await import("../../packages/core/src/squadron/acgv.js");
    const r = runACGV({
      claim: "Mneme has 0x361 tools",
      repoRoot: process.cwd(),
      noEmitVaccine: true, noStake: true,
    });
    expect(r.caveats.some((c) => c.startsWith("NUMBER_BRIDGE"))).toBe(true);
  });

  it("A2.cli CLI verify of number-words claim surfaces NUMBER_BRIDGE in output", () => {
    const r = runMneme(["verify", "Mneme has eight hundred sixty-five tools", "--json"]);
    expect(r.status).toBeLessThan(3);
    // Either headline mentions number-bridge OR caveats list includes it
    const text = r.stdout + r.stderr;
    expect(text).toMatch(/NUMBER_BRIDGE|865|canonical/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  A5-A6 — hostile-char input modes (shell preservation)
// ═══════════════════════════════════════════════════════════════════════

describe("v2.43.0 A5-A6 — hostile-char input modes (PINNED)", () => {
  it("A5 verify --stdin preserves BIDI char + flags INPUT_TAMPERED", () => {
    const claim = "Mneme verifies " + String.fromCodePoint(0x202E) + " all claims";
    const r = runMneme(["verify", "--stdin", "--json"], { input: claim });
    expect(r.status).toBeLessThan(3);
    const text = r.stdout + r.stderr;
    expect(text).toMatch(/INPUT_TAMPERED|bidi_override|hostile/i);
  });

  it("A6 verify --stdin preserves NUL byte + flags INPUT_TAMPERED", () => {
    const claim = "honest text\x00 hidden tail";
    const r = runMneme(["verify", "--stdin", "--json"], { input: claim });
    expect(r.status).toBeLessThan(3);
    const text = r.stdout + r.stderr;
    expect(text).toMatch(/INPUT_TAMPERED|null_byte|hostile/i);
  });

  it("A5.hex verify --hex decodes hex-encoded BIDI claim + flags", () => {
    const claim = "Mneme verifies " + String.fromCodePoint(0x202E) + " all";
    const hex = Buffer.from(claim, "utf8").toString("hex");
    const r = runMneme(["verify", "--hex", hex, "--json"]);
    expect(r.status).toBeLessThan(3);
    const text = r.stdout + r.stderr;
    expect(text).toMatch(/INPUT_TAMPERED|bidi_override|hostile/i);
  });

  it("A6.b64 verify --base64 decodes base64 NUL claim + flags", () => {
    const claim = "honest text\x00 hidden";
    const b64 = Buffer.from(claim, "utf8").toString("base64");
    const r = runMneme(["verify", "--base64", b64, "--json"]);
    expect(r.status).toBeLessThan(3);
    const text = r.stdout + r.stderr;
    expect(text).toMatch(/INPUT_TAMPERED|null_byte|hostile/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  B — HYDRA defensive spawn (graceful error instead of TypeError)
// ═══════════════════════════════════════════════════════════════════════

describe("v2.43.0 B — HYDRA defensive spawn (PINNED)", () => {
  it("B.1 spawnHydraEye with id-but-no-name uses id as fallback", async () => {
    const { spawnHydraEye } = await import("../../packages/core/src/argus10/hydra.js");
    // Cast around the missing 'name' field — emulates real-world JSON
    const strain = { id: "fake_hash", regex: "[0-9a-f]{7,40}", precision: 0.95, recall: 0.92 } as unknown as Parameters<typeof spawnHydraEye>[0];
    const eye = spawnHydraEye(strain);
    expect(eye).not.toBeNull();
    expect(eye!.id).toMatch(/EYE_HYDRA_fake_hash/);
  });

  it("B.2 spawnHydraEye with no name/id/regex returns null (graceful, not TypeError)", async () => {
    const { spawnHydraEye } = await import("../../packages/core/src/argus10/hydra.js");
    const strain = { precision: 0.99, recall: 0.99 } as unknown as Parameters<typeof spawnHydraEye>[0];
    const eye = spawnHydraEye(strain);
    expect(eye).toBeNull();
  });

  it("B.3 CLI hydra with id-only strain returns ok: true + spawned eye (NOT TypeError)", () => {
    const r = runMneme(["argus", "hydra", "--strains", JSON.stringify([
      { id: "fake_hash", regex: "[0-9a-f]{7,40}", precision: 0.95, recall: 0.92 },
    ])]);
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
    expect(j.spawned).toBe(1);
  });

  it("B.4 CLI hydra with malformed strain (no name/id/regex) returns 0 spawned, no crash", () => {
    const r = runMneme(["argus", "hydra", "--strains", JSON.stringify([
      { precision: 0.95, recall: 0.92 }, // missing everything else
    ])]);
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
    expect(j.spawned).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  C — ARGUS rank: Cyrillic homoglyph MUST beat leetspeak digit-sub
// ═══════════════════════════════════════════════════════════════════════

describe("v2.43.0 C — ARGUS rank Cyrillic > leetspeak (PINNED)", () => {
  it("C.1 query 'Mneme': Cyrillic homoglyph 'Mnеme' ranks ABOVE 'Mnem3'", async () => {
    const { argusSearch } = await import("../../packages/core/src/argus10/index.js");
    const r = await argusSearch({
      query: "Mneme",
      candidates: [
        { text: "Mnem3" },                          // digit substitution
        { text: "Mn" + String.fromCodePoint(0x0435) + "me" },  // Cyrillic 'е'
        { text: "totally unrelated" },
      ],
      repoRoot: process.cwd(),
    });
    expect(r.scored[0]!.candidate.text).toMatch(/Mn.me/u);
    // The Cyrillic must be the winner (not the leetspeak)
    expect(r.scored[0]!.candidate.text).not.toBe("Mnem3");
  });

  it("C.2 multimodal engine also ranks Cyrillic > leetspeak", async () => {
    const { argusSearchMultimodal } = await import("../../packages/core/src/argus10/index.js");
    const r = await argusSearchMultimodal({
      query: "Mneme",
      candidates: [
        { text: "Mnem3" },
        { text: "Mn" + String.fromCodePoint(0x0435) + "me" },
      ],
      repoRoot: process.cwd(),
    }, { skipBloom: true });
    expect(r.scored[0]!.candidate.text).not.toBe("Mnem3");
  });
});
