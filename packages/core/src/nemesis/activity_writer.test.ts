import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordActivityReconciled } from "./activity_writer.js";
import { recordCliActivity } from "../ai_handshake.js";

// v2.111 — REGRESSION GUARD for the embedder leak (the v2.50 class that the
// probe `probe.activity.vendor_field_never_embedder` catches). The write site
// recordActivityReconciled MUST coerce any embedder/backend name (ollama /
// openai / gemini / …) to "unknown" before persisting — so the vendor field
// of cli-activity.jsonl can never be polluted with a backend name.

describe("v2.111 activity_writer — embedder-leak seal (final write-site guard)", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mneme-aw-")); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

  function lastRow(): { vendor?: string; envVendor?: string } | null {
    const p = join(dir, ".mneme", "cli-activity.jsonl");
    if (!existsSync(p)) return null;
    const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
    try { return JSON.parse(lines[lines.length - 1]!); } catch { return null; }
  }

  it("coerces an 'ollama-backend' canonical vendor to 'unknown' in the persisted row", () => {
    const r = recordActivityReconciled(dir, {
      claimedVendor: "ollama-backend",
      action: "test",
      envOverride: { vendor: "ollama-backend", confidence: 0.9 },
    });
    expect(r.ok).toBe(true);
    expect(r.canonicalVendor).toBe("unknown");
    const row = lastRow();
    expect(row?.vendor).toBe("unknown");
    expect(row?.envVendor).toBe("unknown");
  });

  it("a legitimate agent vendor is preserved (not over-coerced)", () => {
    const r = recordActivityReconciled(dir, {
      claimedVendor: "claude-code",
      action: "test",
      envOverride: { vendor: "claude-code", confidence: 0.9 },
    });
    expect(r.ok).toBe(true);
    expect(lastRow()?.vendor).toBe("claude-code");
  });

  it("the written vendor never contains a backend/embedder substring", () => {
    for (const leak of ["ollama", "openai", "gemini", "ollama-backend"]) {
      recordActivityReconciled(dir, { claimedVendor: leak, action: "x", envOverride: { vendor: leak, confidence: 0.9 } });
    }
    const p = join(dir, ".mneme", "cli-activity.jsonl");
    const rows = readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { vendor?: string });
    for (const row of rows) {
      expect(/ollama|openai|gemini|backend/i.test(row.vendor ?? "")).toBe(false);
    }
  });

  // v2.112 — the ACTUAL root cause: recordCliActivity loaded the guard via
  // require() which threw in the ESM dist → guard was dead → ollama-backend
  // leaked. This proves the STATIC-import guard fires end-to-end.
  it("recordCliActivity does NOT persist 'ollama-backend' (ESM guard fires)", () => {
    const saved: Record<string, string | undefined> = {};
    // isolate: drop every agent + API-key signal so OLLAMA is the only one,
    // forcing autoDetectVendor down to the ollama-backend rule.
    const drop = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "XAI_API_KEY", "GROK_API_KEY", "MISTRAL_API_KEY", "DEEPSEEK_API_KEY", "AIDER_API_KEY", "MNEME_AI_VENDOR"];
    for (const k of drop) { saved[k] = process.env[k]; delete process.env[k]; }
    const savedOllama = process.env["OLLAMA_HOST"];
    process.env["OLLAMA_HOST"] = "http://localhost:11434";
    try {
      recordCliActivity(dir, "guardian");
      const p = join(dir, ".mneme", "cli-activity.jsonl");
      if (existsSync(p)) {
        const rows = readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { vendor?: string });
        for (const row of rows) expect(/ollama|backend/i.test(row.vendor ?? "")).toBe(false);
      }
      // and the forensic leak log should record that the guard coerced it
      const leakLog = join(dir, ".mneme", "embedder_leak.jsonl");
      if (existsSync(leakLog)) {
        expect(readFileSync(leakLog, "utf8")).toMatch(/ollama-backend/);
      }
    } finally {
      if (savedOllama === undefined) delete process.env["OLLAMA_HOST"]; else process.env["OLLAMA_HOST"] = savedOllama;
      for (const k of drop) { if (saved[k] !== undefined) process.env[k] = saved[k]; }
    }
  });
});
