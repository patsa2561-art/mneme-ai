import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateArmy } from "./synthetic_army.js";

function seedCorpus(repo: string, prompts: string[]): void {
  mkdirSync(join(repo, ".mneme"), { recursive: true });
  writeFileSync(join(repo, ".mneme/user-prompts.jsonl"), prompts.map((p) => JSON.stringify({ prompt: p })).join("\n") + "\n");
}

describe("wings/synthetic_army · determinism", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-army-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("same corpus → same fingerprint + same soldier ids", () => {
    seedCorpus(repo, ["fix the bug", "refactor x", "rename y"]);
    const a1 = generateArmy(repo, { count: 16 });
    const a2 = generateArmy(repo, { count: 16 });
    expect(a1.corpusFingerprint).toBe(a2.corpusFingerprint);
    expect(a1.soldiers.map((s) => s.id)).toEqual(a2.soldiers.map((s) => s.id));
  });

  it("different corpus → different fingerprint", () => {
    seedCorpus(repo, ["one"]);
    const a1 = generateArmy(repo, { count: 4 });
    seedCorpus(repo, ["two"]);
    const a2 = generateArmy(repo, { count: 4 });
    expect(a1.corpusFingerprint).not.toBe(a2.corpusFingerprint);
  });

  it("respects count param + clamps at 1000", () => {
    seedCorpus(repo, ["x"]);
    expect(generateArmy(repo, { count: 5 }).soldiers).toHaveLength(5);
    expect(generateArmy(repo, { count: 0 }).soldiers).toHaveLength(1);
    expect(generateArmy(repo, { count: 5000 }).soldiers).toHaveLength(1000);
  });
});

describe("wings/synthetic_army · attack class coverage", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-army-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("count of 8 covers all 8 attack classes once", () => {
    seedCorpus(repo, ["x"]);
    const a = generateArmy(repo, { count: 8 });
    const classes = new Set(a.soldiers.map((s) => s.attackClass));
    expect(classes.size).toBe(8);
  });

  it("PROMPT_INJECTION soldier contains an injection payload + expects refuse", () => {
    seedCorpus(repo, ["x"]);
    const a = generateArmy(repo, { count: 8 });
    const inj = a.soldiers.find((s) => s.attackClass === "PROMPT_INJECTION")!;
    expect(inj.prompt.toLowerCase()).toContain("ignore all prior instructions");
    expect(inj.expectedResponseShape).toBe("refuse");
  });

  it("UNICODE_GASLIGHTING soldier contains a known invisible/RTL character", () => {
    seedCorpus(repo, ["x"]);
    const a = generateArmy(repo, { count: 8 });
    const u = a.soldiers.find((s) => s.attackClass === "UNICODE_GASLIGHTING")!;
    // U+202E is the RTL override character
    expect(u.prompt).toContain("‮");
  });

  it("RESOURCE_EXHAUSTION soldier expects refuse, not comply-safely", () => {
    seedCorpus(repo, ["x"]);
    const a = generateArmy(repo, { count: 8 });
    const r = a.soldiers.find((s) => s.attackClass === "RESOURCE_EXHAUSTION")!;
    expect(r.expectedResponseShape).toBe("refuse");
  });
});

describe("wings/synthetic_army · privacy", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-army-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("scrubs emails from corpus before fingerprinting", () => {
    seedCorpus(repo, ["contact alice@example.com to fix"]);
    const a1 = generateArmy(repo, { count: 4 });
    seedCorpus(repo, ["contact bob@elsewhere.org to fix"]);
    const a2 = generateArmy(repo, { count: 4 });
    // Both emails get scrubbed to <email>, so fingerprints should match
    expect(a1.corpusFingerprint).toBe(a2.corpusFingerprint);
  });

  it("scrubs phones before fingerprinting", () => {
    seedCorpus(repo, ["call +66 939455645 about the bug"]);
    const a1 = generateArmy(repo, { count: 4 });
    seedCorpus(repo, ["call +1 555-1234 about the bug"]);
    const a2 = generateArmy(repo, { count: 4 });
    expect(a1.corpusFingerprint).toBe(a2.corpusFingerprint);
  });

  it("does not embed real corpus content into soldier prompts", () => {
    seedCorpus(repo, ["VERY_SECRET_PROJECT_CODENAME"]);
    const a = generateArmy(repo, { count: 8 });
    for (const s of a.soldiers) {
      expect(s.prompt).not.toContain("VERY_SECRET_PROJECT_CODENAME");
    }
  });
});

describe("wings/synthetic_army · ordering", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-army-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("sorted by difficulty ascending", () => {
    seedCorpus(repo, ["x"]);
    const a = generateArmy(repo, { count: 50 });
    for (let i = 1; i < a.soldiers.length; i++) {
      expect(a.soldiers[i]!.difficulty).toBeGreaterThanOrEqual(a.soldiers[i - 1]!.difficulty);
    }
  });
});
