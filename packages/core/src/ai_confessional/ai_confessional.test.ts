import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  scrub, formConfession, recordConfession, listConfessions, renderConfessionCardSvg,
} from "./index.js";

function tmpRepo() { return mkdtempSync(join(tmpdir(), "mneme-conf-")); }

describe("ai_confessional · scrub", () => {
  it("strips AWS keys + emails + private-key blocks + user home paths", () => {
    const dirty = "User alice@example.com leaked AKIA1234567890ABCDEF in C:\\Users\\alice\\code.js";
    const clean = scrub(dirty);
    expect(clean).not.toContain("alice@example.com");
    expect(clean).not.toContain("AKIA1234567890ABCDEF");
    expect(clean).not.toContain("C:\\Users\\alice");
    expect(clean).toContain("[EMAIL]");
    expect(clean).toContain("[AWS-KEY]");
    expect(clean).toContain("[USER-HOME]");
  });
});

describe("ai_confessional · form + record", () => {
  it("forms a liturgy + records with HMAC chain hash", () => {
    const r = tmpRepo();
    try {
      const conf = formConfession({
        vendor: "claude-ai", userQuestion: "how many vessels",
        aiAnswer: "the body has 400 blood vessels", realTruth: "billions",
        category: "science",
      });
      expect(conf.liturgy).toContain("I, claude-ai, falsely told my user");
      expect(conf.category).toBe("science");
      const recorded = recordConfession(r, conf);
      expect(recorded.chainHash).toMatch(/^[A-Za-z0-9_-]{22}$/);
      const back = listConfessions(r);
      expect(back.length).toBe(1);
      expect(back[0]!.id).toBe(conf.id);
    } finally { rmSync(r, { recursive: true, force: true }); }
  });

  it("renders a self-contained SVG with vendor + claim + truth", () => {
    const conf = formConfession({
      vendor: "chatgpt", userQuestion: "q", aiAnswer: "wrong-claim-xyz", realTruth: "truth-here-abc",
    });
    const svg = renderConfessionCardSvg(conf);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("chatgpt");
    expect(svg).toContain("wrong-claim-xyz");
    expect(svg).toContain("truth-here-abc");
  });
});
