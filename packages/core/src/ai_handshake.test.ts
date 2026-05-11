import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { greet, readActiveVendor, listHandshakes, recordCliActivity, listCliActivity, autoDetectVendor, pruneOldHandshakes } from "./ai_handshake.js";

describe("ai_handshake · greet", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-handshake-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("greet returns 'greeted' on first call + bumps soul", () => {
    const r = greet(repo, { vendor: "claude-opus-4-7" });
    expect(r.outcome).toBe("greeted");
    expect(r.active.vendor).toBe("claude-opus-4-7");
    expect(r.soul.lifetimeSessions).toBe(1);
  });

  it("greet returns 'rate-limited' on second call within window + reuses session", () => {
    const a = greet(repo, { vendor: "v1" });
    const b = greet(repo, { vendor: "v1" });
    expect(b.outcome).toBe("rate-limited");
    expect(b.active.session).toBe(a.active.session);
    expect(b.soul.lifetimeSessions).toBe(1); // not bumped twice
  });

  it("different vendors get separate session counts", () => {
    greet(repo, { vendor: "v1" });
    greet(repo, { vendor: "v2" });
    const handshakes = listHandshakes(repo);
    expect(handshakes.some((h) => h.vendor === "v1")).toBe(true);
    expect(handshakes.some((h) => h.vendor === "v2")).toBe(true);
  });

  it("rejects invalid vendor slug", () => {
    expect(() => greet(repo, { vendor: "../../evil" })).toThrow(/invalid vendor/);
    expect(() => greet(repo, { vendor: "" })).toThrow(/invalid vendor/);
  });

  it("active vendor expires after 24h (returns null when expired)", () => {
    greet(repo, { vendor: "v1" });
    expect(readActiveVendor(repo)).not.toBeNull();
    // simulate expiry by writing an expired record
    const path = join(repo, ".mneme/active-vendor.json");
    const cur = JSON.parse((require("node:fs") as typeof import("node:fs")).readFileSync(path, "utf8"));
    cur.expiresAt = new Date(Date.now() - 1000).toISOString();
    writeFileSync(path, JSON.stringify(cur));
    expect(readActiveVendor(repo)).toBeNull();
  });

  it("optional model name persists in active vendor", () => {
    const r = greet(repo, { vendor: "openai-gpt", model: "gpt-4o" });
    expect(r.active.model).toBe("gpt-4o");
  });
});

describe("ai_handshake · recordCliActivity", () => {
  let repo: string;
  // Same env-isolation as the autoDetectVendor describe — host machine's
  // OLLAMA_HOST etc. would otherwise satisfy the auto-detect step.
  const SNIFFED_ENV = [
    "MNEME_AI_VENDOR", "ANTHROPIC_API_KEY", "CLAUDE_CODE_SESSION",
    "OPENAI_API_KEY", "CURSOR_TRACE_ID", "CURSOR_AGENT", "CONTINUE_DEV",
    "GEMINI_API_KEY", "GOOGLE_API_KEY", "OLLAMA_HOST", "OLLAMA_MODELS",
    "AIDER_MODEL", "AIDER_API_KEY", "XAI_API_KEY", "GROK_API_KEY",
    "MISTRAL_API_KEY", "DEEPSEEK_API_KEY", "CLINE_AGENT", "CLINE_TASK_ID",
  ];
  let savedEnv: Record<string, string | undefined> = {};
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-handshake-"));
    savedEnv = {};
    for (const k of SNIFFED_ENV) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  });
  afterEach(() => {
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ }
    for (const k of SNIFFED_ENV) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it("records a tick when active vendor exists", () => {
    greet(repo, { vendor: "v1" });
    recordCliActivity(repo, "ask");
    const ticks = listCliActivity(repo);
    expect(ticks).toHaveLength(1);
    expect(ticks[0]!.command).toBe("ask");
    expect(ticks[0]!.vendor).toBe("v1");
  });

  it("uses explicit vendorHint when given", () => {
    recordCliActivity(repo, "audit", "explicit-vendor");
    const ticks = listCliActivity(repo);
    expect(ticks[0]!.vendor).toBe("explicit-vendor");
  });

  it("silently skips when no active vendor and no detection", () => {
    recordCliActivity(repo, "ask");
    expect(listCliActivity(repo)).toEqual([]);
  });

  it("dedupes (vendor, command, day) — same call twice → one record", () => {
    greet(repo, { vendor: "v1" });
    recordCliActivity(repo, "ask");
    recordCliActivity(repo, "ask");
    recordCliActivity(repo, "ask");
    expect(listCliActivity(repo)).toHaveLength(1);
  });

  it("different commands get separate ticks", () => {
    greet(repo, { vendor: "v1" });
    recordCliActivity(repo, "ask");
    recordCliActivity(repo, "audit");
    expect(listCliActivity(repo)).toHaveLength(2);
  });

  it("filters by vendor in listCliActivity", () => {
    recordCliActivity(repo, "ask", "v1");
    recordCliActivity(repo, "ask", "v2");
    expect(listCliActivity(repo, { vendor: "v1" })).toHaveLength(1);
  });
});

describe("ai_handshake · autoDetectVendor", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-handshake-"));
  });
  // Snapshot + clear ALL detection-relevant env vars per test so the host
  // machine's env doesn't bleed into assertions (e.g., OLLAMA_HOST set
  // system-wide would make every "no signals" test see vendor=ollama).
  const SNIFFED_ENV = [
    "MNEME_AI_VENDOR", "ANTHROPIC_API_KEY", "CLAUDE_CODE_SESSION",
    "OPENAI_API_KEY", "CURSOR_TRACE_ID", "CURSOR_AGENT", "CONTINUE_DEV",
    "GEMINI_API_KEY", "GOOGLE_API_KEY", "OLLAMA_HOST", "OLLAMA_MODELS",
    "AIDER_MODEL", "AIDER_API_KEY", "XAI_API_KEY", "GROK_API_KEY",
    "MISTRAL_API_KEY", "DEEPSEEK_API_KEY", "CLINE_AGENT", "CLINE_TASK_ID",
  ];
  let savedEnv: Record<string, string | undefined> = {};
  beforeEach(() => {
    savedEnv = {};
    for (const k of SNIFFED_ENV) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ }
    for (const k of SNIFFED_ENV) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it("respects explicit MNEME_AI_VENDOR env var", () => {
    process.env["MNEME_AI_VENDOR"] = "custom-vendor";
    const r = autoDetectVendor(repo);
    expect(r?.vendor).toBe("custom-vendor");
    expect(r?.reason).toContain("MNEME_AI_VENDOR");
  });

  it("infers claude from ANTHROPIC_API_KEY env", () => {
    process.env["ANTHROPIC_API_KEY"] = "sk-fake";
    expect(autoDetectVendor(repo)?.vendor).toContain("claude");
  });

  it("infers openai from OPENAI_API_KEY env", () => {
    process.env["OPENAI_API_KEY"] = "sk-fake";
    expect(autoDetectVendor(repo)?.vendor).toContain("openai");
  });

  it("infers cursor from CURSOR_TRACE_ID env", () => {
    process.env["CURSOR_TRACE_ID"] = "trace-xyz";
    expect(autoDetectVendor(repo)?.vendor).toBe("cursor");
  });

  it("falls back to repo-config sentinels (CLAUDE.md present → claude)", () => {
    writeFileSync(join(repo, "CLAUDE.md"), "# project memory");
    expect(autoDetectVendor(repo)?.vendor).toContain("claude");
  });

  it("rejects malformed env-var vendor (no slug regex match)", () => {
    process.env["MNEME_AI_VENDOR"] = "bad slug with spaces!";
    // Falls through to next signal; with no other signals, returns null
    expect(autoDetectVendor(repo)).toBeNull();
  });

  it("returns null when no signals detected at all", () => {
    expect(autoDetectVendor(repo)).toBeNull();
  });
});

describe("ai_handshake · pruneOldHandshakes", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-handshake-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("does not prune fresh handshakes", () => {
    greet(repo, { vendor: "v1" });
    greet(repo, { vendor: "v2" });
    const r = pruneOldHandshakes(repo, 30);
    expect(r.pruned).toBe(0);
  });

  it("returns 0 pruned when handshake dir doesn't exist", () => {
    expect(pruneOldHandshakes(repo).pruned).toBe(0);
  });
});
