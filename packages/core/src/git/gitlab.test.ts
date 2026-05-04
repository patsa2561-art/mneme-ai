import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GitLabAdapter } from "./gitlab.js";
import type { Commit } from "../types.js";

describe("GitLabAdapter", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires projectPath", () => {
    expect(() => new GitLabAdapter({ projectPath: "" })).toThrow();
  });

  it("URL-encodes group/sub/repo paths correctly", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(
        JSON.stringify({ iid: 7, title: "T", description: "D", web_url: "u", state: "merged" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const a = new GitLabAdapter({ projectPath: "group/sub/repo" });
    await a.fetchMergeRequest(7);
    const calledUrl = (globalThis.fetch as any).mock.calls[0][0];
    expect(calledUrl).toContain("group%2Fsub%2Frepo");
    expect(calledUrl).toContain("/merge_requests/7");
  });

  it("strips .git suffix and leading slash from projectPath", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ iid: 1, title: "", description: "", web_url: "", state: "" }), {
        status: 200,
      }),
    );
    const a = new GitLabAdapter({ projectPath: "/foo/bar.git" });
    await a.fetchMergeRequest(1);
    const calledUrl = (globalThis.fetch as any).mock.calls[0][0];
    expect(calledUrl).toContain("foo%2Fbar");
    expect(calledUrl).not.toContain(".git");
  });

  it("fetchMergeRequest returns parsed MR", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(
        JSON.stringify({
          iid: 42,
          title: "Fix BigInt",
          description: "Long body",
          web_url: "https://gitlab.com/foo/bar/-/merge_requests/42",
          state: "merged",
          merged_at: "2026-01-15T10:00:00Z",
        }),
        { status: 200 },
      ),
    );
    const a = new GitLabAdapter({ projectPath: "foo/bar" });
    const mr = await a.fetchMergeRequest(42);
    expect(mr).not.toBeNull();
    expect(mr!.iid).toBe(42);
    expect(mr!.title).toBe("Fix BigInt");
    expect(mr!.mergedAt).toBe("2026-01-15T10:00:00Z");
  });

  it("returns null on 404", async () => {
    (globalThis.fetch as any).mockResolvedValue(new Response("", { status: 404 }));
    const a = new GitLabAdapter({ projectPath: "foo/bar" });
    expect(await a.fetchMergeRequest(999)).toBeNull();
  });

  it("returns null when API returns {message:'404 Not Found'}", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ message: "404 Not Found" }), { status: 200 }),
    );
    const a = new GitLabAdapter({ projectPath: "foo/bar" });
    expect(await a.fetchMergeRequest(999)).toBeNull();
  });

  it("sends PRIVATE-TOKEN header when token present", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ iid: 1, title: "", description: "", web_url: "", state: "" }), {
        status: 200,
      }),
    );
    const a = new GitLabAdapter({ projectPath: "foo/bar", token: "secret" });
    await a.fetchMergeRequest(1);
    const init = (globalThis.fetch as any).mock.calls[0][1];
    expect(init.headers["private-token"]).toBe("secret");
  });

  it("uses custom baseUrl for self-hosted GitLab", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ iid: 1, title: "", description: "", web_url: "", state: "" }), {
        status: 200,
      }),
    );
    const a = new GitLabAdapter({
      projectPath: "team/app",
      baseUrl: "https://gitlab.internal.corp/",
    });
    await a.fetchMergeRequest(1);
    const calledUrl = (globalThis.fetch as any).mock.calls[0][0];
    expect(calledUrl.startsWith("https://gitlab.internal.corp/")).toBe(true);
  });

  it("hydrateCommits fills prTitle/prBody for MR-bound commits", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(
        JSON.stringify({ iid: 42, title: "T", description: "B", web_url: "u", state: "merged" }),
        { status: 200 },
      ),
    );
    const a = new GitLabAdapter({ projectPath: "foo/bar" });
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
    const a = new GitLabAdapter({ projectPath: "foo/bar" });
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
});
