import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitPacket, verifyPacket, importPacket, readLedger, simhash64, hammingDistance, networkStats } from "./whisper.js";

function setup(): string { return mkdtempSync(join(tmpdir(), "mneme-whisper-")); }
function teardown(r: string) { try { rmSync(r, { recursive: true, force: true }); } catch { /* */ } }

describe("v1.60 Whisper Net · simhash + Hamming", () => {
  it("simhash64 yields 16-char hex", () => {
    expect(simhash64("hello world")).toMatch(/^[0-9a-f]{16}$/);
  });
  it("identical inputs -> Hamming 0", () => {
    expect(hammingDistance(simhash64("X"), simhash64("X"))).toBe(0);
  });
  it("different inputs -> Hamming > 0", () => {
    const a = simhash64("Mneme has 200 tools and the daemon is written in Rust");
    const b = simhash64("the sky is blue and grass is green");
    expect(hammingDistance(a, b)).toBeGreaterThan(0);
  });
});

describe("v1.60 Whisper Net · emit + verify packet", () => {
  let repo: string;
  beforeEach(() => { repo = setup(); });
  afterEach(() => teardown(repo));

  it("emitPacket produces signed packet with correct fields", () => {
    const p = emitPacket(repo, "vaccine", "claude-opus-4-7", { sample: "Rust lie", severity: 5 });
    expect(p.kind).toBe("vaccine");
    expect(p.emittedBy).toBe("claude-opus-4-7");
    expect(p.hmac).toHaveLength(32);
    expect(p.simhash64).toMatch(/^[0-9a-f]{16}$/);
    expect(p.schemaVersion).toBe(1);
  });

  it("verifyPacket -- intact packet ok", () => {
    const p = emitPacket(repo, "lesson", "v", { text: "always-studying" });
    expect(verifyPacket(repo, p).ok).toBe(true);
  });

  it("verifyPacket -- tampered packet rejected", () => {
    const p = emitPacket(repo, "vaccine", "v", { x: 1 });
    const t = { ...p, payload: { x: 2 } };
    expect(verifyPacket(repo, t).ok).toBe(false);
  });
});

describe("v1.60 Whisper Net · import + dedup", () => {
  let repo: string;
  beforeEach(() => { repo = setup(); });
  afterEach(() => teardown(repo));

  it("importPacket on fresh ledger -> ok + not deduplicated", () => {
    const p = emitPacket(repo, "vaccine", "v", { x: 1 });
    const r = importPacket(repo, p);
    expect(r.ok).toBe(true);
    expect(r.deduplicated).toBeUndefined();
  });

  it("re-importing the same packet -> deduplicated", () => {
    const p = emitPacket(repo, "vaccine", "v", { x: 1 });
    importPacket(repo, p);
    const r2 = importPacket(repo, p);
    expect(r2.ok).toBe(true);
    expect(r2.deduplicated).toBe(true);
  });

  it("importPacket with tampered HMAC -> rejected", () => {
    const p = emitPacket(repo, "vaccine", "v", { x: 1 });
    const bad = { ...p, hmac: "0".repeat(32) };
    const r = importPacket(repo, bad);
    expect(r.ok).toBe(false);
  });

  it("readLedger reflects imported packets", () => {
    const a = emitPacket(repo, "vaccine", "v1", { x: 1 });
    const b = emitPacket(repo, "lesson", "v2", { y: 2 });
    importPacket(repo, a);
    importPacket(repo, b);
    const all = readLedger(repo);
    expect(all.length).toBe(2);
  });
});

describe("v1.60 Whisper Net · network stats", () => {
  let repo: string;
  beforeEach(() => { repo = setup(); });
  afterEach(() => teardown(repo));

  it("counts packets by kind + unique emitters", () => {
    // Use distinct payload tokens so simhash dedup doesn't collapse them.
    importPacket(repo, emitPacket(repo, "vaccine", "v1", { sample: "alpha bravo charlie", id: "vaccine-alpha" }));
    importPacket(repo, emitPacket(repo, "lesson",  "v2", { sample: "delta echo foxtrot", id: "lesson-delta" }));
    importPacket(repo, emitPacket(repo, "lesson",  "v2", { sample: "golf hotel india", id: "lesson-golf" }));
    const s = networkStats(repo);
    expect(s.totalPackets).toBe(3);
    expect(s.byKind.vaccine).toBe(1);
    expect(s.byKind.lesson).toBe(2);
    expect(s.uniqueEmitters).toBe(2);
  });

  it("empty repo -> zeros", () => {
    const s = networkStats(repo);
    expect(s.totalPackets).toBe(0);
    expect(s.uniqueEmitters).toBe(0);
  });
});
