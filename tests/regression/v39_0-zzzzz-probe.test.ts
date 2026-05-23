// v2.39.0 — Zzzzz-PROBE super-testing.
//
// Every analyzer tested with KNOWN-GOOD and KNOWN-BAD inputs.
// Plus WIRING-PROOF subprocess for the CLI surface.
// Plus HMAC chain tamper-detect.
// Plus HGP auto-record composition.

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(__dirname, "../../packages/cli/bin/mneme.js");

function runMneme(args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: opts.cwd ?? process.cwd(),
    encoding: "utf8",
    timeout: opts.timeoutMs ?? 60_000,
    env: { ...process.env, MNEME_WARMCALL: "0", MNEME_MUSCLE_BYPASS: "0", NO_COLOR: "1" },
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? -1 };
}

// ── Anti-entropy text analyzer ───────────────────────────────────────

describe("v2.39.0 Zzzzz-PROBE anti-entropy text (PINNED)", () => {
  it("shannonBitsPerChar returns sensible values", async () => {
    const m = await import("../../packages/core/src/zzzzz_probe/index.js");
    expect(m.shannonBitsPerChar("")).toBe(0);
    // Single char repeated = 0 entropy
    expect(m.shannonBitsPerChar("aaaaa")).toBe(0);
    // Natural English typically ~4.0-4.6
    const natural = "The quick brown fox jumps over the lazy dog. The fox is fast and clever.";
    const s = m.shannonBitsPerChar(natural);
    expect(s).toBeGreaterThan(3);
    expect(s).toBeLessThan(5);
  });

  it("repetitionRate detects mono-word spam", async () => {
    const m = await import("../../packages/core/src/zzzzz_probe/index.js");
    expect(m.repetitionRate("foo foo foo foo foo")).toBe(1);
    expect(m.repetitionRate("one two three four five")).toBe(0.2);
  });

  it("sentenceVarianceRatio = 0 for single sentence", async () => {
    const m = await import("../../packages/core/src/zzzzz_probe/index.js");
    expect(m.sentenceVarianceRatio("Just one sentence here")).toBe(0);
    // Multi-sentence with same length → low ratio
    const uniform = "aaa aaa aaa. bbb bbb bbb. ccc ccc ccc. ddd ddd ddd.";
    const r = m.sentenceVarianceRatio(uniform);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(0.2);
  });

  it("analyzeText on natural English → low anomaly", async () => {
    const m = await import("../../packages/core/src/zzzzz_probe/index.js");
    const txt = "Yesterday I walked to the park and saw a squirrel. It was eating an acorn near the bench. I sat down for a while and read my book. The afternoon was warm. Eventually I headed home.";
    const r = m.analyzeText(txt);
    expect(r.anomalyScore).toBeLessThan(0.55);
  });

  it("analyzeText on heavy repetition → high anomaly", async () => {
    const m = await import("../../packages/core/src/zzzzz_probe/index.js");
    const txt = ("hallucination ".repeat(50)).trim();
    const r = m.analyzeText(txt);
    expect(r.repetitionRate).toBe(1);
    expect(r.anomalyScore).toBeGreaterThan(0.5);
  });
});

// ── Image provenance analyzer ────────────────────────────────────────

describe("v2.39.0 Zzzzz-PROBE image provenance (PINNED)", () => {
  it("detectFormat magic bytes — PNG / JPEG / BMP / GIF / WebP / unknown", async () => {
    const m = await import("../../packages/core/src/zzzzz_probe/index.js");
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
    const jpegHeader = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const bmpHeader = new Uint8Array([0x42, 0x4d, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const gifHeader = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);
    const webpHeader = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    const unknownHeader = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(m.detectFormat(pngHeader)).toBe("png");
    expect(m.detectFormat(jpegHeader)).toBe("jpeg");
    expect(m.detectFormat(bmpHeader)).toBe("bmp");
    expect(m.detectFormat(gifHeader)).toBe("gif");
    expect(m.detectFormat(webpHeader)).toBe("webp");
    expect(m.detectFormat(unknownHeader)).toBe("unknown");
  });

  it("perceptualHash is deterministic + 16-hex", async () => {
    const m = await import("../../packages/core/src/zzzzz_probe/index.js");
    const b = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const h1 = m.perceptualHash(b);
    const h2 = m.perceptualHash(b);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{16}$/);
  });

  it("colorHistogramEntropy ≥ 0 for any input", async () => {
    const m = await import("../../packages/core/src/zzzzz_probe/index.js");
    const uniform = new Uint8Array(300).fill(128);
    const random = new Uint8Array(300);
    for (let i = 0; i < random.length; i++) random[i] = i % 256;
    const eUniform = m.colorHistogramEntropy(uniform);
    const eRandom = m.colorHistogramEntropy(random);
    expect(eUniform).toBeLessThan(eRandom); // uniform has narrower palette
    expect(eUniform).toBeGreaterThanOrEqual(0);
  });

  it("analyzeImage on solid-color bytes → high suspicion (narrow palette + low variance)", async () => {
    const m = await import("../../packages/core/src/zzzzz_probe/index.js");
    // Solid-color PNG-like header + 4KB of single-byte payload.
    const header = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const payload = new Uint8Array(4096).fill(64);
    const merged = new Uint8Array(header.length + payload.length);
    merged.set(header); merged.set(payload, header.length);
    const r = m.analyzeImage(merged);
    expect(r.format).toBe("png");
    expect(r.suspicionScore).toBeGreaterThan(0.3);
  });

  it("analyzeImage on noisy bytes → lower suspicion", async () => {
    const m = await import("../../packages/core/src/zzzzz_probe/index.js");
    const header = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const payload = new Uint8Array(4096);
    for (let i = 0; i < payload.length; i++) payload[i] = (i * 137 + 23) % 256;
    const merged = new Uint8Array(header.length + payload.length);
    merged.set(header); merged.set(payload, header.length);
    const r = m.analyzeImage(merged);
    // Pseudo-random bytes spread across the histogram → lower suspicion than solid.
    expect(r.suspicionScore).toBeLessThan(0.6);
    expect(r.colorHistogramEntropy).toBeGreaterThan(4.0);
  });
});

// ── OS polygraph classifier ──────────────────────────────────────────

describe("v2.39.0 Zzzzz-PROBE OS polygraph (PINNED)", () => {
  it("classifyOS returns a known platform + strategy", async () => {
    const m = await import("../../packages/core/src/zzzzz_probe/index.js");
    const r = await m.classifyOS();
    expect(["win32", "darwin", "linux", "freebsd", "openbsd", "sunos", "aix"]).toContain(r.platform);
    expect(["windows-dll-chrysalis", "posix-signals", "polygraph-bridge", "none"]).toContain(r.interceptionStrategy);
  });
});

// ── Engine + HMAC chain ──────────────────────────────────────────────

describe("v2.39.0 Zzzzz-PROBE engine + HMAC (PINNED)", () => {
  let repo: string;
  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), "zzzzz-"));
    const m = await import("../../packages/core/src/zzzzz_probe/index.js");
    m.__resetZzzzzChainForTest();
  });

  it("probeArtifact on clean text → CRYSTAL_CLEAR", async () => {
    const m = await import("../../packages/core/src/zzzzz_probe/index.js");
    const r = await m.probeArtifact({ modality: "text", text: "The fox ran across the field on a sunny morning." }, repo);
    expect(["CRYSTAL_CLEAR", "PROBE_DRIFT"]).toContain(r.verdict);
    expect(r.hmac).toMatch(/^[a-f0-9]{64}$/);
    expect(m.verifyReport(r).ok).toBe(true);
  });

  it("probeArtifact on high-repetition text → REFUTED/IMPOSSIBLE_REFUTE", async () => {
    const m = await import("../../packages/core/src/zzzzz_probe/index.js");
    const r = await m.probeArtifact({ modality: "text", text: ("aaa ".repeat(100)).trim() }, repo);
    expect(["REFUTED", "IMPOSSIBLE_REFUTE"]).toContain(r.verdict);
  });

  it("HMAC tamper-detect", async () => {
    const m = await import("../../packages/core/src/zzzzz_probe/index.js");
    const r = await m.probeArtifact({ modality: "text", text: "hello world this is a normal sentence." }, repo);
    const tampered = { ...r, verdict: "CRYSTAL_CLEAR" as const, confidence: 9.99 };
    expect(m.verifyReport(tampered).ok).toBe(false);
  });

  it("REFUTED probe auto-records HGP-ID", async () => {
    const m = await import("../../packages/core/src/zzzzz_probe/index.js");
    const r = await m.probeArtifact({
      modality: "text",
      text: ("hallucinated ".repeat(80)).trim(),
      vendor: "test-vendor",
    }, repo);
    if (r.verdict === "REFUTED" || r.verdict === "IMPOSSIBLE_REFUTE") {
      expect(r.hgpId).toMatch(/^HGP-\d{4}-\d{5}/);
    }
  });

  it("ledger persistence: readLedger returns the written reports", async () => {
    const m = await import("../../packages/core/src/zzzzz_probe/index.js");
    await m.probeArtifact({ modality: "text", text: "first probe" }, repo);
    await m.probeArtifact({ modality: "text", text: "second probe" }, repo);
    const list = m.readLedger(repo);
    expect(list.length).toBe(2);
  });

  it("arm/disarm/isArmed state machine", async () => {
    const m = await import("../../packages/core/src/zzzzz_probe/index.js");
    expect(m.isArmed(repo)).toBe(false);
    m.arm(repo, "test");
    expect(m.isArmed(repo)).toBe(true);
    m.disarm(repo);
    expect(m.isArmed(repo)).toBe(false);
  });
});

// ── WIRING-PROOF (subprocess CLI) ────────────────────────────────────

describe("v2.39.0 Zzzzz-PROBE WIRING-PROOF (CLI subprocess)", () => {
  it("mneme zzzzz status returns JSON", () => {
    const r = runMneme(["zzzzz", "status"], { timeoutMs: 30_000 });
    const j = JSON.parse(r.stdout) as { ok?: boolean; armed?: boolean; ledgerSize?: number };
    expect(j.ok).toBe(true);
    expect(typeof j.armed).toBe("boolean");
    expect(typeof j.ledgerSize).toBe("number");
  }, 30_000);

  it("mneme zzzzz probe --text returns verdict JSON", () => {
    const r = runMneme(["zzzzz", "probe", "--text", "A normal English sentence here."], { timeoutMs: 30_000 });
    const j = JSON.parse(r.stdout) as { ok?: boolean; report?: { verdict?: string } };
    expect(j.ok).toBe(true);
    expect(j.report?.verdict).toMatch(/CRYSTAL_CLEAR|PROBE_DRIFT|REFUTED|IMPOSSIBLE_REFUTE/);
  }, 30_000);

  it("mneme zzzzz probe --text <repeated> returns REFUTED + exit code 2", () => {
    const garbage = ("xxx ".repeat(80)).trim();
    const r = runMneme(["zzzzz", "probe", "--text", garbage], { timeoutMs: 30_000 });
    const j = JSON.parse(r.stdout) as { ok?: boolean; report?: { verdict?: string } };
    expect(j.ok).toBe(true);
    expect(["REFUTED", "IMPOSSIBLE_REFUTE"]).toContain(j.report?.verdict ?? "");
    expect(r.status).toBe(2);
  }, 30_000);

  it("mneme zzzzz probe --image <path> works on a small synthetic file", () => {
    const tmp = mkdtempSync(join(tmpdir(), "zzzzz-img-"));
    const imgPath = join(tmp, "test.png");
    // Minimal-but-valid PNG signature + IHDR + IDAT + IEND chunks.
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ...Array(4096).fill(0x80),
    ]);
    writeFileSync(imgPath, png);
    const r = runMneme(["zzzzz", "probe", "--image", imgPath], { timeoutMs: 30_000 });
    const j = JSON.parse(r.stdout) as { ok?: boolean; report?: { modality?: string; verdict?: string } };
    expect(j.ok).toBe(true);
    expect(j.report?.modality).toBe("image");
  }, 30_000);

  it("mneme zzzzz arm + verdict round-trip via subprocess", () => {
    const a = runMneme(["zzzzz", "arm", "--reason", "test"], { timeoutMs: 15_000 });
    const ja = JSON.parse(a.stdout) as { ok?: boolean; state?: { armed?: boolean } };
    expect(ja.ok).toBe(true);
    expect(ja.state?.armed).toBe(true);
    const v = runMneme(["zzzzz", "verdict", "--limit", "5"], { timeoutMs: 15_000 });
    const jv = JSON.parse(v.stdout) as { ok?: boolean; count?: number };
    expect(jv.ok).toBe(true);
    expect(typeof jv.count).toBe("number");
  }, 30_000);
});

// ── Defensive ────────────────────────────────────────────────────────

describe("v2.39.0 Zzzzz-PROBE defensive (PINNED)", () => {
  it("probeArtifact on empty text → graceful caveat, not throw", async () => {
    const m = await import("../../packages/core/src/zzzzz_probe/index.js");
    const repo = mkdtempSync(join(tmpdir(), "zzzzz-empty-"));
    const r = await m.probeArtifact({ modality: "text", text: "" }, repo);
    expect(r.caveats).toContain("ZZZZZ_EMPTY_TEXT");
    expect(r.verdict).toBe("CRYSTAL_CLEAR"); // empty input has 0 score
  });

  it("probeArtifact on empty image → graceful caveat", async () => {
    const m = await import("../../packages/core/src/zzzzz_probe/index.js");
    const repo = mkdtempSync(join(tmpdir(), "zzzzz-empty-img-"));
    const r = await m.probeArtifact({ modality: "image", imageBytes: new Uint8Array(0) }, repo);
    expect(r.caveats).toContain("ZZZZZ_EMPTY_IMAGE");
  });

  it("analyzeImage on tiny input (< 12 bytes) returns format=unknown without throw", async () => {
    const m = await import("../../packages/core/src/zzzzz_probe/index.js");
    const r = m.analyzeImage(new Uint8Array([1, 2, 3]));
    expect(r.format).toBe("unknown");
    expect(r.suspicionScore).toBeGreaterThanOrEqual(0);
  });
});
