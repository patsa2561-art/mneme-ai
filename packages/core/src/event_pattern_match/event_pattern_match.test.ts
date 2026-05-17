import { describe, it, expect } from "vitest";
import {
  matchEventPatterns,
  reportMatch,
  verifyReport,
  listBuiltinPatterns,
  formatPredictionLine,
  BUILTIN_PATTERNS,
  type SemanticEvent,
  type SemanticPattern,
} from "./index.js";

const SECRET = "event-pattern-test-secret-997744";

function evt(kind: SemanticEvent["kind"], text: string, ts = 1): SemanticEvent {
  return { v: 1, kind, text, ts };
}

describe("v2.19.24 EVENT PATTERN MATCH · BUILTIN_PATTERNS coverage", () => {
  it("ships >= 18 patterns covering 5 event kinds", () => {
    expect(BUILTIN_PATTERNS.length).toBeGreaterThanOrEqual(18);
    const kinds = new Set<string>();
    for (const p of BUILTIN_PATTERNS) for (const k of p.eventKinds) kinds.add(k);
    expect(kinds.has("git_commit")).toBe(true);
    expect(kinds.has("file_save")).toBe(true);
    expect(kinds.has("clipboard")).toBe(true);
    expect(kinds.has("terminal_command")).toBe(true);
    expect(kinds.has("user_chat")).toBe(true);
  });

  it("every pattern has unique id + at least one suggested tool", () => {
    const ids = new Set<string>();
    for (const p of BUILTIN_PATTERNS) {
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
      expect(p.tools.length).toBeGreaterThan(0);
      for (const t of p.tools) {
        expect(t.confidence).toBeGreaterThan(0);
        expect(t.confidence).toBeLessThanOrEqual(1);
      }
    }
  });

  it("listBuiltinPatterns returns a copy (mutation-safe)", () => {
    const before = BUILTIN_PATTERNS.length;
    const a = listBuiltinPatterns();
    a.pop();
    expect(BUILTIN_PATTERNS.length).toBe(before);
  });
});

describe("v2.19.24 EVENT PATTERN MATCH · the user's canonical scenario", () => {
  it("'fix: token leak in auth.ts' commit -> bug_prophet + forensics.vulns + apoptosis.detect + antivirus", () => {
    const predictions = matchEventPatterns({
      event: evt("git_commit", "fix: token leak in auth.ts"),
      topN: 10,
    });
    const tools = predictions.map((p) => p.toolName);
    // fix: prefix pattern -> bug_prophet + premortem
    expect(tools).toContain("mneme.bug_prophet.prophesy");
    // security_token_leak -> forensics.vulns + apoptosis + antivirus
    expect(tools).toContain("mneme.forensics.vulns");
    expect(tools).toContain("mneme.apoptosis.detect");
    expect(tools).toContain("mneme.antivirus.scan");
    // forensics.vulns matched 2 patterns (token_leak + auth_file) -> max confidence
    const vulns = predictions.find((p) => p.toolName === "mneme.forensics.vulns")!;
    expect(vulns.matchedPatterns.length).toBeGreaterThanOrEqual(1);
    expect(vulns.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("'check this with claude code' clipboard -> handoff.universal (1-step not 10-step)", () => {
    const predictions = matchEventPatterns({
      event: evt("clipboard", "check this with claude code"),
    });
    expect(predictions[0]!.toolName).toBe("mneme.handoff.universal");
    expect(predictions[0]!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("Thai 'ตรวจของแท้' clipboard -> caption.sever + provenance.evaluate (multilingual)", () => {
    const predictions = matchEventPatterns({
      event: evt("clipboard", "ตรวจของแท้ของรองเท้านี้"),
    });
    const tools = predictions.map((p) => p.toolName);
    expect(tools).toContain("mneme.caption.sever");
    expect(tools).toContain("mneme.provenance.evaluate");
  });
});

describe("v2.19.24 EVENT PATTERN MATCH · multi-pattern merge (max-confidence wins)", () => {
  it("when 2 patterns suggest same tool with different confidence -> highest wins + both matchedPatterns recorded", () => {
    const customPatterns: SemanticPattern[] = [
      {
        id: "p_low",
        eventKinds: ["git_commit"],
        regex: /low/,
        tools: [{ toolName: "shared.tool", argsTemplate: {}, confidence: 0.3 }],
        reason: "low",
      },
      {
        id: "p_high",
        eventKinds: ["git_commit"],
        regex: /low/,
        tools: [{ toolName: "shared.tool", argsTemplate: {}, confidence: 0.9 }],
        reason: "high",
      },
    ];
    const predictions = matchEventPatterns({
      event: evt("git_commit", "low intensity commit"),
      patterns: customPatterns,
    });
    expect(predictions.length).toBe(1);
    expect(predictions[0]!.confidence).toBe(0.9);
    expect(predictions[0]!.matchedPatterns).toContain("p_low");
    expect(predictions[0]!.matchedPatterns).toContain("p_high");
  });

  it("event kind filters patterns (clipboard pattern does NOT fire on git_commit)", () => {
    const predictions = matchEventPatterns({
      event: evt("git_commit", "check this with claude code"),
    });
    const tools = predictions.map((p) => p.toolName);
    expect(tools).not.toContain("mneme.handoff.universal");
  });

  it("no matching patterns -> empty predictions", () => {
    const predictions = matchEventPatterns({
      event: evt("git_commit", "absolutely no keywords just words"),
    });
    expect(predictions).toEqual([]);
  });

  it("topN respected; sorted by confidence desc", () => {
    const predictions = matchEventPatterns({
      event: evt("git_commit", "fix: cve-2024-1234 token leak api_key in auth.ts"),
      topN: 3,
    });
    expect(predictions.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < predictions.length; i++) {
      expect(predictions[i - 1]!.confidence).toBeGreaterThanOrEqual(predictions[i]!.confidence);
    }
  });
});

describe("v2.19.24 EVENT PATTERN MATCH · file-type hints", () => {
  it("'.test.ts' file save -> coverage check", () => {
    const predictions = matchEventPatterns({
      event: evt("file_save", "src/auth.test.ts"),
    });
    const tools = predictions.map((p) => p.toolName);
    expect(tools).toContain("mneme.ask");
  });

  it("config file save (package.json) -> deps.oracle + premortem", () => {
    const predictions = matchEventPatterns({
      event: evt("file_save", "package.json"),
    });
    const tools = predictions.map((p) => p.toolName);
    expect(tools).toContain("mneme.deps.oracle");
    expect(tools).toContain("mneme.premortem");
  });
});

describe("v2.19.24 EVENT PATTERN MATCH · HMAC report + determinism", () => {
  it("reportMatch HMAC verifies on untampered; rejects tamper", () => {
    const r = reportMatch({ event: evt("git_commit", "fix: bug"), secret: SECRET });
    expect(verifyReport(r, SECRET)).toBe(true);
    const tampered = { ...r, patternsMatched: 999 };
    expect(verifyReport(tampered, SECRET)).toBe(false);
  });

  it("MEASURED 100% determinism: same event -> same report sig (30 trials)", () => {
    const event = evt("git_commit", "fix: token leak in auth.ts", 1_000_000);
    const firstSig = reportMatch({ event, secret: SECRET }).sig;
    let allEqual = true;
    for (let i = 0; i < 30; i++) {
      if (reportMatch({ event, secret: SECRET }).sig !== firstSig) { allEqual = false; break; }
    }
    expect(allEqual).toBe(true);
  });
});

describe("v2.19.24 EVENT PATTERN MATCH · formatter", () => {
  it("formatPredictionLine includes tool, conf%, matched pattern ids", () => {
    const line = formatPredictionLine({
      toolName: "mneme.forensics.vulns",
      argsTemplate: {},
      confidence: 0.85,
      matchedPatterns: ["security_token_leak", "security_auth_file"],
    });
    expect(line).toContain("mneme.forensics.vulns");
    expect(line).toContain("85%");
    expect(line).toContain("security_token_leak");
    expect(line).toContain("security_auth_file");
  });
});
