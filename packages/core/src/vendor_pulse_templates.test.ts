import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureRegistry, pickTemplate, setTemplate, applyTemplate, listTemplates, renderTemplateBlock } from "./vendor_pulse_templates.js";

describe("vendor_pulse_templates · registry + selection", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-tpl-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("ensureRegistry seeds the registry file with built-in defaults", () => {
    const reg = ensureRegistry(repo);
    expect(reg.length).toBeGreaterThan(0);
    expect(existsSync(join(repo, ".mneme/vendor-pulse-templates.json"))).toBe(true);
  });

  it("pickTemplate returns the exact-match template when one exists", () => {
    const t = pickTemplate(repo, "claude-opus-4-7");
    expect(t.vendor).toBe("claude-opus-4-7");
    expect(t.layout).toBe("action-first");
    expect(t.duplicateActionAtTop).toBe(true);
  });

  it("pickTemplate falls back to default for unknown vendors", () => {
    const t = pickTemplate(repo, "totally-unknown-vendor-xyz");
    expect(t.vendor).toBe("default");
    expect(t.layout).toBe("default");
  });

  it("setTemplate persists a custom override", () => {
    setTemplate(repo, { vendor: "custom-v", layout: "terse", maxChars: 500, duplicateActionAtTop: false, rationale: "test" });
    const t = pickTemplate(repo, "custom-v");
    expect(t.layout).toBe("terse");
    expect(t.maxChars).toBe(500);
  });

  it("applyTemplate with action-first layout reorders AUTO-ACTION lines to the top", () => {
    const body = [
      "[MNEME PULSE]",
      "v1.42.0 daemon=running",
      "[INFO] inbox=2",
      "[AUTO-ACTION] mneme.system.upgrade",
      "  -> EXECUTE NOW: mneme.system.upgrade({\"force\":true})",
      "[/MNEME PULSE]",
    ].join("\n");
    const tpl = pickTemplate(repo, "claude-opus-4-7");
    const out = applyTemplate(body, tpl);
    const actionIdx = out.indexOf("AUTO-ACTION");
    const infoIdx = out.indexOf("[INFO]");
    expect(actionIdx).toBeLessThan(infoIdx);
  });

  it("applyTemplate with action-last layout pushes AUTO-ACTION lines to the bottom", () => {
    setTemplate(repo, { vendor: "v", layout: "action-last", maxChars: 2000, duplicateActionAtTop: false, rationale: "" });
    const body = [
      "[AUTO-ACTION] mneme.x",
      "[INFO] background",
    ].join("\n");
    const out = applyTemplate(body, pickTemplate(repo, "v"));
    const actionIdx = out.indexOf("AUTO-ACTION");
    const infoIdx = out.indexOf("[INFO]");
    expect(actionIdx).toBeGreaterThan(infoIdx);
  });

  it("applyTemplate clamps to maxChars when body is too long", () => {
    setTemplate(repo, { vendor: "v", layout: "default", maxChars: 100, duplicateActionAtTop: false, rationale: "" });
    const body = "x".repeat(500);
    const out = applyTemplate(body, pickTemplate(repo, "v"));
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out).toContain("truncated");
  });

  it("listTemplates returns every template in the registry", () => {
    const all = listTemplates(repo);
    expect(all.length).toBeGreaterThanOrEqual(4); // built-ins
  });

  it("renderTemplateBlock outputs a single-line summary", () => {
    const block = renderTemplateBlock(repo, "claude-opus-4-7");
    expect(block).toContain("TEMPLATE");
    expect(block).toContain("claude-opus-4-7");
    expect(block).toContain("layout=action-first");
  });
});
