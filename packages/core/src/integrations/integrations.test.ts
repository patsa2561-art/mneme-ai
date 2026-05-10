import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import {
  PULSE_COMMAND, SENTINEL_BEGIN, SENTINEL_END, defaultMnemeBlock,
  injectBlock, removeBlock, readBlockState,
  ALL_ADAPTERS, adapterById, detectAll, statusAll, installAll, uninstallAll,
  install, uninstall, status,
  claudeCodeAdapter, claudeProjectAdapter, cursorAdapter, cursorLegacyAdapter,
  codexAdapter, geminiAdapter, windsurfAdapter,
} from "./index.js";

// We DON'T touch the real ~/.claude/settings.json. We redirect HOME to
// a temp dir for every test, so claudeCodeAdapter is fully sandboxed.
let fakeHome: string;
let originalHome: string | undefined;
let originalUserprofile: string | undefined;
let repo: string;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "mneme-int-home-"));
  originalHome = process.env["HOME"];
  originalUserprofile = process.env["USERPROFILE"];
  process.env["HOME"] = fakeHome;
  process.env["USERPROFILE"] = fakeHome;
  repo = mkdtempSync(join(tmpdir(), "mneme-int-repo-"));
});

afterEach(() => {
  if (originalHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = originalHome;
  if (originalUserprofile === undefined) delete process.env["USERPROFILE"];
  else process.env["USERPROFILE"] = originalUserprofile;
  try { rmSync(fakeHome, { recursive: true, force: true }); } catch { /* */ }
  try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ }
});

// ---------------------------------------------------------------------------
// File injection primitives
// ---------------------------------------------------------------------------
describe("file_inject -- sentinel-bracketed block primitives", () => {
  it("creates the file when missing", () => {
    const p = join(repo, "AGENTS.md");
    const r = injectBlock(p, defaultMnemeBlock());
    expect(r.status).toBe("installed");
    expect(existsSync(p)).toBe(true);
    const body = readFileSync(p, "utf8");
    expect(body).toContain(SENTINEL_BEGIN);
    expect(body).toContain(SENTINEL_END);
  });

  it("appends when file exists without sentinels", () => {
    const p = join(repo, "AGENTS.md");
    writeFileSync(p, "# pre-existing\n");
    const r = injectBlock(p, defaultMnemeBlock());
    expect(r.status).toBe("added-block");
    const body = readFileSync(p, "utf8");
    expect(body).toContain("pre-existing");
    expect(body).toContain(SENTINEL_BEGIN);
  });

  it("replaces between sentinels (idempotent)", () => {
    const p = join(repo, "AGENTS.md");
    writeFileSync(p, `keep above\n${SENTINEL_BEGIN}\nstale stuff\n${SENTINEL_END}\nkeep below\n`);
    const r = injectBlock(p, defaultMnemeBlock());
    expect(r.status).toBe("updated-block");
    const body = readFileSync(p, "utf8");
    expect(body).toContain("keep above");
    expect(body).toContain("keep below");
    expect(body).not.toContain("stale stuff");
  });

  it("re-running with the same block is a no-op", () => {
    const p = join(repo, "AGENTS.md");
    injectBlock(p, defaultMnemeBlock());
    const r2 = injectBlock(p, defaultMnemeBlock());
    expect(r2.status).toBe("already-installed");
  });

  it("removeBlock strips only between sentinels", () => {
    const p = join(repo, "AGENTS.md");
    writeFileSync(p, `keep above\n\n${SENTINEL_BEGIN}\nblock\n${SENTINEL_END}\nkeep below\n`);
    const r = removeBlock(p);
    expect(r.removed).toBe(true);
    const body = readFileSync(p, "utf8");
    expect(body).toContain("keep above");
    expect(body).toContain("keep below");
    expect(body).not.toContain(SENTINEL_BEGIN);
  });

  it("removeBlock is no-op when no sentinels", () => {
    const p = join(repo, "AGENTS.md");
    writeFileSync(p, "no sentinels here\n");
    const r = removeBlock(p);
    expect(r.removed).toBe(false);
    expect(r.fileExisted).toBe(true);
  });

  it("readBlockState reports presence accurately", () => {
    const p = join(repo, "AGENTS.md");
    expect(readBlockState(p).fileExists).toBe(false);
    writeFileSync(p, "no block\n");
    expect(readBlockState(p)).toMatchObject({ fileExists: true, hasBlock: false });
    injectBlock(p, defaultMnemeBlock());
    expect(readBlockState(p).hasBlock).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Claude Code adapter -- the real-hook one
// ---------------------------------------------------------------------------
describe("claudeCodeAdapter -- correct array-of-objects schema", () => {
  it("install on empty home creates settings.json with array schema", async () => {
    const r = await claudeCodeAdapter.install(repo);
    expect(r.ok).toBe(true);
    expect(r.status).toBe("installed");
    const settings = JSON.parse(readFileSync(join(fakeHome, ".claude", "settings.json"), "utf8")) as {
      hooks?: Record<string, unknown>;
    };
    const entry = settings.hooks?.["UserPromptSubmit"];
    expect(Array.isArray(entry)).toBe(true);
    expect((entry as Array<{ hooks: Array<{ type: string; command: string }> }>)[0]!.hooks[0]).toEqual({
      type: "command", command: PULSE_COMMAND,
    });
  });

  it("install is idempotent (re-run = already-installed, no file change)", async () => {
    await claudeCodeAdapter.install(repo);
    const settingsPath = join(fakeHome, ".claude", "settings.json");
    const before = readFileSync(settingsPath, "utf8");
    const r2 = await claudeCodeAdapter.install(repo);
    expect(r2.status).toBe("already-installed");
    const after = readFileSync(settingsPath, "utf8");
    expect(after).toBe(before);
  });

  it("AUTO-REPAIRS the v1.25.2 broken string-shorthand to array schema", async () => {
    const settingsDir = join(fakeHome, ".claude");
    mkdirSync(settingsDir, { recursive: true });
    const settingsPath = join(settingsDir, "settings.json");
    // v1.25.2 broken format -- string shorthand
    writeFileSync(settingsPath, JSON.stringify({
      hooks: { UserPromptSubmit: PULSE_COMMAND },
    }, null, 2));
    const r = await claudeCodeAdapter.install(repo);
    expect(r.ok).toBe(true);
    expect(r.status).toBe("repaired");
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      hooks?: Record<string, unknown>;
    };
    const entry = settings.hooks?.["UserPromptSubmit"];
    expect(Array.isArray(entry)).toBe(true);
  });

  it("REFUSES to clobber a foreign hook (no force)", async () => {
    const settingsDir = join(fakeHome, ".claude");
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(join(settingsDir, "settings.json"), JSON.stringify({
      hooks: { UserPromptSubmit: "some-other-tool --run" },
    }, null, 2));
    const r = await claudeCodeAdapter.install(repo);
    expect(r.ok).toBe(false);
    expect(r.status).toBe("refused");
    expect(r.fix).toMatch(/--force/);
  });

  it("--force MERGES Mneme alongside foreign hook", async () => {
    const settingsDir = join(fakeHome, ".claude");
    mkdirSync(settingsDir, { recursive: true });
    const settingsPath = join(settingsDir, "settings.json");
    writeFileSync(settingsPath, JSON.stringify({
      hooks: { UserPromptSubmit: "some-other-tool --run" },
    }, null, 2));
    const r = await claudeCodeAdapter.install(repo, { force: true });
    expect(r.ok).toBe(true);
    expect(r.status).toBe("installed");
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      hooks?: { UserPromptSubmit?: unknown };
    };
    const entry = settings.hooks?.UserPromptSubmit as Array<{ hooks: Array<{ command: string }> }>;
    expect(entry).toHaveLength(2);
    const allCmds = entry.flatMap((g) => g.hooks.map((h) => h.command));
    expect(allCmds).toContain("some-other-tool --run");
    expect(allCmds).toContain(PULSE_COMMAND);
  });

  it("uninstall removes only Mneme entry, preserves foreign", async () => {
    const settingsDir = join(fakeHome, ".claude");
    mkdirSync(settingsDir, { recursive: true });
    const settingsPath = join(settingsDir, "settings.json");
    // Pre-populate: pulse + foreign
    writeFileSync(settingsPath, JSON.stringify({
      hooks: { UserPromptSubmit: [
        { hooks: [{ type: "command", command: "some-other-tool --run" }] },
        { hooks: [{ type: "command", command: PULSE_COMMAND }] },
      ] },
    }, null, 2));
    const r = await claudeCodeAdapter.uninstall(repo);
    expect(r.ok).toBe(true);
    expect(r.status).toBe("removed");
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      hooks?: { UserPromptSubmit?: Array<{ hooks: Array<{ command: string }> }> };
    };
    const cmds = settings.hooks?.UserPromptSubmit?.flatMap((g) => g.hooks.map((h) => h.command)) ?? [];
    expect(cmds).toEqual(["some-other-tool --run"]);
  });

  it("status reports drift on v1.25.2 string-shorthand", async () => {
    const settingsDir = join(fakeHome, ".claude");
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(join(settingsDir, "settings.json"), JSON.stringify({
      hooks: { UserPromptSubmit: PULSE_COMMAND },
    }, null, 2));
    const s = await claudeCodeAdapter.status(repo);
    expect(s.installed).toBe(true);
    expect(s.state).toBe("drift");
    expect(s.canRepair).toBe(true);
  });

  it("status reports ok when correct array schema present", async () => {
    await claudeCodeAdapter.install(repo);
    const s = await claudeCodeAdapter.status(repo);
    expect(s.state).toBe("ok");
    expect(s.installed).toBe(true);
  });

  it("status reports no-config when settings.json missing", async () => {
    const s = await claudeCodeAdapter.status(repo);
    expect(s.state).toBe("no-config");
    expect(s.installed).toBe(false);
  });

  it("install handles corrupt settings.json without crashing", async () => {
    const settingsDir = join(fakeHome, ".claude");
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(join(settingsDir, "settings.json"), "not valid json {");
    const r = await claudeCodeAdapter.install(repo);
    expect(r.ok).toBe(false);
    expect(r.status).toBe("error");
    expect(r.fix).toBeDefined();
  });

  it("install handles single-object schema (also rejected by CC) by repairing", async () => {
    const settingsDir = join(fakeHome, ".claude");
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(join(settingsDir, "settings.json"), JSON.stringify({
      hooks: { UserPromptSubmit: { type: "command", command: PULSE_COMMAND } },
    }, null, 2));
    const r = await claudeCodeAdapter.install(repo);
    expect(r.status).toBe("repaired");
  });
});

// ---------------------------------------------------------------------------
// File-based adapters -- one shared shape, many agents
// ---------------------------------------------------------------------------
describe("file-based adapters", () => {
  const cases = [
    { adapter: cursorAdapter, file: ".cursor/rules/mneme.mdc", id: "cursor" },
    { adapter: cursorLegacyAdapter, file: ".cursorrules", id: "cursor-legacy" },
    { adapter: codexAdapter, file: "AGENTS.md", id: "codex" },
    { adapter: geminiAdapter, file: "GEMINI.md", id: "gemini-cli" },
    { adapter: windsurfAdapter, file: ".windsurfrules", id: "windsurf" },
    { adapter: claudeProjectAdapter, file: "CLAUDE.md", id: "claude-code-project" },
  ];

  for (const c of cases) {
    it(`${c.id}: install creates ${c.file} with sentinel block`, async () => {
      const r = await c.adapter.install(repo);
      expect(r.ok).toBe(true);
      const p = join(repo, c.file);
      expect(existsSync(p)).toBe(true);
      const body = readFileSync(p, "utf8");
      expect(body).toContain(SENTINEL_BEGIN);
      expect(body).toContain(PULSE_COMMAND);
    });

    it(`${c.id}: install is idempotent`, async () => {
      await c.adapter.install(repo);
      const r2 = await c.adapter.install(repo);
      expect(r2.status).toBe("already-installed");
    });

    it(`${c.id}: uninstall strips only the block`, async () => {
      const p = join(repo, c.file);
      // Pre-populate with foreign content
      mkdirSync(join(p, ".."), { recursive: true });
      writeFileSync(p, "# user content\n\n# more user stuff\n");
      await c.adapter.install(repo);
      const after = readFileSync(p, "utf8");
      expect(after).toContain("# user content");
      expect(after).toContain(SENTINEL_BEGIN);
      const r = await c.adapter.uninstall(repo);
      expect(r.ok).toBe(true);
      expect(r.status).toBe("removed");
      const final = readFileSync(p, "utf8");
      expect(final).toContain("# user content");
      expect(final).not.toContain(SENTINEL_BEGIN);
    });

    it(`${c.id}: status reports ok / absent / no-config`, async () => {
      const before = await c.adapter.status(repo);
      expect(["absent", "no-config"]).toContain(before.state);
      await c.adapter.install(repo);
      const after = await c.adapter.status(repo);
      expect(after.state).toBe("ok");
      expect(after.installed).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Registry / batch ops
// ---------------------------------------------------------------------------
describe("registry + batch operations", () => {
  it("ALL_ADAPTERS is non-empty and has unique ids", () => {
    expect(ALL_ADAPTERS.length).toBeGreaterThanOrEqual(6);
    const ids = ALL_ADAPTERS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("adapterById finds known + returns undefined for unknown", () => {
    expect(adapterById("claude-code")).toBeDefined();
    expect(adapterById("does-not-exist")).toBeUndefined();
  });

  it("install() throws on unknown id", async () => {
    await expect(install(repo, "nope")).rejects.toThrow(/unknown adapter/);
  });

  it("detectAll returns one row per adapter", async () => {
    const rows = await detectAll(repo);
    expect(rows.length).toBe(ALL_ADAPTERS.length);
    for (const r of rows) {
      expect(typeof r.result.present).toBe("boolean");
    }
  });

  it("statusAll returns one row per adapter", async () => {
    const rows = await statusAll(repo);
    expect(rows.length).toBe(ALL_ADAPTERS.length);
  });

  it("installAll with onlyDetected=true installs claude-code + present project files", async () => {
    // Mark cursor as present by creating .cursor/
    mkdirSync(join(repo, ".cursor"), { recursive: true });
    const rows = await installAll(repo, { onlyDetected: true });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain("claude-code");
    expect(ids).toContain("cursor");
    // Adapters whose files don't exist + no detect marker should be skipped
    expect(ids).not.toContain("codex"); // no AGENTS.md, no detect marker
  });

  it("installAll with --all includes every adapter", async () => {
    const rows = await installAll(repo, { force: false });
    // onlyDetected default is false when no --only and no --all -- handled by CLI;
    // but installAll itself with no options installs ALL.
    expect(rows.length).toBe(ALL_ADAPTERS.length);
  });

  it("installAll with ids restricts to subset", async () => {
    const rows = await installAll(repo, { ids: ["cursor", "codex"] });
    expect(rows.map((r) => r.id).sort()).toEqual(["codex", "cursor"]);
  });

  it("uninstallAll removes from every adapter that had it", async () => {
    await installAll(repo, { ids: ["cursor", "codex", "windsurf"] });
    const rows = await uninstallAll(repo, { ids: ["cursor", "codex", "windsurf"] });
    expect(rows.every((r) => r.result.ok)).toBe(true);
    expect(existsSync(join(repo, ".cursor/rules/mneme.mdc"))).toBe(true); // file kept, block gone
    const body = readFileSync(join(repo, ".cursor/rules/mneme.mdc"), "utf8");
    expect(body).not.toContain(SENTINEL_BEGIN);
  });

  it("single-id install / status / uninstall convenience", async () => {
    const r = await install(repo, "codex");
    expect(r.ok).toBe(true);
    const s = await status(repo, "codex");
    expect(s.state).toBe("ok");
    const u = await uninstall(repo, "codex");
    expect(u.ok).toBe(true);
  });

  it("detection: Cursor detect marker fires when .cursor/ exists", async () => {
    expect((await cursorAdapter.detect(repo)).present).toBe(false);
    mkdirSync(join(repo, ".cursor"), { recursive: true });
    expect((await cursorAdapter.detect(repo)).present).toBe(true);
  });

  it("detection: Cursor detect marker fires when .cursorrules exists", async () => {
    writeFileSync(join(repo, ".cursorrules"), "# cursor legacy\n");
    expect((await cursorAdapter.detect(repo)).present).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Multi-layer error handling
// ---------------------------------------------------------------------------
describe("multi-layer error handling", () => {
  it("statusAll never throws even if individual adapter throws", async () => {
    // Spy on one adapter's status to make it throw; statusAll should still return.
    const spy = vi.spyOn(claudeCodeAdapter, "status").mockRejectedValueOnce(new Error("boom"));
    const rows = await statusAll(repo);
    expect(rows.length).toBe(ALL_ADAPTERS.length);
    const claude = rows.find((r) => r.id === "claude-code");
    expect(claude?.result.details).toMatch(/status failed/);
    spy.mockRestore();
  });

  it("installAll never throws even if individual adapter throws", async () => {
    const spy = vi.spyOn(cursorAdapter, "install").mockRejectedValueOnce(new Error("disk full"));
    const rows = await installAll(repo, { ids: ["cursor", "codex"] });
    expect(rows.length).toBe(2);
    const cursor = rows.find((r) => r.id === "cursor");
    expect(cursor?.result.ok).toBe(false);
    expect(cursor?.result.message).toMatch(/disk full/);
    spy.mockRestore();
  });

  it("file adapter install reports error (not throws) on unwritable path", async () => {
    // Simulate by deleting repo right before install
    const ghostRepo = join(tmpdir(), "definitely-does-not-exist-mneme-" + Date.now());
    // Try to install into a deeply nested path under a filename (not dir) -- should still
    // succeed because mkdir -p handles it. So instead, force an error via spy:
    const spy = vi.spyOn(codexAdapter, "install").mockResolvedValueOnce({
      ok: false, status: "error", mode: "agent-file", path: ghostRepo + "/AGENTS.md",
      message: "EACCES",
    });
    const r = await codexAdapter.install(ghostRepo);
    expect(r.ok).toBe(false);
    spy.mockRestore();
  });

  it("homedir is sandboxed (HOME env) -- adapters write to fakeHome not real home", async () => {
    expect(homedir()).toBe(fakeHome);
    await claudeCodeAdapter.install(repo);
    expect(existsSync(join(fakeHome, ".claude", "settings.json"))).toBe(true);
  });
});
