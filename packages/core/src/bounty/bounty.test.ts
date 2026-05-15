import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  recordClaim, recordVerdict, verifyChain, summariseVendor,
  leaderboard, listVendors, publish, formatBountyLine,
} from "./index.js";

describe("v2.14 · MNEMOSYNE BOUNTY — signed hallucination ledger", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "bounty-")); });

  it("recordClaim appends a signed claim entry", () => {
    const c = recordClaim({ vendor: "claude", text: "src/foo.ts exists", repoDir: dir });
    expect(c.kind).toBe("claim");
    expect(c.id).toMatch(/^c-/);
    expect(c.chainSig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("recordVerdict references a claim and appends signed", () => {
    const c = recordClaim({ vendor: "claude", text: "src/foo.ts exists", repoDir: dir });
    const v = recordVerdict({ claimId: c.id, vendor: "claude", verdict: "false", reason: "no such file", repoDir: dir });
    expect(v.kind).toBe("verdict");
    expect(v.claimId).toBe(c.id);
    expect(v.chainSig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("verifyChain returns ok=true for clean ledger", () => {
    recordClaim({ vendor: "claude", text: "x", repoDir: dir });
    recordClaim({ vendor: "chatgpt", text: "y", repoDir: dir });
    recordVerdict({ claimId: "c-fake", vendor: "claude", verdict: "true", reason: "ok", repoDir: dir });
    const v = verifyChain({ repoDir: dir });
    expect(v.ok).toBe(true);
    expect(v.total).toBe(3);
  });

  it("tampering with an entry breaks the chain at that index", () => {
    recordClaim({ vendor: "claude", text: "a", repoDir: dir });
    recordClaim({ vendor: "chatgpt", text: "b", repoDir: dir });
    recordClaim({ vendor: "gemini", text: "c", repoDir: dir });
    const path = join(dir, ".mneme", "bounty.jsonl");
    const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.length > 0);
    // Tamper: change text on entry 1
    const parsed = JSON.parse(lines[1]!);
    parsed.text = "TAMPERED";
    lines[1] = JSON.stringify(parsed);
    writeFileSync(path, lines.join("\n") + "\n");
    const v = verifyChain({ repoDir: dir });
    expect(v.ok).toBe(false);
    expect(v.brokenIndex).toBe(1);
  });

  it("summariseVendor: 7 verdicts, 3 false → falseRate around 0.43", () => {
    for (let i = 0; i < 3; i++) recordVerdict({ claimId: "x", vendor: "chatgpt", verdict: "false", reason: "wrong", repoDir: dir });
    for (let i = 0; i < 4; i++) recordVerdict({ claimId: "x", vendor: "chatgpt", verdict: "true", reason: "ok", repoDir: dir });
    const card = summariseVendor("chatgpt", { repoDir: dir });
    expect(card.trueCount).toBe(4);
    expect(card.falseCount).toBe(3);
    expect(card.falseRate).toBeCloseTo(3 / 7, 2);
    expect(card.falseRateLB).toBeLessThanOrEqual(card.falseRate);
    expect(card.sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("leaderboard sorts worst (highest falseRateLB) first", () => {
    // chatgpt: 5 false, 0 true → high LB
    for (let i = 0; i < 5; i++) recordVerdict({ claimId: "x", vendor: "chatgpt", verdict: "false", reason: "wrong", repoDir: dir });
    // claude: 0 false, 5 true → 0 LB
    for (let i = 0; i < 5; i++) recordVerdict({ claimId: "x", vendor: "claude", verdict: "true", reason: "ok", repoDir: dir });
    // gemini: 2 false, 3 true → mid LB
    for (let i = 0; i < 2; i++) recordVerdict({ claimId: "x", vendor: "gemini", verdict: "false", reason: "wrong", repoDir: dir });
    for (let i = 0; i < 3; i++) recordVerdict({ claimId: "x", vendor: "gemini", verdict: "true", reason: "ok", repoDir: dir });

    const board = leaderboard({ repoDir: dir });
    expect(board[0]!.vendor).toBe("chatgpt");
    // claude should be last (best)
    expect(board[board.length - 1]!.vendor).toBe("claude");
  });

  it("listVendors deduplicates", () => {
    recordClaim({ vendor: "claude", text: "x", repoDir: dir });
    recordClaim({ vendor: "claude", text: "y", repoDir: dir });
    recordClaim({ vendor: "gemini", text: "z", repoDir: dir });
    const vs = listVendors({ repoDir: dir }).sort();
    expect(vs).toEqual(["claude", "gemini"]);
  });

  it("publish redacts to public-safe shape", () => {
    recordVerdict({ claimId: "x", vendor: "claude", verdict: "false", reason: "wrong", repoDir: dir });
    const card = summariseVendor("claude", { repoDir: dir });
    const pub = publish(card);
    expect(pub.vendor).toBe("claude");
    expect(pub.sig).toBe(card.sig);
    expect((pub as any).reason).toBeUndefined();
    // No internal fields leaked
    const keys = Object.keys(pub).sort();
    expect(keys).toEqual(["falseRate", "falseRateLB", "generatedAt", "sig", "totalVerdicts", "v", "vendor"]);
  });

  it("Wilson LB is more conservative than raw rate for small samples", () => {
    recordVerdict({ claimId: "x", vendor: "chatgpt", verdict: "false", reason: "wrong", repoDir: dir });
    recordVerdict({ claimId: "x", vendor: "chatgpt", verdict: "false", reason: "wrong", repoDir: dir });
    const c = summariseVendor("chatgpt", { repoDir: dir });
    expect(c.falseRate).toBe(1);
    // Wilson LB on 2/2 should be < 1 (uncertain due to small sample)
    expect(c.falseRateLB).toBeLessThan(1);
  });

  it("formatBountyLine summarises", () => {
    recordClaim({ vendor: "claude", text: "x", repoDir: dir });
    recordVerdict({ claimId: "x", vendor: "claude", verdict: "false", reason: "wrong", repoDir: dir });
    const line = formatBountyLine({ repoDir: dir });
    expect(line).toContain("BOUNTY");
    expect(line).toContain("1 claims");
    expect(line).toContain("1 caught");
  });

  it("recordClaim with structured fact preserves type info", () => {
    const c = recordClaim({
      vendor: "claude",
      text: "src/foo.ts exists",
      fact: { type: "file-exists", subject: "src/foo.ts" },
      repoDir: dir,
    });
    expect(c.fact?.type).toBe("file-exists");
    expect(c.fact?.subject).toBe("src/foo.ts");
  });

  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });
});

// helper to allow afterEach without importing it explicitly above
import { afterEach } from "vitest";
