/**
 * checksum — bundled-model integrity verification tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { sha256File, listFiles, verifyCache, readPinnedChecksums, verifyAgainstPin } from "./checksum.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mneme-checksum-"));
});

afterEach(() => {
  delete process.env["MNEME_PINNED_MODEL_CHECKSUMS"];
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

function expectedSha(content: string): string {
  return createHash("sha256").update(Buffer.from(content)).digest("hex");
}

describe("checksum — sha256File", () => {
  it("hashes content deterministically", () => {
    const p = join(tmp, "f.bin");
    writeFileSync(p, "hello world");
    expect(sha256File(p)).toBe(expectedSha("hello world"));
  });
});

describe("checksum — listFiles", () => {
  it("walks directory tree and returns relative paths", () => {
    mkdirSync(join(tmp, "sub"), { recursive: true });
    writeFileSync(join(tmp, "a.txt"), "1");
    writeFileSync(join(tmp, "sub", "b.txt"), "2");
    const list = listFiles(tmp).sort();
    expect(list).toEqual(["a.txt", "sub/b.txt"]);
  });

  it("returns empty for missing dir", () => {
    expect(listFiles(join(tmp, "nope"))).toEqual([]);
  });
});

describe("checksum — verifyCache", () => {
  it("verifies all matching files", () => {
    writeFileSync(join(tmp, "model.onnx"), "MODEL_BYTES");
    const r = verifyCache(tmp, { "model.onnx": expectedSha("MODEL_BYTES") });
    expect(r.ok).toBe(true);
    expect(r.verified).toBe(1);
    expect(r.mismatches).toEqual([]);
  });

  it("flags mismatch on tampered file", () => {
    writeFileSync(join(tmp, "model.onnx"), "TAMPERED_BYTES");
    const r = verifyCache(tmp, { "model.onnx": expectedSha("ORIGINAL_BYTES") });
    expect(r.ok).toBe(false);
    expect(r.mismatches.length).toBe(1);
    expect(r.mismatches[0]!.path).toBe("model.onnx");
  });

  it("flags missing pinned file", () => {
    const r = verifyCache(tmp, { "missing.onnx": "abc123" });
    expect(r.ok).toBe(false);
    expect(r.mismatches[0]!.actual).toBe("(missing)");
  });

  it("reports unexpected files (informational, doesn't fail)", () => {
    writeFileSync(join(tmp, "pinned.onnx"), "P");
    writeFileSync(join(tmp, "extra.bin"), "E");
    const r = verifyCache(tmp, { "pinned.onnx": expectedSha("P") });
    expect(r.ok).toBe(true);
    expect(r.unexpected).toContain("extra.bin");
  });
});

describe("checksum — readPinnedChecksums", () => {
  it("returns null when env unset", () => {
    expect(readPinnedChecksums()).toBeNull();
  });

  it("parses valid JSON object", () => {
    process.env["MNEME_PINNED_MODEL_CHECKSUMS"] = JSON.stringify({ "a.onnx": "deadbeef" });
    expect(readPinnedChecksums()).toEqual({ "a.onnx": "deadbeef" });
  });

  it("returns null for non-object JSON", () => {
    process.env["MNEME_PINNED_MODEL_CHECKSUMS"] = "[]";
    expect(readPinnedChecksums()).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    process.env["MNEME_PINNED_MODEL_CHECKSUMS"] = "not json";
    expect(readPinnedChecksums()).toBeNull();
  });
});

describe("checksum — verifyAgainstPin (integration)", () => {
  it("no-ops when pin unset", () => {
    expect(() => verifyAgainstPin(tmp)).not.toThrow();
  });

  it("throws on mismatch", () => {
    writeFileSync(join(tmp, "m.onnx"), "REAL");
    process.env["MNEME_PINNED_MODEL_CHECKSUMS"] = JSON.stringify({ "m.onnx": expectedSha("FAKE") });
    expect(() => verifyAgainstPin(tmp)).toThrow(/checksum verification FAILED/);
  });

  it("succeeds on match", () => {
    writeFileSync(join(tmp, "m.onnx"), "REAL");
    process.env["MNEME_PINNED_MODEL_CHECKSUMS"] = JSON.stringify({ "m.onnx": expectedSha("REAL") });
    expect(() => verifyAgainstPin(tmp)).not.toThrow();
  });
});
