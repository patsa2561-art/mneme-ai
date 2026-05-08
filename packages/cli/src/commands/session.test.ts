/**
 * session — unit tests for the Persistent Cross-AI Brain.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { sessionCommand, _deriveSessionIdForTests, _readSessionForTests } from "./session.js";

let tmp: string;
let chunks: string[];
let origWrite: typeof process.stdout.write;

function captureStdout() {
  chunks = [];
  origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((s: string | Uint8Array) => {
    chunks.push(typeof s === "string" ? s : Buffer.from(s).toString());
    return true;
  }) as typeof process.stdout.write;
}

function releaseStdout(): string {
  process.stdout.write = origWrite;
  return chunks.join("");
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mneme-sess-"));
  execSync("git init -q", { cwd: tmp });
  execSync("git config user.email t@x", { cwd: tmp });
  execSync("git config user.name T", { cwd: tmp });
});

afterEach(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

describe("session — id derivation", () => {
  it("same intent → same id (deterministic)", () => {
    const id1 = _deriveSessionIdForTests("Refactor auth.ts to use JWT");
    const id2 = _deriveSessionIdForTests("Refactor auth.ts to use JWT");
    expect(id1).toBe(id2);
  });

  it("case-insensitive (same intent in different case → same id)", () => {
    const id1 = _deriveSessionIdForTests("Refactor auth.ts");
    const id2 = _deriveSessionIdForTests("REFACTOR AUTH.TS");
    expect(id1).toBe(id2);
  });

  it("different intent → different id", () => {
    expect(_deriveSessionIdForTests("a")).not.toBe(_deriveSessionIdForTests("b"));
  });

  it("returns 12 hex chars", () => {
    expect(_deriveSessionIdForTests("anything")).toMatch(/^[a-f0-9]{12}$/);
  });
});

describe("session — save creates entry with anchors + log", () => {
  it("save with intent only creates a fresh entry", async () => {
    captureStdout();
    let code: number;
    try {
      code = await sessionCommand({
        cwd: tmp,
        action: "save",
        intent: "Refactor auth.ts",
        aiTool: "claude-code",
        json: true,
      });
    } finally {
      releaseStdout();
    }
    expect(code).toBe(0);
    const json = JSON.parse(chunks.join(""));
    expect(json.saved.intent).toBe("Refactor auth.ts");
    expect(json.saved.contributingAiTools).toContain("claude-code");
  });

  it("subsequent save with same intent merges (same id)", async () => {
    captureStdout();
    try {
      await sessionCommand({
        cwd: tmp,
        action: "save",
        intent: "Same intent",
        aiTool: "claude-code",
        files: ["src/a.ts"],
        json: true,
      });
    } finally { releaseStdout(); }

    captureStdout();
    try {
      await sessionCommand({
        cwd: tmp,
        action: "save",
        intent: "Same intent",
        aiTool: "chatgpt",
        files: ["src/b.ts"],
        json: true,
      });
    } finally { releaseStdout(); }

    const json = JSON.parse(chunks.join(""));
    // Both AI tools are now contributors
    expect(json.saved.contributingAiTools).toContain("claude-code");
    expect(json.saved.contributingAiTools).toContain("chatgpt");
    // Files merged
    expect(json.saved.anchors.files).toContain("src/a.ts");
    expect(json.saved.anchors.files).toContain("src/b.ts");
  });

  it("log entries are appended chronologically", async () => {
    captureStdout();
    try {
      await sessionCommand({
        cwd: tmp,
        action: "save",
        intent: "x",
        aiTool: "ai-1",
        logEntry: "first action",
        outcome: "PASS",
        json: true,
      });
    } finally { releaseStdout(); }

    captureStdout();
    try {
      await sessionCommand({
        cwd: tmp,
        action: "save",
        intent: "x",
        aiTool: "ai-2",
        logEntry: "second action",
        outcome: "FAIL",
        json: true,
      });
    } finally { releaseStdout(); }

    const json = JSON.parse(chunks.join(""));
    expect(json.saved.log.length).toBe(2);
    expect(json.saved.log[0].action).toBe("first action");
    expect(json.saved.log[1].action).toBe("second action");
    expect(json.saved.log[1].outcome).toBe("FAIL");
  });

  it("save without intent returns 1", async () => {
    captureStdout();
    const code = await sessionCommand({ cwd: tmp, action: "save", json: true });
    releaseStdout();
    expect(code).toBe(1);
  });
});

describe("session — resume", () => {
  it("resume with no id returns the most recent session", async () => {
    captureStdout();
    try {
      await sessionCommand({ cwd: tmp, action: "save", intent: "first", aiTool: "x", json: true });
    } finally { releaseStdout(); }

    // small wait so updatedAt differs
    await new Promise((r) => setTimeout(r, 50));

    captureStdout();
    try {
      await sessionCommand({ cwd: tmp, action: "save", intent: "second", aiTool: "x", json: true });
    } finally { releaseStdout(); }

    captureStdout();
    try {
      await sessionCommand({ cwd: tmp, action: "resume", json: true });
    } finally { releaseStdout(); }

    const json = JSON.parse(chunks.join(""));
    expect(json.resumed.intent).toBe("second"); // latest
  });

  it("resume by id returns the specific session", async () => {
    captureStdout();
    try {
      await sessionCommand({ cwd: tmp, action: "save", intent: "specific intent", aiTool: "x", json: true });
    } finally { releaseStdout(); }
    const json1 = JSON.parse(chunks.join(""));
    const id = json1.saved.id;

    captureStdout();
    try {
      await sessionCommand({ cwd: tmp, action: "resume", id, json: true });
    } finally { releaseStdout(); }
    const json2 = JSON.parse(chunks.join(""));
    expect(json2.resumed.id).toBe(id);
    expect(json2.resumed.intent).toBe("specific intent");
  });

  it("resume by unknown id returns 1 + reason=not-found", async () => {
    captureStdout();
    const code = await sessionCommand({ cwd: tmp, action: "resume", id: "nope", json: true });
    releaseStdout();
    expect(code).toBe(1);
    const json = JSON.parse(chunks.join(""));
    expect(json.reason).toBe("not-found");
  });

  it("resume with no sessions ever saved returns null + reason=no-sessions", async () => {
    captureStdout();
    await sessionCommand({ cwd: tmp, action: "resume", json: true });
    releaseStdout();
    const json = JSON.parse(chunks.join(""));
    expect(json.resumed).toBe(null);
    expect(json.reason).toBe("no-sessions");
  });
});

describe("session — list + remove", () => {
  it("list returns all sessions sorted by updatedAt desc", async () => {
    captureStdout();
    try {
      await sessionCommand({ cwd: tmp, action: "save", intent: "a", aiTool: "x", json: true });
    } finally { releaseStdout(); }
    await new Promise((r) => setTimeout(r, 30));
    captureStdout();
    try {
      await sessionCommand({ cwd: tmp, action: "save", intent: "b", aiTool: "x", json: true });
    } finally { releaseStdout(); }

    captureStdout();
    try {
      await sessionCommand({ cwd: tmp, action: "list", json: true });
    } finally { releaseStdout(); }
    const json = JSON.parse(chunks.join(""));
    expect(json.sessions.length).toBe(2);
    expect(json.sessions[0].intent).toBe("b"); // latest first
  });

  it("remove deletes a session by id", async () => {
    captureStdout();
    try {
      await sessionCommand({ cwd: tmp, action: "save", intent: "doomed", aiTool: "x", json: true });
    } finally { releaseStdout(); }
    const id = JSON.parse(chunks.join("")).saved.id;

    captureStdout();
    try {
      await sessionCommand({ cwd: tmp, action: "remove", id, json: true });
    } finally { releaseStdout(); }

    expect(_readSessionForTests(tmp, id)).toBe(null);
  });
});
