import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contribute, invoke, formatAdvice } from "./index.js";

describe("ghost_mentor", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-ghost-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("invoke returns no-data message when no contributors", async () => {
    const r = await invoke(repo, { query: "race condition" });
    expect(r.confidence).toBe(0);
    expect(r.basedOn).toEqual([]);
    expect(r.text).toContain("No senior decisions");
  });

  it("contribute writes HMAC-signed consent + decisions to disk", async () => {
    const r = await contribute(repo, {
      contributorId: "alice",
      displayName: "Alice S.",
      scope: "distributed-systems decisions",
      decisions: [
        { ts: "2026-05-01T00:00:00Z", context: "race condition fix", reasoning: "always use mutex, not optimistic concurrency for cross-process state", tags: ["race", "concurrency"] },
        { ts: "2026-05-02T00:00:00Z", context: "rate limit", reasoning: "leaky bucket beats token bucket for spiky traffic", tags: ["rate-limit"] },
      ],
    });
    expect(r.recorded).toBe(2);
    expect(r.contributor.sig).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(existsSync(join(repo, ".mneme/ghost_mentor/corpus/alice.consent.json"))).toBe(true);
    expect(existsSync(join(repo, ".mneme/ghost_mentor/corpus/alice.decisions.jsonl"))).toBe(true);
  });

  it("invoke returns fused advice ranked by relevance", async () => {
    await contribute(repo, {
      contributorId: "alice", displayName: "Alice", scope: "concurrency",
      decisions: [
        { ts: "2026-05-01T00:00:00Z", context: "fixing a race condition in payment service", reasoning: "use a distributed mutex with TTL", tags: ["race", "concurrency"] },
        { ts: "2026-05-02T00:00:00Z", context: "unrelated css refactor", reasoning: "use tailwind", tags: ["css"] },
      ],
    });
    await contribute(repo, {
      contributorId: "bob", displayName: "Bob", scope: "concurrency",
      decisions: [
        { ts: "2026-05-01T00:00:00Z", context: "race condition between workers", reasoning: "redis SETNX with expiry handles 99% of cases", tags: ["race", "redis"] },
      ],
    });
    const r = await invoke(repo, { query: "race condition", tags: ["race"] });
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.basedOn.length).toBeGreaterThan(0);
    expect(r.text).toContain("mutex");
    // Both alice + bob should appear (both have race decisions); css decision not relevant.
    const names = r.basedOn.map((b) => b.displayName);
    expect(names).toContain("Alice");
    expect(names).toContain("Bob");
  });

  it("formatAdvice prints fused advice + attribution", async () => {
    await contribute(repo, {
      contributorId: "alice", displayName: "Alice", scope: "test",
      decisions: [{ ts: "2026-05-01T00:00:00Z", context: "race", reasoning: "use mutex", tags: ["race"] }],
    });
    const r = await invoke(repo, { query: "race" });
    const out = formatAdvice(r);
    expect(out).toContain("GHOST MENTOR");
    expect(out).toContain("Alice");
    expect(out).toContain("Based on");
  });

  it("invocation is recorded to invocations.jsonl for marketplace audit", async () => {
    await contribute(repo, {
      contributorId: "alice", displayName: "Alice", scope: "x",
      decisions: [{ ts: "2026-05-01T00:00:00Z", context: "race", reasoning: "mutex", tags: ["race"] }],
    });
    await invoke(repo, { query: "race" });
    expect(existsSync(join(repo, ".mneme/ghost_mentor/invocations.jsonl"))).toBe(true);
  });
});
