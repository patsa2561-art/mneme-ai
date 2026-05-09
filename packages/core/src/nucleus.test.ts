import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tick, readNucleus } from "./nucleus.js";

describe("nucleus tick — v1.23.2", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-nucleus-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("emits a periodic CONSOLIDATION lesson at tick 5 even with no growth", () => {
    let result;
    for (let i = 0; i < 5; i++) result = tick(repo);
    // The 5th tick should have produced a periodic lesson (no growth path).
    expect(result?.delta.newLesson).not.toBeNull();
    expect(result?.delta.newLesson?.source).toBe("periodic");
    expect(result?.delta.newLesson?.text).toMatch(/5 ticks of stable DNA/);
  });

  it("emits a periodic lesson at tick 10 too", () => {
    let result;
    for (let i = 0; i < 10; i++) result = tick(repo);
    expect(result?.delta.newLesson?.source).toBe("periodic");
    expect(result?.state.tick).toBe(10);
  });

  it("does NOT emit a periodic lesson on non-milestone ticks (3, 7)", () => {
    let r3, r7;
    for (let i = 0; i < 7; i++) {
      const r = tick(repo);
      if (i === 2) r3 = r; // 3rd tick
      if (i === 6) r7 = r; // 7th tick
    }
    expect(r3?.delta.newLesson).toBeNull();
    expect(r7?.delta.newLesson).toBeNull();
  });

  it("lesson text contains NO em-dash bytes (Windows codepage safe)", () => {
    for (let i = 0; i < 5; i++) tick(repo);
    const n = readNucleus(repo);
    expect(n.lessons.length).toBeGreaterThan(0);
    const lessonPath = join(repo, ".mneme/nucleus.json");
    expect(existsSync(lessonPath)).toBe(true);
    const raw = readFileSync(lessonPath); // raw bytes, no encoding
    // U+2014 (em-dash) is bytes E2 80 94 in UTF-8. None should appear in
    // machine-generated lesson text — the v1.23.2 fix uses '--' instead.
    for (let i = 0; i < raw.length - 2; i++) {
      const isEmDash = raw[i] === 0xe2 && raw[i + 1] === 0x80 && raw[i + 2] === 0x94;
      expect(isEmDash).toBe(false);
    }
  });
});
