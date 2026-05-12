/**
 * v1.65.1 -- Embedder autodiagnose tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { autodiagnose, currentTierInfo } from "./embedder_autodiagnose.js";

function setup(): string { return mkdtempSync(join(tmpdir(), "mneme-autodiag-")); }
function cleanup(r: string) { try { rmSync(r, { recursive: true, force: true }); } catch { /* */ } }

function writeConfig(r: string, provider: string) {
  mkdirSync(join(r, ".mneme"), { recursive: true });
  writeFileSync(join(r, ".mneme/config.json"), JSON.stringify({
    schemaVersion: 1,
    embeddings: { provider, model: "Xenova/all-MiniLM-L6-v2" },
  }, null, 2), "utf8");
}

describe("v1.65.1 EmbedderAutodiagnose", () => {
  let r: string;
  beforeEach(() => { r = setup(); });
  afterEach(() => cleanup(r));

  it("reports gap when config says hash but bundled is available", async () => {
    writeConfig(r, "hash");
    const report = await autodiagnose(r, { skipOllama: true });
    expect(report.currentTier).toBe("hash");
    // Bundled is reachable from this test environment (transformers installed).
    expect(["bundled", "openai"]).toContain(report.bestAvailable);
    expect(report.hasUpgrade).toBe(true);
    expect(report.recommendation).not.toBeNull();
    expect(report.recommendation?.action).toBe("switch-to");
  });

  it("reports no upgrade when already on best available", async () => {
    writeConfig(r, "bundled");
    const report = await autodiagnose(r, { skipOllama: true });
    // If OPENAI_API_KEY is set in test env, bundled could be below best; allow either.
    if (process.env["OPENAI_API_KEY"]) {
      expect(report.hasUpgrade).toBe(true);
    } else {
      expect(report.hasUpgrade).toBe(false);
      expect(report.recommendation).toBeNull();
    }
  });

  it("persist=true rewrites config to bestAvailable", async () => {
    writeConfig(r, "hash");
    const report = await autodiagnose(r, { skipOllama: true, persist: true });
    expect(report.configPathWritten).toBeTruthy();
    const updated = JSON.parse(readFileSync(join(r, ".mneme/config.json"), "utf8")) as { embeddings?: { provider?: string } };
    expect(updated.embeddings?.provider).toBe(report.bestAvailable);
  });

  it("persist=false leaves config untouched even when upgrade exists", async () => {
    writeConfig(r, "hash");
    const report = await autodiagnose(r, { skipOllama: true, persist: false });
    expect(report.configPathWritten).toBeNull();
    const after = JSON.parse(readFileSync(join(r, ".mneme/config.json"), "utf8")) as { embeddings?: { provider?: string } };
    expect(after.embeddings?.provider).toBe("hash");
  });

  it("skipBundled + skipOllama falls back to hash baseline", async () => {
    writeConfig(r, "hash");
    const report = await autodiagnose(r, { skipOllama: true, skipBundled: true });
    if (!process.env["OPENAI_API_KEY"]) {
      expect(report.bestAvailable).toBe("hash");
      expect(report.hasUpgrade).toBe(false);
    }
  });

  it("returns probes for each candidate tier", async () => {
    writeConfig(r, "hash");
    const report = await autodiagnose(r, { skipOllama: true });
    const tiers = report.probes.map((p) => p.tier);
    expect(tiers).toContain("openai");
    expect(tiers).toContain("bundled");
    expect(tiers).toContain("hash");
  });

  it("currentTierInfo reads from config", () => {
    writeConfig(r, "bundled");
    const info = currentTierInfo(r);
    expect(info.name).toBe("bundled");
    expect(info.semantic).toBe(true);
  });

  it("currentTierInfo returns unknown when no config", () => {
    const info = currentTierInfo(r);
    expect(info.name).toBe("unknown");
  });

  it("headline mentions upgrade when one exists", async () => {
    writeConfig(r, "hash");
    const report = await autodiagnose(r, { skipOllama: true });
    if (report.hasUpgrade) {
      expect(report.headline.toLowerCase()).toContain("upgrade");
    }
  });

  it("hash tier always available as floor", async () => {
    writeConfig(r, "hash");
    const report = await autodiagnose(r, { skipOllama: true, skipBundled: true });
    const hashProbe = report.probes.find((p) => p.tier === "hash");
    expect(hashProbe?.available).toBe(true);
  });
});
