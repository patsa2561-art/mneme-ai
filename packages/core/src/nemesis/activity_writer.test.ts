import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordActivityReconciled } from "./activity_writer.js";

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
});
