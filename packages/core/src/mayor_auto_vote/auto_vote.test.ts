import { describe, it, expect } from "vitest";
import {
  detectVendorFromCommit, autoVoteFromCommit, autoVoteBatch,
  generatePostCommitHook, generatePostCommitHookPwsh,
  generateStatusLine, computeAutoVoteStats, formatAutoVoteLine,
  MAYOR_AUTO_VOTE_TUNABLES,
} from "./index.js";
import { freshElectionState } from "../mayor_election/index.js";

const SECRET = "auto-vote-test-77";

describe("v2.19.38 MAYOR AUTO-VOTE — vendor detection from commit trailers", () => {
  it("Claude Code default trailer", () => {
    expect(detectVendorFromCommit(`fix: bug

Co-Authored-By: Claude <noreply@anthropic.com>`)).toBe("claude");
  });

  it("Generic Claude Co-Authored-By", () => {
    expect(detectVendorFromCommit(`feat: x\n\nCo-Authored-By: Claude Opus 4.7`)).toBe("claude");
  });

  it("AI-Generated-By: claude", () => {
    expect(detectVendorFromCommit(`fix\n\nAI-Generated-By: claude`)).toBe("claude");
  });

  it("ChatGPT / GPT trailers", () => {
    expect(detectVendorFromCommit(`x\n\nCo-Authored-By: ChatGPT`)).toBe("gpt");
    expect(detectVendorFromCommit(`x\n\nCo-Authored-By: GPT-4`)).toBe("gpt");
    expect(detectVendorFromCommit(`x\n\nAI-Generated-By: openai`)).toBe("gpt");
  });

  it("Gemini / Bard trailers", () => {
    expect(detectVendorFromCommit(`x\n\nCo-Authored-By: Gemini`)).toBe("gemini");
    expect(detectVendorFromCommit(`x\n\nCo-Authored-By: Bard`)).toBe("gemini");
    expect(detectVendorFromCommit(`x\n\nAI-Generated-By: gemini`)).toBe("gemini");
  });

  it("Grok / Copilot / Cursor / Aider / Codeium", () => {
    expect(detectVendorFromCommit(`x\n\nCo-Authored-By: Grok`)).toBe("grok");
    expect(detectVendorFromCommit(`x\n\nCo-Authored-By: Copilot`)).toBe("copilot");
    expect(detectVendorFromCommit(`x\n\nCo-Authored-By: Cursor`)).toBe("cursor");
    expect(detectVendorFromCommit(`x\n\nCo-Authored-By: Aider`)).toBe("aider");
    expect(detectVendorFromCommit(`x\n\nCo-Authored-By: Codeium`)).toBe("codeium");
    expect(detectVendorFromCommit(`x\n\nCo-Authored-By: Windsurf`)).toBe("codeium");
  });

  it("human-only commit → null (no vote)", () => {
    expect(detectVendorFromCommit("regular human commit message")).toBe(null);
    expect(detectVendorFromCommit("fix: typo")).toBe(null);
  });

  it("DEFENSIVE: empty / null / garbage → null", () => {
    expect(detectVendorFromCommit("")).toBe(null);
    expect(detectVendorFromCommit(null as unknown as string)).toBe(null);
    expect(detectVendorFromCommit(42 as unknown as string)).toBe(null);
  });

  it("generic AI-Generated-By with unknown vendor → captured", () => {
    expect(detectVendorFromCommit(`x\n\nAI-Generated-By: newvendor`)).toBe("newvendor");
  });
});

describe("v2.19.38 MAYOR AUTO-VOTE — autoVoteFromCommit", () => {
  it("AI commit → vote cast", () => {
    const state = freshElectionState({ repoId: "test", termStartMs: 0, termMs: 1_000_000 });
    const r = autoVoteFromCommit({
      state, commitMessage: `feat: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>`,
      commitSha: "abc123def", castAtMs: 1000, secret: SECRET,
    });
    expect(r.vote).not.toBeNull();
    expect(r.vote!.vendor).toBe("claude");
    expect(r.detectedVendor).toBe("claude");
  });

  it("human commit → no vote", () => {
    const state = freshElectionState({ repoId: "test", termStartMs: 0, termMs: 1_000_000 });
    const r = autoVoteFromCommit({ state, commitMessage: "fix: typo", castAtMs: 1000, secret: SECRET });
    expect(r.vote).toBeNull();
    expect(r.detectedVendor).toBe(null);
  });

  it("DEDUPE: same commitSha votes only once", () => {
    let state = freshElectionState({ repoId: "test", termStartMs: 0, termMs: 1_000_000 });
    const msg = `x\n\nCo-Authored-By: Claude <noreply@anthropic.com>`;
    const r1 = autoVoteFromCommit({ state, commitMessage: msg, commitSha: "abc", castAtMs: 100, secret: SECRET });
    state = r1.state;
    const r2 = autoVoteFromCommit({ state, commitMessage: msg, commitSha: "abc", castAtMs: 200, secret: SECRET });
    expect(r1.vote).not.toBeNull();
    expect(r2.vote).toBeNull(); // dedupe
    expect(r2.reason).toContain("already voted");
  });
});

describe("v2.19.38 MAYOR AUTO-VOTE — batch", () => {
  it("processes N commits + breakdown", () => {
    const state = freshElectionState({ repoId: "test", termStartMs: 0, termMs: 100_000_000 });
    const commits = [
      { sha: "1", message: "x\n\nCo-Authored-By: Claude <noreply@anthropic.com>", authorDate: 1000 },
      { sha: "2", message: "y\n\nCo-Authored-By: ChatGPT", authorDate: 2000 },
      { sha: "3", message: "z (human commit)", authorDate: 3000 },
      { sha: "4", message: "w\n\nCo-Authored-By: Claude <noreply@anthropic.com>", authorDate: 4000 },
    ];
    const r = autoVoteBatch({ state, commits, secret: SECRET });
    expect(r.votesCast).toBe(3); // 2 claude + 1 gpt
    expect(r.commitsSkipped).toBe(1);
    expect(r.breakdown.claude).toBe(2);
    expect(r.breakdown.gpt).toBe(1);
  });

  it("DEFENSIVE: malformed commits skipped", () => {
    const state = freshElectionState({ repoId: "test", termStartMs: 0, termMs: 100_000_000 });
    const commits = [
      { sha: "1", message: "x\n\nCo-Authored-By: Claude <noreply@anthropic.com>", authorDate: 1000 },
      null as unknown as { sha: string; message: string },
      { sha: "2" } as unknown as { sha: string; message: string },
    ];
    const r = autoVoteBatch({ state, commits, secret: SECRET });
    expect(r.votesCast).toBe(1);
    expect(r.commitsSkipped).toBe(2);
  });
});

describe("v2.19.38 MAYOR AUTO-VOTE — hook script generators", () => {
  it("post-commit bash hook is valid shell", () => {
    const hook = generatePostCommitHook();
    expect(hook).toMatch(/^#!\/usr\/bin\/env bash/);
    expect(hook).toContain("git rev-parse HEAD");
    expect(hook).toContain("git log -1 --format=%B HEAD");
    expect(hook).toContain("mneme mayor auto_vote_from_commit");
  });

  it("post-commit PowerShell hook is valid", () => {
    const hook = generatePostCommitHookPwsh();
    expect(hook).toContain("git rev-parse HEAD");
    expect(hook).toContain("ConvertTo-Json");
    expect(hook).toContain("mneme mayor auto_vote_from_commit");
  });
});

describe("v2.19.38 MAYOR AUTO-VOTE — status line", () => {
  it("formats winner + runner-up + term-remaining", () => {
    const line = generateStatusLine({
      winnerVendor: "claude", winnerVoteCount: 35,
      runnerUpVendor: "gpt", runnerUpVoteCount: 28,
      marginPct: 12.3, termRemainingMs: 5 * 86400_000,
    });
    expect(line).toContain("claude 35");
    expect(line).toContain("gpt 28");
    expect(line).toContain("5d left");
  });

  it("no votes → friendly empty message", () => {
    expect(generateStatusLine({ winnerVendor: null, winnerVoteCount: 0 })).toContain("no votes");
  });
});

describe("v2.19.38 MAYOR AUTO-VOTE — stats + tunables + 1000-iter fuzz", () => {
  it("computeAutoVoteStats counts vendors", () => {
    const state = freshElectionState({ repoId: "test", termStartMs: 0, termMs: 100_000_000 });
    const results = [];
    let s = state;
    for (let i = 0; i < 20; i++) {
      const msg = i % 3 === 0 ? "human commit" : `x\n\nCo-Authored-By: ${i % 2 === 0 ? "Claude <noreply@anthropic.com>" : "ChatGPT"}`;
      const r = autoVoteFromCommit({ state: s, commitMessage: msg, commitSha: `sha${i}`, castAtMs: i * 100, secret: SECRET });
      results.push(r);
      s = r.state;
    }
    const stats = computeAutoVoteStats(results);
    expect(stats.totalCommitsProcessed).toBe(20);
    expect(stats.votesCast).toBeGreaterThan(0);
    expect(formatAutoVoteLine(stats)).toContain("AUTO-VOTE");
  });

  it("≥8 recognised vendors", () => {
    expect(MAYOR_AUTO_VOTE_TUNABLES.RECOGNISED_VENDORS.length).toBeGreaterThanOrEqual(8);
  });

  it("1000 random commit messages never crash", () => {
    const state = freshElectionState({ repoId: "test", termStartMs: 0, termMs: 100_000_000_000 });
    let s = state;
    const trailers = [
      `Co-Authored-By: Claude <noreply@anthropic.com>`, `Co-Authored-By: ChatGPT`, `Co-Authored-By: Gemini`,
      `AI-Generated-By: grok`, ``, `fix: typo`,
    ];
    for (let i = 0; i < 1000; i++) {
      const msg = `commit ${i}\n\n${trailers[i % trailers.length]!}`;
      const r = autoVoteFromCommit({ state: s, commitMessage: msg, commitSha: `sha${i}`, castAtMs: i, secret: SECRET });
      s = r.state;
    }
    expect(s.votes.length).toBeGreaterThan(0);
  });
});
