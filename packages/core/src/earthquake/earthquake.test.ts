import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fingerprint, recordProbe, listProbes, verifyProbe,
  computeBaseline, detectDrift, runProbe,
  getConfig, setConfig, listAlerts,
  formatFingerprint, formatBaseline, formatReport,
  FINGERPRINT_DIMS,
  type ProbeRecord,
} from "./index.js";

describe("earthquake alarm", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-eq-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  // ─── FINGERPRINT ─────────────────────────────────────────────────────

  describe("fingerprint (the 8-dim behavioural metric)", () => {
    it("is deterministic for the same text", () => {
      const a = fingerprint("Hello world. This is a sentence.");
      const b = fingerprint("Hello world. This is a sentence.");
      expect(a).toEqual(b);
    });

    it("computes all 8 dimensions", () => {
      const fp = fingerprint("Short text.");
      for (const dim of FINGERPRINT_DIMS) {
        expect(typeof fp[dim]).toBe("number");
        expect(Number.isFinite(fp[dim])).toBe(true);
      }
    });

    it("response length tracks character count", () => {
      const a = fingerprint("hello");
      const b = fingerprint("hello world");
      expect(b.responseLength).toBeGreaterThan(a.responseLength);
    });

    it("sentence count detects multi-sentence text", () => {
      const a = fingerprint("Just one sentence.");
      const b = fingerprint("First. Second. Third.");
      expect(b.sentenceCount).toBeGreaterThan(a.sentenceCount);
    });

    it("hedge density rises with hedge words", () => {
      const a = fingerprint("The answer is 42.");
      const b = fingerprint("Maybe the answer is 42, perhaps. I think it could be 42, possibly.");
      expect(b.hedgeDensity).toBeGreaterThan(a.hedgeDensity);
    });

    it("absolute density rises with absolute words", () => {
      const a = fingerprint("Some users might do that sometimes.");
      const b = fingerprint("All users always do exactly that. Never do otherwise.");
      expect(b.absoluteDensity).toBeGreaterThan(a.absoluteDensity);
    });

    it("refusal density catches AI refusal markers", () => {
      const a = fingerprint("Here is the answer.");
      const b = fingerprint("I can't help with that. As an AI, I won't do that. I cannot proceed.");
      expect(b.refusalDensity).toBeGreaterThan(a.refusalDensity);
    });

    it("vocab entropy differs between repetitive and varied text", () => {
      const repetitive = fingerprint("the the the the the the the the");
      const varied = fingerprint("the quick brown fox jumps over a lazy dog");
      expect(varied.vocabEntropy).toBeGreaterThan(repetitive.vocabEntropy);
    });

    it("markdown density catches lists + headers", () => {
      const plain = fingerprint("Just plain text.");
      const md = fingerprint("# Heading\n\n- item one\n- item two\n- item three\n\n```code```");
      expect(md.markdownDensity).toBeGreaterThan(plain.markdownDensity);
    });

    it("handles empty + edge cases without throwing", () => {
      expect(() => fingerprint("")).not.toThrow();
      expect(() => fingerprint(" ")).not.toThrow();
      const fp = fingerprint("");
      expect(fp.responseLength).toBe(0);
    });
  });

  // ─── PROBE LEDGER ────────────────────────────────────────────────────

  describe("probe ledger", () => {
    it("recordProbe writes a signed row + listProbes reads back", () => {
      recordProbe(repo, { vendor: "claude", prompt: "What is 2+2?", response: "4." });
      const all = listProbes(repo, "claude");
      expect(all.length).toBe(1);
      expect(all[0]!.vendor).toBe("claude");
      expect(all[0]!.sig).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    });

    it("listProbes filters by vendor", () => {
      recordProbe(repo, { vendor: "claude", prompt: "x", response: "y" });
      recordProbe(repo, { vendor: "gpt", prompt: "x", response: "y" });
      expect(listProbes(repo, "claude").length).toBe(1);
      expect(listProbes(repo, "gpt").length).toBe(1);
      expect(listProbes(repo).length).toBe(2);
    });

    it("prompt is hashed (not stored) for privacy", () => {
      const r = recordProbe(repo, { vendor: "claude", prompt: "very secret API key abc123", response: "ok" });
      expect(r.promptSha).not.toContain("secret");
      expect(r.promptSha).toMatch(/^[a-f0-9]{32}$/);
    });

    it("verifyProbe confirms HMAC", () => {
      const r = recordProbe(repo, { vendor: "claude", prompt: "x", response: "y" });
      expect(verifyProbe(repo, r)).toBe(true);
    });

    it("verifyProbe rejects tampered record", () => {
      const r = recordProbe(repo, { vendor: "claude", prompt: "x", response: "y" });
      const tampered: ProbeRecord = { ...r, fp: { ...r.fp, responseLength: 9999 } };
      expect(verifyProbe(repo, tampered)).toBe(false);
    });
  });

  // ─── BASELINE ────────────────────────────────────────────────────────

  describe("baseline (rolling, fresh-excluded)", () => {
    it("returns null when no probes recorded", () => {
      expect(computeBaseline(repo, "claude")).toBeNull();
    });

    it("uses last N probes EXCLUDING the freshest M", () => {
      setConfig(repo, { baselineWindow: 5, baselineExcludeFresh: 2 });
      // Record 10 probes; baseline should use probes 4..8 (excluding last 2).
      for (let i = 0; i < 10; i++) {
        recordProbe(repo, { vendor: "claude", prompt: `q${i}`, response: `a${i}` });
      }
      const b = computeBaseline(repo, "claude")!;
      expect(b.totalProbes).toBe(10);
      expect(b.baselineProbes).toBe(5);
    });

    it("computes mean + stddev per dimension", () => {
      for (const text of ["a b c.", "d e f.", "g h i.", "j k l.", "m n o.", "p q r.", "s t u.", "v w x."]) {
        recordProbe(repo, { vendor: "claude", prompt: "x", response: text });
      }
      const b = computeBaseline(repo, "claude")!;
      expect(b.stats.responseLength.n).toBeGreaterThan(0);
      expect(b.stats.responseLength.mean).toBeGreaterThan(0);
    });
  });

  // ─── DRIFT DETECTION ─────────────────────────────────────────────────

  describe("drift detection", () => {
    it("INSUFFICIENT_DATA when too few baseline probes", async () => {
      recordProbe(repo, { vendor: "claude", prompt: "x", response: "y" });
      const r = await detectDrift(repo, "claude");
      expect(r.verdict).toBe("INSUFFICIENT_DATA");
    });

    it("STABLE when live probes match baseline distribution", async () => {
      setConfig(repo, { baselineWindow: 20, baselineExcludeFresh: 3 });
      // 25 probes of similar-shaped text → live looks like baseline.
      const base = "The answer is consistent. It does not change. Steady output here. The pattern holds.";
      for (let i = 0; i < 25; i++) {
        recordProbe(repo, { vendor: "claude", prompt: `q${i}`, response: base });
      }
      const r = await detectDrift(repo, "claude");
      expect(r.verdict).toBe("STABLE");
    });

    it("BROKEN when live probes diverge dramatically", async () => {
      setConfig(repo, { baselineWindow: 20, baselineExcludeFresh: 3 });
      // 22 short responses for baseline.
      const shortText = "Yes.";
      for (let i = 0; i < 22; i++) {
        recordProbe(repo, { vendor: "claude", prompt: `q${i}`, response: shortText });
      }
      // 3 wildly different responses for live (the freshest 3).
      const longRefusalText = "I can't help with that. As an AI, I cannot proceed. I won't do that. I'm not able to. I don't think so. This is a much longer response than the baseline with many hedge words like maybe, perhaps, possibly, and absolutes like never, always, exactly. " .repeat(3);
      for (let i = 0; i < 3; i++) {
        recordProbe(repo, { vendor: "claude", prompt: `q${i}-new`, response: longRefusalText });
      }
      const r = await detectDrift(repo, "claude");
      expect(["DRIFTING", "BROKEN"]).toContain(r.verdict);
      expect(r.maxZ).toBeGreaterThan(2);
    });

    it("zScores are per-dimension + only populate when baseline stddev > 0", async () => {
      setConfig(repo, { baselineWindow: 20, baselineExcludeFresh: 3 });
      for (let i = 0; i < 25; i++) {
        recordProbe(repo, { vendor: "claude", prompt: "x", response: "Sentence one. Sentence two. Sentence three." });
      }
      const r = await detectDrift(repo, "claude");
      // At least some dimensions should have a z-score (those with variance).
      expect(Object.keys(r.zScores).length).toBeGreaterThan(0);
    });
  });

  // ─── ORCHESTRATED PROBE (vendor-agnostic askFn) ───────────────────────

  describe("runProbe (askFn pattern)", () => {
    it("calls askFn + records + returns report", async () => {
      let called = false;
      const result = await runProbe(repo, {
        vendor: "claude",
        prompt: "say hi",
        ask: async (p) => { called = true; return "hi from claude — short."; },
      });
      expect(called).toBe(true);
      expect(result.record.vendor).toBe("claude");
      expect(result.report.vendor).toBe("claude");
    });

    it("appends to alerts.jsonl on DRIFTING or BROKEN", async () => {
      setConfig(repo, { baselineWindow: 20, baselineExcludeFresh: 3 });
      // 22 baseline probes.
      for (let i = 0; i < 22; i++) {
        recordProbe(repo, { vendor: "claude", prompt: `q${i}`, response: "Yes." });
      }
      // 3 stable-ish probes for fresh-exclusion.
      for (let i = 0; i < 2; i++) {
        recordProbe(repo, { vendor: "claude", prompt: "x", response: "Yes." });
      }
      // Run a wildly different probe.
      const longText = "I can't help. As an AI, I won't do that. " .repeat(20);
      await runProbe(repo, {
        vendor: "claude",
        prompt: "extra",
        ask: async () => longText,
      });
      const alerts = listAlerts(repo, "claude");
      expect(alerts.length).toBeGreaterThan(0);
    });
  });

  // ─── CONFIG ──────────────────────────────────────────────────────────

  describe("config + thresholds", () => {
    it("default thresholds applied + writable", () => {
      const cfg = getConfig(repo);
      expect(cfg.driftingZ).toBe(2.0);
      expect(cfg.brokenZ).toBe(3.5);
      const updated = setConfig(repo, { driftingZ: 1.5, brokenZ: 4.0 });
      expect(updated.driftingZ).toBe(1.5);
      expect(updated.brokenZ).toBe(4.0);
    });
  });

  // ─── FORMATTERS ──────────────────────────────────────────────────────

  describe("formatters", () => {
    it("formatFingerprint prints all 8 dims", () => {
      const fp = fingerprint("Hello world.");
      const out = formatFingerprint(fp);
      for (const dim of FINGERPRINT_DIMS) {
        expect(out).toContain(dim);
      }
    });

    it("formatBaseline shows mean + stddev table", () => {
      for (let i = 0; i < 10; i++) {
        recordProbe(repo, { vendor: "claude", prompt: "x", response: `Sentence ${i}.` });
      }
      const b = computeBaseline(repo, "claude")!;
      const out = formatBaseline(b);
      expect(out).toContain("BASELINE");
      expect(out).toContain("claude");
    });

    it("formatReport surfaces verdict + per-dim z-scores", async () => {
      for (let i = 0; i < 15; i++) {
        recordProbe(repo, { vendor: "claude", prompt: "x", response: "ok." });
      }
      const r = await detectDrift(repo, "claude");
      const out = formatReport(r);
      expect(out).toContain("DRIFT REPORT");
      expect(out).toContain(r.verdict);
    });
  });
});
