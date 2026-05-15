import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  recordObservation, verifyObservation, detectPatterns,
  exportDigest, verifyDigest, ingestDigest,
  diagnose, formatInfraLine,
} from "./index.js";

describe("v2.14 · INFRA AS AI — host brain + gossip primitive", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "infra-")); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  describe("observations", () => {
    it("recordObservation appends signed entry", () => {
      const o = recordObservation({
        kind: "latency_outlier", subject: "auth-service",
        detail: "p99 spiked to 3.2s",
        metric: { name: "p99_latency_ms", value: 3200, unit: "ms" },
        repoDir: dir,
      });
      expect(o.id).toMatch(/^o-/);
      expect(o.sig).toMatch(/^[0-9a-f]{64}$/);
      expect(o.metric?.value).toBe(3200);
    });

    it("verifyObservation passes for un-tampered", () => {
      const o = recordObservation({ kind: "deploy", subject: "api", detail: "v2.13.1", repoDir: dir });
      expect(verifyObservation(o)).toBe(true);
    });

    it("verifyObservation fails on tamper", () => {
      const o = recordObservation({ kind: "deploy", subject: "api", detail: "v2.13.1", repoDir: dir });
      const tampered = { ...o, detail: "TAMPERED" };
      expect(verifyObservation(tampered)).toBe(false);
    });
  });

  describe("pattern detection", () => {
    it("detects recurring subject + kind", () => {
      for (let i = 0; i < 5; i++) {
        recordObservation({ kind: "cron_misfire", subject: "nightly-backup", detail: "missed run", repoDir: dir });
      }
      const patterns = detectPatterns({ repoDir: dir });
      const p = patterns.find((x) => x.subject === "nightly-backup");
      expect(p).toBeDefined();
      expect(p!.count).toBe(5);
    });

    it("ignores singletons by default", () => {
      recordObservation({ kind: "anomaly", subject: "thing-x", detail: "weird", repoDir: dir });
      const patterns = detectPatterns({ repoDir: dir });
      expect(patterns.find((x) => x.subject === "thing-x")).toBeUndefined();
    });

    it("estimates a window when timestamps cluster", () => {
      // Hand-craft 4 observations all at ~15:00 UTC
      const now = new Date();
      now.setUTCHours(15, 0, 0, 0);
      for (let day = 0; day < 4; day++) {
        const ts = new Date(now.getTime() - day * 7 * 24 * 60 * 60 * 1000).toISOString();
        // Use the file directly to inject a custom timestamp
        const fs = require("node:fs");
        const path = require("node:path").join(dir, ".mneme", "infra", "observations.jsonl");
        // Bootstrap by writing one normal entry first
        if (day === 0) recordObservation({ kind: "deploy", subject: "x", detail: "y", repoDir: dir });
        const lines = fs.readFileSync(path, "utf8").trim().split("\n");
        // Append synthetic
        const obs = JSON.parse(lines[0]);
        const synthetic = { ...obs, id: "o-syn" + day, ts, subject: "deploy-3pm" };
        fs.appendFileSync(path, JSON.stringify(synthetic) + "\n");
      }
      const patterns = detectPatterns({ repoDir: dir });
      const p = patterns.find((x) => x.subject === "deploy-3pm");
      expect(p?.window).toBeDefined();
      expect(p!.window).toMatch(/15:00 UTC/);
    });
  });

  describe("gossip / digest", () => {
    it("exportDigest produces signed digest", () => {
      for (let i = 0; i < 3; i++) recordObservation({ kind: "error_spike", subject: "api", detail: "5xx burst", repoDir: dir });
      const d = exportDigest({ repoDir: dir });
      expect(d.observationCount).toBe(3);
      expect(d.sig).toMatch(/^[0-9a-f]{64}$/);
    });

    it("verifyDigest passes for un-tampered", () => {
      const d = exportDigest({ repoDir: dir });
      expect(verifyDigest(d)).toBe(true);
    });

    it("verifyDigest fails on tamper", () => {
      const d = exportDigest({ repoDir: dir });
      const tampered = { ...d, host: "FORGED" };
      expect(verifyDigest(tampered)).toBe(false);
    });

    it("ingestDigest learns patterns from a peer", () => {
      // Build digest in dir1
      const dir1 = mkdtempSync(join(tmpdir(), "infra1-"));
      try {
        for (let i = 0; i < 3; i++) recordObservation({ kind: "error_spike", subject: "billing-service", detail: "5xx", repoDir: dir1 });
        const d = exportDigest({ repoDir: dir1 });
        // Ingest into our dir (different host)
        const r = ingestDigest(d, { repoDir: dir });
        expect(r.accepted).toBe(true);
        expect(r.patternsLearned).toBeGreaterThan(0);
        // Should have appended observations tagged from:peer
        const patterns = detectPatterns({ repoDir: dir });
        // Pattern detection requires ≥2 occurrences but ingest only adds 1 synthetic per pattern.
        // So we check the underlying observations file directly:
        const fs = require("node:fs");
        const path = require("node:path").join(dir, ".mneme", "infra", "observations.jsonl");
        const content = fs.readFileSync(path, "utf8");
        expect(content).toContain("[peer:");
        expect(content).toContain("billing-service");
      } finally { rmSync(dir1, { recursive: true, force: true }); }
    });

    it("ingestDigest rejects unverified peer", () => {
      const d = exportDigest({ repoDir: dir });
      const tampered = { ...d, host: "FORGED" };
      const r = ingestDigest(tampered, { repoDir: dir });
      expect(r.accepted).toBe(false);
      expect(r.reason).toContain("sig mismatch");
    });
  });

  describe("diagnose", () => {
    it("matches similar past observations", () => {
      recordObservation({ kind: "error_spike", subject: "auth-service", detail: "JWT verification timing out under load", repoDir: dir });
      recordObservation({ kind: "deploy", subject: "auth-service", detail: "rolled back v3.2.1", repoDir: dir });
      const r = diagnose({ subject: "auth-service", detail: "JWT verification slow under load", repoDir: dir });
      expect(r.hypotheses.length).toBeGreaterThan(0);
      expect(r.hypotheses[0]!.similarity).toBeGreaterThan(0);
    });

    it("flags recurring patterns", () => {
      for (let i = 0; i < 4; i++) {
        recordObservation({ kind: "cron_misfire", subject: "nightly-backup", detail: "missed run", repoDir: dir });
      }
      const r = diagnose({ subject: "nightly-backup", detail: "no backup last night", repoDir: dir });
      expect(r.recurring).not.toBeNull();
      expect(r.recurring!.count).toBe(4);
      expect(r.rationale.some((s) => s.includes("recurred"))).toBe(true);
    });

    it("novel symptom rationale is honest", () => {
      const r = diagnose({ subject: "totally-new-thing", detail: "never seen", repoDir: dir });
      expect(r.hypotheses).toHaveLength(0);
      expect(r.rationale[0]).toContain("novel");
    });
  });

  it("formatInfraLine summarises", () => {
    recordObservation({ kind: "deploy", subject: "x", detail: "y", repoDir: dir });
    const line = formatInfraLine({ repoDir: dir });
    expect(line).toContain("INFRA");
    expect(line).toContain("1 obs");
  });
});
