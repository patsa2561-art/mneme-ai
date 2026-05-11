import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyEmbedderName, tierInfo, tierBadge,
  readMemoryTier, tierWarningForPulse,
} from "./memory_tier.js";

describe("memory_tier", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-tier-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  describe("classifyEmbedderName", () => {
    it("maps OpenAI variants to 'openai'", () => {
      expect(classifyEmbedderName("openai-text-embedding-3-small")).toBe("openai");
      expect(classifyEmbedderName("text-embedding-ada-002")).toBe("openai");
    });
    it("maps Ollama variants to 'ollama'", () => {
      expect(classifyEmbedderName("ollama-nomic-embed-text")).toBe("ollama");
      expect(classifyEmbedderName("mxbai-embed-large")).toBe("ollama");
    });
    it("maps bundled/Xenova/MiniLM to 'bundled'", () => {
      expect(classifyEmbedderName("bundled-Xenova-all-MiniLM-L6-v2")).toBe("bundled");
      expect(classifyEmbedderName("Xenova/all-MiniLM-L6-v2")).toBe("bundled");
    });
    it("maps hash variants to 'hash'", () => {
      expect(classifyEmbedderName("hash")).toBe("hash");
      expect(classifyEmbedderName("hash-trick")).toBe("hash");
    });
    it("maps unknown / null / undefined to 'unknown'", () => {
      expect(classifyEmbedderName(null)).toBe("unknown");
      expect(classifyEmbedderName(undefined)).toBe("unknown");
      expect(classifyEmbedderName("some-weird-thing")).toBe("unknown");
    });
  });

  describe("tierInfo + tierBadge", () => {
    it("openai is 5 stars + semantic", () => {
      const t = tierInfo("openai");
      expect(t.stars).toBe(5);
      expect(t.semantic).toBe(true);
      expect(t.quality).toBe("excellent");
    });
    it("hash is 2 stars + NOT semantic + degraded", () => {
      const t = tierInfo("hash");
      expect(t.stars).toBe(2);
      expect(t.semantic).toBe(false);
      expect(t.quality).toBe("degraded");
    });
    it("tierBadge renders stars consistently", () => {
      expect(tierBadge("hash")).toContain("★★");
      expect(tierBadge("hash")).toContain("☆");
      expect(tierBadge("openai")).toContain("★★★★★");
    });
  });

  describe("readMemoryTier", () => {
    it("returns 'unknown' when no .mneme/store/meta.json exists", () => {
      const t = readMemoryTier(repo);
      expect(t.name).toBe("unknown");
    });
    it("reads tier from .mneme/store/meta.json", () => {
      mkdirSync(join(repo, ".mneme/store"), { recursive: true });
      writeFileSync(
        join(repo, ".mneme/store/meta.json"),
        JSON.stringify({ embedder: "bundled-Xenova-all-MiniLM-L6-v2" }),
        "utf8",
      );
      const t = readMemoryTier(repo);
      expect(t.name).toBe("bundled");
      expect(t.semantic).toBe(true);
    });
    it("falls back to .mneme/meta.json (alternate location)", () => {
      mkdirSync(join(repo, ".mneme"), { recursive: true });
      writeFileSync(
        join(repo, ".mneme/meta.json"),
        JSON.stringify({ embedder: "hash" }),
        "utf8",
      );
      const t = readMemoryTier(repo);
      expect(t.name).toBe("hash");
    });
    it("survives malformed JSON without throwing", () => {
      mkdirSync(join(repo, ".mneme/store"), { recursive: true });
      writeFileSync(join(repo, ".mneme/store/meta.json"), "{not json", "utf8");
      const t = readMemoryTier(repo);
      expect(t.name).toBe("unknown");
    });
  });

  describe("tierWarningForPulse", () => {
    it("returns null when tier is bundled (no warning)", () => {
      mkdirSync(join(repo, ".mneme/store"), { recursive: true });
      writeFileSync(
        join(repo, ".mneme/store/meta.json"),
        JSON.stringify({ embedder: "bundled-Xenova-all-MiniLM-L6-v2" }),
        "utf8",
      );
      expect(tierWarningForPulse(repo)).toBeNull();
    });
    it("returns warning + remedy when tier is hash (degraded)", () => {
      mkdirSync(join(repo, ".mneme/store"), { recursive: true });
      writeFileSync(
        join(repo, ".mneme/store/meta.json"),
        JSON.stringify({ embedder: "hash" }),
        "utf8",
      );
      const w = tierWarningForPulse(repo);
      expect(w).not.toBeNull();
      expect(w!.text).toContain("HASH tier");
      expect(w!.text).toContain("DEGRADED");
      expect(w!.remedy).toContain("mneme embeddings upgrade");
    });
    it("returns null when no index has run yet (unknown tier)", () => {
      expect(tierWarningForPulse(repo)).toBeNull();
    });
  });
});
