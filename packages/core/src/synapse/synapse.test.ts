import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { mintNexusCode, resolveNexusCode, listNexusCodes } from "./nexus_code.js";
import { encodeQRAnchor } from "./qr_anchor.js";
import { compressText, decompressText, renderCodebookHeader, COMPRESSION_CODEBOOK } from "./token_compression.js";

function tmpRepo(): string {
  return mkdtempSync(join(tmpdir(), "mneme-synapse-"));
}

describe("v1.81 SYNAPSE · nexus_code", () => {
  let repo: string;
  beforeEach(() => {
    repo = tmpRepo();
  });

  it("mints a 6-char code from soul text", () => {
    const entry = mintNexusCode(repo, { soulText: "# SOUL\nbody" });
    expect(entry.code).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);
    expect(entry.soulText).toContain("body");
    expect(entry.resolveCount).toBe(0);
  });

  it("persists to .mneme/synapse/codes.jsonl", () => {
    const entry = mintNexusCode(repo, { soulText: "abc" });
    const path = join(repo, ".mneme/synapse/codes.jsonl");
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toContain(entry.code);
  });

  it("resolves a fresh code + increments resolveCount", () => {
    const entry = mintNexusCode(repo, { soulText: "abc" });
    const r = resolveNexusCode(repo, entry.code);
    expect(r).not.toBeNull();
    expect(r!.soulText).toBe("abc");
    expect(r!.resolveCount).toBe(1);
    const r2 = resolveNexusCode(repo, entry.code);
    expect(r2!.resolveCount).toBe(2);
  });

  it("expired codes return null", () => {
    const entry = mintNexusCode(repo, { soulText: "abc", ttlMs: 1 });
    // Wait past TTL
    const past = new Date(Date.now() + 1000).toISOString();
    void past;
    // Manually expire by re-writing with past expiresAt
    const file = join(repo, ".mneme/synapse/codes.jsonl");
    const raw = readFileSync(file, "utf8");
    require("node:fs").writeFileSync(file, raw.replace(entry.expiresAt, "2000-01-01T00:00:00.000Z"));
    const r = resolveNexusCode(repo, entry.code);
    expect(r).toBeNull();
  });

  it("unknown code returns null", () => {
    expect(resolveNexusCode(repo, "ZZZZZZ")).toBeNull();
  });

  it("listNexusCodes only returns live entries", () => {
    mintNexusCode(repo, { soulText: "a" });
    mintNexusCode(repo, { soulText: "b" });
    const list = listNexusCodes(repo);
    expect(list.length).toBe(2);
  });

  it("gistUrl field is preserved through round-trip", () => {
    const entry = mintNexusCode(repo, { soulText: "x", gistUrl: "https://gist.github.com/u/abc123" });
    const r = resolveNexusCode(repo, entry.code);
    expect(r!.gistUrl).toBe("https://gist.github.com/u/abc123");
  });
});

describe("v1.81 SYNAPSE · qr_anchor", () => {
  it("encodes a short payload to SVG", () => {
    const a = encodeQRAnchor("K7M9X2");
    expect(a.svg).toContain("<svg");
    expect(a.svg).toContain("data-payload=\"K7M9X2\"");
    expect(a.warning).toBeNull();
  });

  it("warns when payload exceeds byte cap", () => {
    const big = "x".repeat(200);
    const a = encodeQRAnchor(big);
    expect(a.warning).not.toBeNull();
    expect(a.warning).toContain("NEXUS code");
  });

  it("renders finder squares + data cells (visual check)", () => {
    const a = encodeQRAnchor("HELLO");
    // The SVG should contain many <rect> entries (modules + finder squares).
    const rects = (a.svg.match(/<rect/g) ?? []).length;
    expect(rects).toBeGreaterThan(40);
  });

  it("preserves payload across html-escaping", () => {
    const a = encodeQRAnchor("a&b<c>d");
    expect(a.svg).toContain("data-payload=\"a&amp;b&lt;c&gt;d\"");
  });
});

describe("v1.81 SYNAPSE · token_compression", () => {
  it("renderCodebookHeader includes every entry", () => {
    const h = renderCodebookHeader();
    for (const e of COMPRESSION_CODEBOOK) {
      expect(h).toContain(e.code);
    }
  });

  it("compresses voice-directive header to a short code", () => {
    const text = "## VOICE DIRECTIVE (read FIRST -- governs every user-facing reply)\n\nBlah blah.";
    const r = compressText(text);
    expect(r.compressed).toContain("@@V");
    expect(r.compressed).not.toContain("VOICE DIRECTIVE");
    expect(r.ratio).toBeLessThan(0.7);
  });

  it("round-trip compress → decompress recovers original", () => {
    const text = "## Origin\nvendor=claude\n\n## Context\nthe user did things";
    const r = compressText(text);
    const back = decompressText(r.compressed);
    expect(back).toBe(text);
  });

  it("decompresses an inline-header-prefixed compressed text", () => {
    const text = "## Context\nthe user is happy";
    const r = compressText(text, { includeHeader: true });
    expect(r.compressed).toContain("# SYNAPSE-CODEBOOK");
    const back = decompressText(r.compressed);
    expect(back).toBe(text);
  });

  it("token savings on a realistic soul prompt are 20%+", () => {
    const sample = [
      "## VOICE DIRECTIVE (read FIRST -- governs every user-facing reply)",
      "Blah.",
      "",
      "## Mneme dictionary (read this BEFORE interpreting any Mneme keyword)",
      "Blah blah.",
      "",
      "## CONDUIT relay protocol (paste-only AIs read this carefully)",
      "Blah.",
      "",
      "## Origin",
      "vendor=claude",
      "",
      "## Context",
      "the user and the AI did things",
    ].join("\n");
    const r = compressText(sample);
    expect(r.ratio).toBeLessThan(0.8);
    expect(r.savedChars).toBeGreaterThan(50);
  });
});
