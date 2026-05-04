import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GitHubAdapter } from "./github.js";
import type { Commit } from "../types.js";

describe("GitHubAdapter", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires owner + repo", () => {
    expect(() => new GitHubAdapter({ owner: "", repo: "x" })).toThrow();
    expect(() => new GitHubAdapter({ owner: "x", repo: "" })).toThrow();
  });

  it("fetchPullRequest returns parsed PR info", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(
        JSON.stringify({
          number: 42,
          title: "Fix BigInt",
          body: "Stripe sometimes sends bigint",
          html_url: "https://github.com/foo/bar/pull/42",
          state: "merged",
          merged_at: "2025-01-15T10:00:00Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const a = new GitHubAdapter({ owner: "foo", repo: "bar", token: "tok" });
    const pr = await a.fetchPullRequest(42);
    expect(pr).not.toBeNull();
    expect(pr!.number).toBe(42);
    expect(pr!.title).toBe("Fix BigInt");
    expect(pr!.mergedAt).toBe("2025-01-15T10:00:00Z");
  });

  it("returns null on 404", async () => {
    (globalThis.fetch as any).mockResolvedValue(new Response("", { status: 404 }));
    const a = new GitHubAdapter({ owner: "foo", repo: "bar" });
    expect(await a.fetchPullRequest(999)).toBeNull();
  });

  it("hydrateCommits fills prTitle/prBody for commits with prNumber", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(
        JSON.stringify({ number: 42, title: "T", body: "B", html_url: "", state: "merged" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const a = new GitHubAdapter({ owner: "foo", repo: "bar" });
    const commits: Commit[] = [
      {
        hash: "h",
        shortHash: "h",
        authorName: "x",
        authorEmail: "x@x",
        authorDate: "2025-01-01T00:00:00Z",
        committerDate: "2025-01-01T00:00:00Z",
        subject: "fix (#42)",
        body: "",
        parents: [],
        files: [],
        prNumber: 42,
      },
    ];
    await a.hydrateCommits(commits);
    expect(commits[0]!.prTitle).toBe("T");
    expect(commits[0]!.prBody).toBe("B");
  });

  it("does not refetch commits that already have a PR body", async () => {
    const a = new GitHubAdapter({ owner: "foo", repo: "bar" });
    const commits: Commit[] = [
      {
        hash: "h",
        shortHash: "h",
        authorName: "x",
        authorEmail: "x@x",
        authorDate: "2025-01-01T00:00:00Z",
        committerDate: "2025-01-01T00:00:00Z",
        subject: "S",
        body: "",
        parents: [],
        files: [],
        prNumber: 1,
        prBody: "already there",
      },
    ];
    await a.hydrateCommits(commits);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("sends Authorization header when token present", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
    const a = new GitHubAdapter({ owner: "foo", repo: "bar", token: "secret" });
    await a.fetchPullRequest(1);
    const init = (globalThis.fetch as any).mock.calls[0][1];
    expect(init.headers.authorization).toBe("Bearer secret");
  });
});
