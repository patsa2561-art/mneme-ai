/**
 * v1.84.0 -- regression suite covering Round 4 + Round 5 user findings.
 * One file, all bugs, all fixed.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { encodeQRAnchor } from "./synapse/qr_anchor.js";
import { compressText } from "./synapse/token_compression.js";
import { mintNexusCode, portableFor } from "./synapse/nexus_code.js";
import { parseGistUrl } from "./genesplice/gist_transmit.js";
import { packWanderer, unpackWanderer } from "./exodus/wanderer.js";

function tmpRepo(): string {
  return mkdtempSync(join(tmpdir(), "mneme-v184-"));
}

describe("v1.84 R4-1 · qr_anchor no longer throws (ESM-pure)", () => {
  it("encodeQRAnchor returns SVG without 'require is not defined' error", () => {
    const a = encodeQRAnchor("K7M9X2");
    expect(a.svg).toContain("<svg");
    expect(a.svg).toContain("data-payload=\"K7M9X2\"");
  });

  it("works for a longer payload too", () => {
    const a = encodeQRAnchor("https://gist.github.com/user/abc123def456");
    expect(a.svg).toContain("<svg");
    expect(a.warning).toBeNull();
  });
});

describe("v1.84 R4-2 · codebook compression ratio improved", () => {
  it("realistic soul-prompt-sized text saves 25%+ tokens", () => {
    const sample = [
      "## VOICE DIRECTIVE (read FIRST -- governs every user-facing reply)",
      "",
      "1. Never speak Mneme codenames out loud.",
      "2. No mode narration. Don't say standing by.",
      "3. Stop offering menus.",
      "4. No unsolicited version chatter.",
      "5. One hedge per reply, max.",
      "6. Match the previous turn's voice.",
      "",
      "## Mneme dictionary (read this BEFORE interpreting any Mneme keyword)",
      "",
      "Mneme is the npm package mneme-ai. NOT a generic protocol.",
      "",
      "## CONDUIT relay protocol (paste-only AIs read this carefully)",
      "",
      "You are the receiving AI. You have no Mneme installed locally.",
      "When the user asks for cross-vendor actions, emit a # CONDUIT RETURN block.",
      "",
      "## Mneme Heartbeat (version telepathy)",
      "local_version: 1.84.0",
      "npm_latest: 1.84.0",
      "",
      "## Origin",
      "vendor=claude-opus-4-7",
      "",
      "## Context",
      "the user and the AI did things involving Mneme MCP tools and soul prompt across machines",
    ].join("\n");
    const r = compressText(sample);
    expect(r.ratio).toBeLessThan(0.75);
    expect(r.savedChars).toBeGreaterThan(100);
  });
});

describe("v1.84 R5-2 · parseGistUrl supports mneme:// URI", () => {
  it("https form still works", () => {
    const r = parseGistUrl("https://gist.github.com/user/abc123def456789");
    expect(r.gistId).toBe("abc123def456789");
  });

  it("mneme://gist/<id> form works", () => {
    const r = parseGistUrl("mneme://gist/abc123def456789");
    expect(r.gistId).toBe("abc123def456789");
  });

  it("mneme://gist/<id>/<hmac> form works", () => {
    const r = parseGistUrl("mneme://gist/abc123def456789/2bd33e57ab898b09");
    expect(r.gistId).toBe("abc123def456789");
  });

  it("mneme://gist/<id>?key=... form works", () => {
    const r = parseGistUrl("mneme://gist/abc123def456789?key=xyz");
    expect(r.gistId).toBe("abc123def456789");
  });

  it("garbage returns null gistId", () => {
    const r = parseGistUrl("not-a-gist-url");
    expect(r.gistId).toBeNull();
  });
});

describe("v1.84 R5-3 · Wanderer cross-machine HMAC", () => {
  it("portableSig lets unpack succeed on a DIFFERENT repo (different HMAC secret)", () => {
    const sourceRepo = tmpRepo();
    const destRepo = tmpRepo();
    const { path } = packWanderer(sourceRepo);
    const result = unpackWanderer(destRepo, path);
    expect(result.ok).toBe(true);
    expect(result.crossMachine).toBe(true);
    expect(result.reason).toContain("portableSig");
  });

  it("same-machine path still verifies inner HMAC (crossMachine=false)", () => {
    const repo = tmpRepo();
    const { path } = packWanderer(repo);
    const result = unpackWanderer(repo, path);
    expect(result.ok).toBe(true);
    expect(result.crossMachine).toBe(false);
  });

  it("requireLocalHmac:true rejects cross-machine bundles", () => {
    const sourceRepo = tmpRepo();
    const destRepo = tmpRepo();
    const { path } = packWanderer(sourceRepo);
    const result = unpackWanderer(destRepo, path, { requireLocalHmac: true });
    expect(result.ok).toBe(false);
  });

  it("tampered portableSig is detected", () => {
    const repo = tmpRepo();
    const { path } = packWanderer(repo);
    const raw = JSON.parse(readFileSync(path, "utf8"));
    raw.portableSig = "f".repeat(64);
    writeFileSync(path, JSON.stringify(raw, null, 2));
    const result = unpackWanderer(tmpRepo(), path);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("portable signature mismatch");
  });
});

describe("v1.84 R5-4 · packWanderer honors outPath", () => {
  it("writes to opts.outPath when provided", () => {
    const repo = tmpRepo();
    const target = join(tmpRepo(), "custom", "bundle.mwt");
    const { path } = packWanderer(repo, { outPath: target });
    expect(path.replace(/\\/g, "/").endsWith("custom/bundle.mwt")).toBe(true);
    // Round-trip works.
    const r = unpackWanderer(tmpRepo(), path);
    expect(r.ok).toBe(true);
  });

  it("falls back to default dir when outPath omitted", () => {
    const repo = tmpRepo();
    const { path } = packWanderer(repo);
    expect(path).toContain(".mneme");
    expect(path).toContain("wanderer");
  });
});

describe("v1.84 ARCHITECTURE · NEXUS portable for mobile apps", () => {
  it("mintNexusCode returns portable {code, url, instruction, qrPayload}", () => {
    const repo = tmpRepo();
    const entry = mintNexusCode(repo, { soulText: "# SOUL\nbody", gistUrl: "https://gist.github.com/u/abc123" });
    expect(entry.portable).toBeDefined();
    expect(entry.portable.code).toBe(entry.code);
    expect(entry.portable.url).toBe("https://gist.github.com/u/abc123");
    expect(entry.portable.qrPayload).toContain(entry.code);
    expect(entry.portable.qrPayload).toContain("https://gist.github.com/u/abc123");
    expect(entry.portable.instruction).toContain("paste this URL");
  });

  it("without Gist URL, portable explains the Mneme-only-destination limitation", () => {
    const repo = tmpRepo();
    const entry = mintNexusCode(repo, { soulText: "# SOUL\nbody" });
    expect(entry.portable.url).toBeNull();
    expect(entry.portable.instruction.toLowerCase()).toContain("mneme");
  });

  it("portableFor helper produces the same output as mintNexusCode embeds", () => {
    const repo = tmpRepo();
    const entry = mintNexusCode(repo, { soulText: "x", gistUrl: "https://gist.github.com/u/abc" });
    const p = portableFor({
      code: entry.code,
      createdAt: entry.createdAt,
      expiresAt: entry.expiresAt,
      soulHash: entry.soulHash,
      soulText: entry.soulText,
      gistUrl: entry.gistUrl,
      resolveCount: entry.resolveCount,
    });
    expect(p.code).toBe(entry.code);
    expect(p.url).toBe(entry.portable.url);
  });
});
