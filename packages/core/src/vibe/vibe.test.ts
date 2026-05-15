import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vibeCheck, explainLikeImFive, formatVibeLine } from "./index.js";

describe("v2.15 · MNEME VIBE — beginner-friendly safety wrapper", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "vibe-")); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it("clean change → ship_it 10/10", async () => {
    const r = await vibeCheck({
      description: "Add a button component",
      content: "function Button({ label }) { return <button>{label}</button>; }",
      files: ["src/Button.tsx"],
    }, { repoDir: dir });
    expect(r.status).toBe("ship_it");
    expect(r.confidence).toBe(10);
    expect(r.findings).toHaveLength(0);
  });

  it("DLP-flagged secret → stop_unsafe + critical finding", async () => {
    const r = await vibeCheck({
      description: "Save user config",
      content: 'const KEY = "AKIAIOSFODNN7EXAMPLE"; export { KEY };',
      files: ["src/config.ts"],
    }, { repoDir: dir });
    expect(r.status).toBe("stop_unsafe");
    expect(r.confidence).toBe(0);
    expect(r.findings.some((f) => f.severity === "critical" && f.source === "dlp")).toBe(true);
  });

  it("DLP-warned PII (email) → ship_with_note + worth_knowing finding", async () => {
    const r = await vibeCheck({
      description: "Add contact form",
      content: 'const SAMPLE = "user@example.com";',
    }, { repoDir: dir });
    expect(r.status).toBe("ship_with_note");
    expect(r.findings.some((f) => f.source === "dlp" && f.severity === "worth_knowing")).toBe(true);
  });

  it("complexity creep → important finding", async () => {
    // Build a high-complexity content blob
    const lots = Array.from({ length: 250 }, (_, i) =>
      `function f${i}(x) { if (x > 0) { for (let j = 0; j < x; j++) { x = x && j || x; } } else if (x < 0) { try { x++; } catch (e) { x--; } } return x ? x : -x; }`
    ).join("\n");
    const r = await vibeCheck({
      description: "Refactor everything",
      content: lots,
      files: Array.from({ length: 12 }, (_, i) => `src/f${i}.js`),
    }, { repoDir: dir });
    expect(r.findings.some((f) => f.source === "complexity" && f.severity === "important")).toBe(true);
  });

  it("plain-English headlines avoid jargon (no HMAC / no AST)", async () => {
    const r = await vibeCheck({
      description: "Save secret",
      content: 'const X = "sk-abc123def456ghi789jkl012mno345pq";',
    }, { repoDir: dir });
    for (const f of r.findings) {
      // No technical jargon should appear in the headline:
      expect(f.headline).not.toMatch(/HMAC|AST|sha256|canonical/i);
      expect(f.explain.length).toBeLessThan(400);
      expect(f.whatToDo.length).toBeGreaterThan(10);
    }
  });

  it("HMAC sig is on the report body", async () => {
    const r = await vibeCheck({ description: "x", content: "x" }, { repoDir: dir });
    expect(r.sig).toMatch(/^[0-9a-f]{64}$/);
  });

  describe("explainLikeImFive", () => {
    it("translates HMAC mismatch", () => {
      const out = explainLikeImFive({ topic: "Soul check", technical: "HMAC signature mismatch detected" });
      expect(out).toMatch(/security check|tampering|trusted/i);
      expect(out).not.toMatch(/HMAC/i);
    });

    it("translates zombie session", () => {
      const out = explainLikeImFive({ topic: "Cosmic", technical: "Session is zombie / stale" });
      expect(out).toMatch(/quiet|out of date|refresh/i);
    });

    it("translates DLP secret", () => {
      const out = explainLikeImFive({ topic: "Compliance", technical: "DLP block — secret detected" });
      expect(out).toMatch(/secret|API key|\.env/i);
    });

    it("falls back to passthrough for unknown topics (capped at 240 chars)", () => {
      const out = explainLikeImFive({ topic: "Misc", technical: "x".repeat(500) });
      // topic + ": " + truncated body
      expect(out.length).toBeLessThan(260);
    });
  });

  it("formatVibeLine summarises", async () => {
    const r = await vibeCheck({ description: "x", content: "x" }, { repoDir: dir });
    const line = formatVibeLine(r);
    expect(line).toContain("VIBE");
    expect(line).toContain("/10");
  });

  it("formatVibeLine handles null", () => {
    expect(formatVibeLine(null)).toContain("idle");
  });
});
