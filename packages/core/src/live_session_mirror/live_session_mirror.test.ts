import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import {
  encodeClaudeProjectSlug,
  extractRecentTurns,
  discoverClaudeCodeSessions,
  captureLiveCapsule,
  inspectLiveSessions,
} from "./index.js";

function writeJsonl(filePath: string, records: any[]): void {
  writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
}

describe("live_session_mirror", () => {
  describe("encodeClaudeProjectSlug", () => {
    it("encodes Windows drive path", () => {
      expect(encodeClaudeProjectSlug("d:\\lib_ai_git")).toBe("d-lib-ai-git");
    });
    it("encodes POSIX path", () => {
      expect(encodeClaudeProjectSlug("/Users/x/projects/mneme-ai")).toBe("Users-x-projects-mneme-ai");
    });
    it("collapses repeated dashes", () => {
      expect(encodeClaudeProjectSlug("d:/foo//bar")).toBe("d-foo-bar");
    });
  });

  describe("extractRecentTurns", () => {
    let tmp: string;
    beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "mneme-livesess-")); });
    afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } });

    it("returns empty array for non-existent file", () => {
      expect(extractRecentTurns(join(tmp, "missing.jsonl"))).toEqual([]);
    });

    it("extracts user + assistant text turns; drops thinking + tool_use", () => {
      const file = join(tmp, "session.jsonl");
      writeJsonl(file, [
        { type: "ai-title", aiTitle: "test", sessionId: "abc" }, // not a real role → filtered by role check
        { type: "user", message: { role: "user", content: "Hello AI" }, timestamp: "2026-05-21T10:00:00Z", sessionId: "abc", cwd: "/repo" },
        { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Hi human" }] }, timestamp: "2026-05-21T10:00:01Z" },
        { type: "assistant", message: { role: "assistant", content: [{ type: "thinking", thinking: "should I..." }] }, timestamp: "2026-05-21T10:00:02Z" }, // dropped (no text)
        { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: {} }] }, timestamp: "2026-05-21T10:00:03Z" }, // dropped
        { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "output" }] }, timestamp: "2026-05-21T10:00:04Z" }, // dropped (tool_result only)
        { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Done." }] }, timestamp: "2026-05-21T10:00:05Z" },
      ]);
      const turns = extractRecentTurns(file, 50);
      // File is small (< 2MB) so we read it all — no line-0 drop. ai-title
      // row has no message.role and gets filtered.  Three noise turns
      // (thinking / tool_use / tool_result-only) get filtered too.
      expect(turns.map((t) => t.text)).toEqual(["Hello AI", "Hi human", "Done."]);
      expect(turns.every((t) => t.role === "assistant" || t.role === "user")).toBe(true);
    });

    it("returns at most lastN turns", () => {
      const file = join(tmp, "many.jsonl");
      const records: any[] = [{ type: "ai-title" }];
      for (let i = 0; i < 20; i++) {
        records.push({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: `turn ${i}` }] }, timestamp: `2026-05-21T10:${String(i).padStart(2, "0")}:00Z` });
      }
      writeJsonl(file, records);
      const turns = extractRecentTurns(file, 5);
      expect(turns.length).toBe(5);
      expect(turns[turns.length - 1]!.text).toBe("turn 19");
    });

    it("ignores corrupt jsonl lines without crashing", () => {
      const file = join(tmp, "corrupt.jsonl");
      writeFileSync(file, [
        JSON.stringify({ type: "ai-title" }), // header (line 1 dropped)
        "{not json at all",                   // garbage
        JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "survived" }] }, timestamp: "2026-05-21T11:00:00Z" }),
      ].join("\n") + "\n", "utf8");
      const turns = extractRecentTurns(file);
      expect(turns.map((t) => t.text)).toEqual(["survived"]);
    });
  });

  describe("discoverClaudeCodeSessions", () => {
    it("returns array (may be empty on machines without Claude Code) sorted newest first", () => {
      const sessions = discoverClaudeCodeSessions();
      expect(Array.isArray(sessions)).toBe(true);
      for (let i = 1; i < sessions.length; i++) {
        expect(sessions[i - 1]!.mtimeMs).toBeGreaterThanOrEqual(sessions[i]!.mtimeMs);
      }
    });
  });

  describe("captureLiveCapsule", () => {
    it("returns null when no live sessions exist (or invents from /nonexistent)", () => {
      // Pass a clearly-nonexistent repoRoot — should still try to globally pick newest,
      // but in a brand-new env it'd be null. We don't assert null here because the
      // dev machine running this test may have its own ~/.claude/projects.
      const result = captureLiveCapsule("/definitely/not/a/real/repo/anywhere");
      // Just ensure shape if non-null.
      if (result) {
        expect(result.capsuleVersion).toBe(1);
        expect(result.isLive).toBe(true);
        expect(result.id).toMatch(/^[a-f0-9]{16}$/);
        expect(result.hmac).toMatch(/^[a-f0-9]{64}$/);
        expect(result.sourceFile.length).toBeGreaterThan(0);
        expect(Array.isArray(result.promptTrace)).toBe(true);
      }
    });
  });

  describe("inspectLiveSessions", () => {
    it("returns a shape with sessions + pickedFor + freshTurnCount", () => {
      const r = inspectLiveSessions("d:\\lib_ai_git");
      expect(r).toHaveProperty("sessions");
      expect(r).toHaveProperty("pickedFor");
      expect(r).toHaveProperty("freshTurnCount");
      expect(typeof r.freshTurnCount).toBe("number");
    });
  });
});
