import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  detectPlatform,
  buildAllAdapters,
  parseGitHubRepo,
  parseGitHubPrNumber,
  detectBitbucketRepo,
  createGitHubAdapter,
  createGitLabAdapter,
  createBitbucketAdapter,
} from "./index.js";

// ─── env scaffolding ─────────────────────────────────────────────────

const ENV_KEYS = [
  "GITHUB_ACTIONS",
  "GITHUB_REPOSITORY",
  "GITHUB_REF",
  "GITHUB_TOKEN",
  "GITHUB_API_URL",
  "GITLAB_CI",
  "CI_PROJECT_ID",
  "CI_PROJECT_PATH",
  "CI_MERGE_REQUEST_IID",
  "CI_API_V4_URL",
  "CI_JOB_TOKEN",
  "GITLAB_TOKEN",
  "GITLAB_MR_IID",
  "BITBUCKET_BUILD_NUMBER",
  "BITBUCKET_WORKSPACE",
  "BITBUCKET_REPO_SLUG",
  "BITBUCKET_REPO_FULL_NAME",
  "BITBUCKET_PR_ID",
  "BITBUCKET_TOKEN",
  "BITBUCKET_USERNAME",
  "BITBUCKET_APP_PASSWORD",
];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// ─── parsers ─────────────────────────────────────────────────────────

describe("parseGitHubRepo", () => {
  it("parses owner/repo cleanly", () => {
    expect(parseGitHubRepo("octocat/Hello-World")).toEqual({ owner: "octocat", name: "Hello-World" });
  });
  it("strips a trailing .git", () => {
    expect(parseGitHubRepo("octocat/Hello-World.git")).toEqual({ owner: "octocat", name: "Hello-World" });
  });
  it("rejects malformed input", () => {
    expect(parseGitHubRepo("")).toBeNull();
    expect(parseGitHubRepo(undefined)).toBeNull();
    expect(parseGitHubRepo("nope")).toBeNull();
  });
});

describe("parseGitHubPrNumber", () => {
  it("extracts the PR number from a refs/pull ref", () => {
    expect(parseGitHubPrNumber("refs/pull/42/merge")).toBe(42);
    expect(parseGitHubPrNumber("refs/pull/7/head")).toBe(7);
  });
  it("returns null for non-PR refs", () => {
    expect(parseGitHubPrNumber("refs/heads/main")).toBeNull();
    expect(parseGitHubPrNumber(undefined)).toBeNull();
  });
});

describe("detectBitbucketRepo", () => {
  it("joins workspace + slug when both present", () => {
    process.env.BITBUCKET_WORKSPACE = "ws";
    process.env.BITBUCKET_REPO_SLUG = "slug";
    expect(detectBitbucketRepo()).toBe("ws/slug");
  });
  it("falls back to BITBUCKET_REPO_FULL_NAME", () => {
    process.env.BITBUCKET_REPO_FULL_NAME = "ws/slug";
    expect(detectBitbucketRepo()).toBe("ws/slug");
  });
  it("returns undefined when nothing is set", () => {
    expect(detectBitbucketRepo()).toBeUndefined();
  });
});

// ─── auto-detect ─────────────────────────────────────────────────────

describe("detectPlatform — auto-detect", () => {
  it("picks GitHub when GITHUB_ACTIONS=true", () => {
    process.env.GITHUB_ACTIONS = "true";
    const p = detectPlatform();
    expect(p?.name).toBe("github");
  });

  it("picks GitLab when GITLAB_CI=true", () => {
    process.env.GITLAB_CI = "true";
    const p = detectPlatform();
    expect(p?.name).toBe("gitlab");
  });

  it("picks Bitbucket when BITBUCKET_BUILD_NUMBER is set", () => {
    process.env.BITBUCKET_BUILD_NUMBER = "1";
    const p = detectPlatform();
    expect(p?.name).toBe("bitbucket");
  });

  it("returns null when no platform env is present", () => {
    expect(detectPlatform()).toBeNull();
  });

  it("respects an explicit name override", () => {
    process.env.GITHUB_ACTIONS = "true"; // GitHub would auto-match
    const p = detectPlatform({ name: "gitlab" });
    expect(p?.name).toBe("gitlab");
  });

  it("buildAllAdapters returns all three adapters in stable order", () => {
    const xs = buildAllAdapters();
    expect(xs.map((a) => a.name)).toEqual(["github", "gitlab", "bitbucket"]);
  });
});

// ─── context resolution ─────────────────────────────────────────────

describe("resolveContext", () => {
  it("GitHub adapter pulls repo + pr + token from env", () => {
    process.env.GITHUB_REPOSITORY = "patsa/mneme-ai";
    process.env.GITHUB_REF = "refs/pull/9/merge";
    process.env.GITHUB_TOKEN = "ghs_xxx";
    const ctx = createGitHubAdapter().resolveContext();
    expect(ctx.repo).toBe("patsa/mneme-ai");
    expect(ctx.pr).toBe(9);
    expect(ctx.token).toBe("ghs_xxx");
  });

  it("GitLab adapter prefers GITLAB_TOKEN over CI_JOB_TOKEN", () => {
    process.env.CI_JOB_TOKEN = "ci-token";
    process.env.GITLAB_TOKEN = "gl-pat";
    process.env.CI_PROJECT_ID = "12345";
    process.env.CI_MERGE_REQUEST_IID = "7";
    const ctx = createGitLabAdapter().resolveContext();
    expect(ctx.repo).toBe("12345");
    expect(ctx.pr).toBe(7);
    expect(ctx.token).toBe("gl-pat");
  });

  it("Bitbucket adapter packs username:app_password when no BITBUCKET_TOKEN", () => {
    process.env.BITBUCKET_USERNAME = "user";
    process.env.BITBUCKET_APP_PASSWORD = "pw";
    process.env.BITBUCKET_WORKSPACE = "ws";
    process.env.BITBUCKET_REPO_SLUG = "slug";
    process.env.BITBUCKET_PR_ID = "33";
    const ctx = createBitbucketAdapter().resolveContext();
    expect(ctx.token).toBe("user:pw");
    expect(ctx.repo).toBe("ws/slug");
    expect(ctx.pr).toBe(33);
  });
});

// ─── post (with mock fetch) ─────────────────────────────────────────

describe("adapter.post — happy path + error handling", () => {
  it("GitHub posts to the issues/comments endpoint with Bearer auth", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ html_url: "https://x" }), { status: 201 }));
    const adapter = createGitHubAdapter({ fetcher: fetcher as unknown as typeof fetch });
    const res = await adapter.post({ repo: "owner/name", pr: 5, token: "tok", body: "hello" });
    expect(res.ok).toBe(true);
    expect(res.statusCode).toBe(201);
    expect(res.url).toBe("https://x");
    const call = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(call[0])).toContain("/repos/owner/name/issues/5/comments");
    const init = call[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toEqual({ body: "hello" });
  });

  it("GitHub returns ok=false on non-2xx", async () => {
    const fetcher = vi.fn(async () => new Response("nope", { status: 403 }));
    const adapter = createGitHubAdapter({ fetcher: fetcher as unknown as typeof fetch });
    const res = await adapter.post({ repo: "owner/name", pr: 5, token: "tok", body: "x" });
    expect(res.ok).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.error).toContain("403");
  });

  it("GitHub returns a friendly error when token is missing", async () => {
    const adapter = createGitHubAdapter({ fetcher: vi.fn() as unknown as typeof fetch });
    const res = await adapter.post({ repo: "owner/name", pr: 5, token: undefined, body: "x" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("GITHUB_TOKEN");
  });

  it("GitHub returns a friendly error when PR number is missing", async () => {
    const adapter = createGitHubAdapter({ fetcher: vi.fn() as unknown as typeof fetch });
    const res = await adapter.post({ repo: "owner/name", pr: undefined, token: "tok", body: "x" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("PR number");
  });

  it("GitLab uses the PRIVATE-TOKEN header and url-encodes the project id", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: 1 }), { status: 201 }));
    const adapter = createGitLabAdapter({ fetcher: fetcher as unknown as typeof fetch });
    const res = await adapter.post({ repo: "group/sub/project", pr: 11, token: "gl", body: "hi" });
    expect(res.ok).toBe(true);
    const call = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(call[0])).toContain("/projects/group%2Fsub%2Fproject/merge_requests/11/notes");
    const init = call[1] as RequestInit;
    expect((init.headers as Record<string, string>)["PRIVATE-TOKEN"]).toBe("gl");
  });

  it("Bitbucket sends Basic auth when token contains a colon", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({}), { status: 201 }));
    const adapter = createBitbucketAdapter({ fetcher: fetcher as unknown as typeof fetch });
    const res = await adapter.post({ repo: "ws/slug", pr: 4, token: "user:pw", body: "x" });
    expect(res.ok).toBe(true);
    const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    const auth = (init.headers as Record<string, string>).Authorization;
    expect(auth.startsWith("Basic ")).toBe(true);
    expect(Buffer.from(auth.slice(6), "base64").toString("utf8")).toBe("user:pw");
  });

  it("network failure surfaces as ok=false (no throw)", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const adapter = createGitHubAdapter({ fetcher: fetcher as unknown as typeof fetch });
    const res = await adapter.post({ repo: "owner/name", pr: 1, token: "t", body: "x" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("network error");
  });
});
