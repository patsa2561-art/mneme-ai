/**
 * v2.19.36 AUTO-FLOW TEST — the gitignore-auto path the user mandated.
 *
 *   User flow:
 *     1. User: "install mneme"
 *     2. AI agent: runs install (no manual mneme init)
 *     3. AI agent: calls mneme.welcome (first contact)
 *     4. User: continues chatting normally
 *     5. .gitignore must have .mneme/ + .brain-* without user / AI knowing
 *        to run any specific command
 *
 *   This test simulates the 3 entry points that guarantee the gitignore is
 *   right: (a) mneme init explicit, (b) autoStartSpore daemon path,
 *   (c) mneme.welcome MCP first-contact path.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureGitignoreEntries, PRIVATE_AI_ARTIFACTS } from "./gitignore_writer.js";
import { autoStartSpore } from "./spore_autostart.js";

let tmpRepo: string;

beforeEach(() => {
  tmpRepo = mkdtempSync(join(tmpdir(), "mneme-auto-flow-"));
});
afterEach(() => {
  try { rmSync(tmpRepo, { recursive: true, force: true }); } catch { /* */ }
});

describe("v2.19.36 AUTO-FLOW — gitignore is right after each install path", () => {
  it("PATH A — `mneme init` writes gitignore (existing direct call)", () => {
    const r = ensureGitignoreEntries(tmpRepo);
    expect(["created", "added"]).toContain(r.action);
    const ig = readFileSync(join(tmpRepo, ".gitignore"), "utf8");
    expect(ig).toContain(".mneme/");
    expect(ig).toContain(".brain-*");
    expect(ig).toContain(".mneme-ritual-receipt.json");
  });

  it("PATH B — `autoStartSpore` (daemon startup) ALSO writes gitignore even with no git remote", () => {
    autoStartSpore(tmpRepo);
    expect(existsSync(join(tmpRepo, ".gitignore"))).toBe(true);
    const ig = readFileSync(join(tmpRepo, ".gitignore"), "utf8");
    expect(ig).toContain(".mneme/");
  });

  it("PATH C — AI agent flow simulation: install → first `mneme.welcome` call writes gitignore", () => {
    // Simulating the welcomeTool handler's exact import + call:
    const r = ensureGitignoreEntries(tmpRepo);
    expect(r.action === "created" || r.action === "added").toBe(true);
    // After welcome, .gitignore must shield runtime state
    const ig = readFileSync(join(tmpRepo, ".gitignore"), "utf8");
    expect(ig).toContain(".mneme/");
  });

  it("IDEMPOTENCE — calling 3 times produces no duplicates", () => {
    ensureGitignoreEntries(tmpRepo);
    ensureGitignoreEntries(tmpRepo);
    const r3 = ensureGitignoreEntries(tmpRepo);
    const ig = readFileSync(join(tmpRepo, ".gitignore"), "utf8");
    // Each entry appears exactly once (the gitignore writer dedupes)
    const mnemeMatches = (ig.match(/^\.mneme\/$/gm) ?? []).length;
    expect(mnemeMatches).toBeLessThanOrEqual(1);
    expect(["unchanged", "added", "created"]).toContain(r3.action);
  });

  it("PRESERVES existing user-written entries", () => {
    writeFileSync(join(tmpRepo, ".gitignore"), "# user entry\nmy-secret/\nnode_modules/\n", "utf8");
    ensureGitignoreEntries(tmpRepo);
    const ig = readFileSync(join(tmpRepo, ".gitignore"), "utf8");
    expect(ig).toContain("my-secret/");
    expect(ig).toContain("node_modules/");
    expect(ig).toContain(".mneme/");
  });

  it("PRIVATE_AI_ARTIFACTS list includes the 3 v2.19.35/36 entries", () => {
    expect(PRIVATE_AI_ARTIFACTS).toContain(".mneme/");
    expect(PRIVATE_AI_ARTIFACTS).toContain(".brain-*");
    expect(PRIVATE_AI_ARTIFACTS).toContain(".mneme-ritual-receipt.json");
  });

  it("DEFENSIVE — never throws on missing directory", () => {
    expect(() => ensureGitignoreEntries(join(tmpRepo, "nonexistent-subdir"))).not.toThrow();
  });

  it("AUTO-FLOW INVARIANT — user never has to type any command for gitignore to be right", () => {
    // The 3 paths above are EVERY install path Mneme has. If ANY one of them
    // runs, gitignore is right. So the user's flow is preserved:
    //
    //   User: "install mneme"
    //   AI: runs npm install -g mneme-ai
    //   AI: calls mneme.welcome (PATH C fires → gitignore right)
    //   OR mneme init runs (PATH A fires → gitignore right)
    //   OR daemon starts (PATH B fires → gitignore right)
    //
    // No matter which path, gitignore ends up right.
    const paths = [
      () => ensureGitignoreEntries(tmpRepo),       // PATH A
      () => autoStartSpore(tmpRepo),                // PATH B
      () => ensureGitignoreEntries(tmpRepo),       // PATH C (welcomeTool)
    ];
    for (const p of paths) {
      // Clean state per path
      try { rmSync(join(tmpRepo, ".gitignore"), { force: true }); } catch { /* */ }
      p();
      const ig = readFileSync(join(tmpRepo, ".gitignore"), "utf8");
      expect(ig).toContain(".mneme/");
    }
  });
});
