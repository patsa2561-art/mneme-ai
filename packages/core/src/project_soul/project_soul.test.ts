import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  newSoul, addRule, verifySoul, saveSoul, loadSoul, checkAgainstSoul,
  formatSoulLine, seedDefaultRules,
} from "./index.js";

describe("v2.14 · PROJECT SOUL — HMAC-signed project values", () => {
  it("newSoul produces a valid signed manifest with zero rules", () => {
    const s = newSoul("mneme", "memory layer that doesn't lie");
    expect(s.project).toBe("mneme");
    expect(s.ruleCount).toBe(0);
    expect(s.soulSig).toMatch(/^[0-9a-f]{64}$/);
    expect(verifySoul(s).ok).toBe(true);
  });

  it("addRule preserves signature chain", () => {
    let s = newSoul("mneme", "test");
    s = addRule(s, { category: "antiPatterns", id: "no-redux", text: "We never use Redux; useReducer is enough.", severity: "block" });
    expect(s.antiPatterns).toHaveLength(1);
    expect(s.ruleCount).toBe(1);
    expect(verifySoul(s).ok).toBe(true);
  });

  it("duplicate rule id is rejected", () => {
    let s = newSoul("mneme", "test");
    s = addRule(s, { category: "values", id: "dup", text: "first" });
    expect(() => addRule(s, { category: "values", id: "dup", text: "second" })).toThrow();
  });

  it("tampering with the manifest breaks verifySoul", () => {
    let s = newSoul("mneme", "test");
    s = addRule(s, { category: "values", id: "v1", text: "value one" });
    // Mutate the rule text directly — sig should mismatch
    const tampered = { ...s, values: [{ ...s.values[0]!, text: "value one TAMPERED" }] };
    expect(verifySoul(tampered).ok).toBe(false);
  });

  it("wrong secret fails verification", () => {
    let s = newSoul("mneme", "test", { secret: "right" });
    s = addRule(s, { category: "values", id: "v1", text: "value one", secret: "right" });
    expect(verifySoul(s, "wrong").ok).toBe(false);
    expect(verifySoul(s, "right").ok).toBe(true);
  });

  it("save / load round-trip preserves verification", () => {
    const dir = mkdtempSync(join(tmpdir(), "soul-"));
    try {
      let s = newSoul("mneme", "test");
      s = addRule(s, { category: "scars", id: "tue-3pm-deploy", text: "Tuesday 3pm deploys fail.", scarFrom: "incident-2024-11-12", severity: "block" });
      const path = saveSoul(s, { repoDir: dir });
      expect(path).toContain(".mneme");
      const loaded = loadSoul({ repoDir: dir });
      expect(loaded).not.toBeNull();
      expect(verifySoul(loaded!).ok).toBe(true);
      expect(loaded!.scars).toHaveLength(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("loadSoul returns null when no file present", () => {
    const dir = mkdtempSync(join(tmpdir(), "soul-empty-"));
    try {
      expect(loadSoul({ repoDir: dir })).toBeNull();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("SOUL GATE: change with no matches → PASS", () => {
    let s = newSoul("mneme", "test");
    s = addRule(s, { category: "antiPatterns", id: "no-redux", text: "Never add redux toolkit", severity: "block" });
    const v = checkAgainstSoul(s, { description: "Add new logging helper using bunyan", files: ["src/log.ts"] });
    expect(v.verdict).toBe("PASS");
    expect(v.findings).toHaveLength(0);
    expect(v.sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("SOUL GATE: change matching block rule → BLOCK", () => {
    let s = newSoul("mneme", "test");
    s = addRule(s, { category: "antiPatterns", id: "no-redux", text: "Never add redux toolkit", severity: "block" });
    const v = checkAgainstSoul(s, { description: "Add redux for global state", addsDeps: ["@reduxjs/toolkit"] });
    expect(v.verdict).toBe("BLOCK");
    expect(v.findings).toHaveLength(1);
    expect(v.findings[0]!.severity).toBe("block");
  });

  it("SOUL GATE: change matching warn rule → WARN", () => {
    let s = newSoul("mneme", "test");
    s = addRule(s, { category: "antiPatterns", id: "avoid-lodash", text: "Prefer native over lodash dependency.", severity: "warn" });
    const v = checkAgainstSoul(s, { description: "Replace shim with lodash", addsDeps: ["lodash"] });
    expect(v.verdict).toBe("WARN");
  });

  it("SOUL GATE: values/conventions match → downgraded to warn", () => {
    let s = newSoul("mneme", "test");
    s = addRule(s, { category: "values", id: "utc-only", text: "Use UTC timestamps everywhere", severity: "block" });
    const v = checkAgainstSoul(s, { description: "Save event timestamps as local datetime" });
    // Even though rule says block, values are advisory
    expect(v.findings[0]?.severity).toBe("warn");
    expect(v.verdict).toBe("WARN");
  });

  it("SOUL GATE: sacred file touch → BLOCK", () => {
    let s = newSoul("mneme", "test");
    s = addRule(s, { category: "sacred", id: "no-touch-mneme-config", text: ".mneme/ directory is sacred — do not modify config files.", severity: "block" });
    const v = checkAgainstSoul(s, { description: "Update memory store config", files: [".mneme/config.json"] });
    expect(v.verdict).toBe("BLOCK");
  });

  it("seedDefaultRules adds protective starter rules", () => {
    let s = newSoul("mneme", "test");
    s = seedDefaultRules(s);
    expect(s.antiPatterns.some((r) => r.id === "no-fake-files")).toBe(true);
    expect(s.antiPatterns.some((r) => r.id === "no-secret-leak")).toBe(true);
    expect(s.sacred.some((r) => r.id === "no-touch-mneme-config")).toBe(true);
    expect(verifySoul(s).ok).toBe(true);
  });

  it("seedDefaultRules is idempotent", () => {
    let s = newSoul("mneme", "test");
    s = seedDefaultRules(s);
    const before = s.ruleCount;
    s = seedDefaultRules(s);
    expect(s.ruleCount).toBe(before);
  });

  it("formatSoulLine summarises", () => {
    expect(formatSoulLine(null)).toContain("not initialised");
    const s = seedDefaultRules(newSoul("mneme", "x"));
    const line = formatSoulLine(s);
    expect(line).toContain("SOUL");
    expect(line).toContain("rules");
  });
});
