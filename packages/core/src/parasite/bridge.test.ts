import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectAgentTools, injectBridge, disinfectBridge, injectAll, KNOWN_AGENT_TOOLS } from "./bridge.js";

describe("parasite/bridge · detect", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-parasite-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("on a fresh repo, no tools detected", () => {
    const r = detectAgentTools(repo);
    expect(r.every((d) => !d.exists)).toBe(true);
  });

  it("detects .cursor/ when present", () => {
    mkdirSync(join(repo, ".cursor"), { recursive: true });
    const r = detectAgentTools(repo);
    const cursor = r.find((d) => d.tool.id === "cursor-rules");
    expect(cursor?.exists).toBe(true);
    expect(cursor?.injected).toBe(false);
  });

  it("detects AGENTS.md when present", () => {
    writeFileSync(join(repo, "AGENTS.md"), "# project agents");
    const r = detectAgentTools(repo);
    const codex = r.find((d) => d.tool.id === "codex");
    expect(codex?.exists).toBe(true);
  });
});

describe("parasite/bridge · inject", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-parasite-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("injects into existing AGENTS.md + sentinel-bracketed", () => {
    writeFileSync(join(repo, "AGENTS.md"), "# project agents\n\noriginal content here.\n");
    const r = injectBridge(repo, "codex", { mnemeVersion: "1.43.0" });
    expect(r.outcome).toBe("injected");
    const content = readFileSync(join(repo, "AGENTS.md"), "utf8");
    // The block is laundered for AUP-safety before write (PARASITE → COMPANION),
    // so the marker ON DISK is the COMPANION form.
    expect(content).toContain("MNEME COMPANION BRIDGE START");
    expect(content).toContain("MNEME COMPANION BRIDGE END");
    expect(content).toContain("original content here.");   // preserved
  });

  it("re-inject is idempotent → 'already-injected'", () => {
    writeFileSync(join(repo, "AGENTS.md"), "# project\n");
    injectBridge(repo, "codex", { mnemeVersion: "1.43.0" });
    const r2 = injectBridge(repo, "codex", { mnemeVersion: "1.43.0" });
    expect(r2.outcome).toBe("already-injected");
    const content = readFileSync(join(repo, "AGENTS.md"), "utf8");
    expect((content.match(/MNEME COMPANION BRIDGE START/g) ?? []).length).toBe(1);
  });

  it("creates .cursor/rules/mneme-bridge.mdc when .cursor/ exists but file doesn't (createIfMissing=true)", () => {
    mkdirSync(join(repo, ".cursor"), { recursive: true });
    const r = injectBridge(repo, "cursor-rules", { mnemeVersion: "1.43.0" });
    expect(r.outcome).toBe("injected");
    expect(existsSync(join(repo, ".cursor/rules/mneme-bridge.mdc"))).toBe(true);
  });

  it("refuses to inject when detect path missing → 'no-tool-detected'", () => {
    const r = injectBridge(repo, "codex", { mnemeVersion: "1.43.0" });
    expect(r.outcome).toBe("no-tool-detected");
  });

  it("refuses to create file when createIfMissing=false + file missing → 'config-missing'", () => {
    // .cursorrules doesn't exist; tool has createIfMissing=false
    // To hit this: detect path = config path = same file; we need detect to pass but config to be missing.
    // We achieve this by writing a placeholder detect file then deleting before inject.
    writeFileSync(join(repo, ".cursorrules"), "");
    rmSync(join(repo, ".cursorrules"));
    // No detect → "no-tool-detected" instead. The "config-missing" outcome happens for tools where detectPath ≠ configPath.
    // Use Continue.dev: detect=.continue dir, config=.continue/config.json. Make dir but no config file.
    mkdirSync(join(repo, ".continue"), { recursive: true });
    const r = injectBridge(repo, "continue", { mnemeVersion: "1.43.0" });
    expect(r.outcome).toBe("config-missing");
  });

  it("after disinfect, re-inject is BLOCKED unless ignoreUserOptOut=true", () => {
    writeFileSync(join(repo, "AGENTS.md"), "# project\n");
    injectBridge(repo, "codex", { mnemeVersion: "1.43.0" });
    disinfectBridge(repo, "codex");
    const blocked = injectBridge(repo, "codex", { mnemeVersion: "1.43.0" });
    expect(blocked.outcome).toBe("user-opted-out");
    const overridden = injectBridge(repo, "codex", { mnemeVersion: "1.43.0", ignoreUserOptOut: true });
    expect(overridden.outcome).toBe("injected");
  });
});

describe("parasite/bridge · disinfect", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-parasite-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("removes the bridge block + leaves surrounding content intact", () => {
    const original = "# project\n\noriginal content above.\n";
    const trailingContent = "\n\n## another section\n\noriginal content below.\n";
    writeFileSync(join(repo, "AGENTS.md"), original + trailingContent);
    injectBridge(repo, "codex", { mnemeVersion: "1.43.0" });
    const r = disinfectBridge(repo, "codex");
    expect(r.outcome).toBe("removed");
    const cleaned = readFileSync(join(repo, "AGENTS.md"), "utf8");
    expect(cleaned).not.toContain("MNEME COMPANION BRIDGE");
    expect(cleaned).not.toContain("MNEME PARASITE BRIDGE");
    expect(cleaned).toContain("original content above.");
    expect(cleaned).toContain("original content below.");
    expect(cleaned).toContain("## another section");
  });

  it("disinfect on never-injected tool → 'not-injected' (no error)", () => {
    writeFileSync(join(repo, "AGENTS.md"), "# project\n");
    const r = disinfectBridge(repo, "codex");
    expect(r.outcome).toBe("not-injected");
  });

  it("disinfect on missing config file → 'not-injected'", () => {
    expect(disinfectBridge(repo, "codex").outcome).toBe("not-injected");
  });

  it("refuses to corrupt file when END sentinel is missing", () => {
    writeFileSync(join(repo, "AGENTS.md"), "# project\n<!-- MNEME PARASITE BRIDGE START -->\nmissing end marker on purpose\n");
    const r = disinfectBridge(repo, "codex");
    expect(r.outcome).toBe("write-failed");
    expect(r.reason).toMatch(/END marker/i);
  });
});

describe("parasite/bridge · injectAll", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-parasite-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("injects into every detected tool + skips not-detected", () => {
    writeFileSync(join(repo, "AGENTS.md"), "# project\n");
    writeFileSync(join(repo, "GEMINI.md"), "# gemini\n");
    const results = injectAll(repo, { mnemeVersion: "1.43.0" });
    const injected = results.filter((r) => r.outcome === "injected");
    expect(injected.length).toBeGreaterThanOrEqual(2);
    expect(readFileSync(join(repo, "AGENTS.md"), "utf8")).toContain("MNEME COMPANION BRIDGE START");
    expect(readFileSync(join(repo, "GEMINI.md"), "utf8")).toContain("MNEME COMPANION BRIDGE START");
  });

  it("LEGACY: detects + disinfects an old raw-PARASITE block (backward compat)", () => {
    // a block written by a pre-v2.95 (unlaundered) Mneme uses the raw marker
    const legacy = "# project\n<!-- MNEME PARASITE BRIDGE START -->\nold bridge body\n<!-- MNEME PARASITE BRIDGE END -->\ntail\n";
    writeFileSync(join(repo, "AGENTS.md"), legacy);
    // re-inject must see it as already present (not duplicate it)
    expect(injectBridge(repo, "codex", { mnemeVersion: "1.43.0" }).outcome).toBe("already-injected");
    // and disinfect must remove the legacy block cleanly
    expect(disinfectBridge(repo, "codex").outcome).toBe("removed");
    const cleaned = readFileSync(join(repo, "AGENTS.md"), "utf8");
    expect(cleaned).not.toContain("MNEME PARASITE BRIDGE");
    expect(cleaned).toContain("tail");
  });
});
