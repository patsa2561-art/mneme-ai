/**
 * Unit tests for `mneme bot` — the dry-run path, include parsing, and
 * happy / unhappy posting paths.  We never spawn a real CLI here; the
 * runner is stubbed and the platform adapters use a mock fetcher.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { botCommand, parseIncludes, type AnalyzerRunner } from "./bot.js";
import { bot } from "@mneme-ai/core";

type PlatformAdapter = bot.PlatformAdapter;

// ─── helpers ────────────────────────────────────────────────────────

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "mneme-bot-"));
  // Make a real git repo so `git rev-parse --is-inside-work-tree` succeeds.
  const r = spawnSync("git", ["init", "-q", dir], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git init failed: ${r.stderr}`);
  writeFileSync(join(dir, "README.md"), "test\n");
  spawnSync("git", ["-C", dir, "config", "user.email", "test@example.com"], { encoding: "utf8" });
  spawnSync("git", ["-C", dir, "config", "user.name", "Test"], { encoding: "utf8" });
  spawnSync("git", ["-C", dir, "add", "."], { encoding: "utf8" });
  spawnSync("git", ["-C", dir, "commit", "-q", "-m", "init"], { encoding: "utf8" });
  return dir;
}

function makeRunner(map: Record<string, unknown>): AnalyzerRunner {
  return {
    run(args) {
      const key = args.join(" ");
      return key in map ? map[key] : null;
    },
  };
}

const PASS_CERT = {
  sessionId: "abc1234",
  capturedAt: "2026-05-07T00:00:00.000Z",
  axes: {
    behavioralParity: { verdict: "pass", reason: "match", details: [], evidence: [], confidence: "medium" },
    apiContractDrift: { verdict: "pass", reason: "same", details: [], evidence: [], confidence: "high" },
    testPassRate: {
      verdict: "pass", reason: "no new failures", before: "1645/0", after: "1645/0",
      details: [], evidence: [], confidence: "high",
    },
    perfRegression: { verdict: "pass", reason: "+2%", deltaPercent: 2, details: [], evidence: [], confidence: "medium" },
    aiNarrative: { verdict: "pass", reason: "trust 1.00", checks: [], details: [], evidence: [], confidence: "high" },
  },
  forensicAxes: {
    size: { verdict: "pass", score: 0.1, reason: "ok", evidence: [] },
    files: { verdict: "pass", score: 0.1, reason: "ok", evidence: [] },
    style: { verdict: "pass", score: 0.1, reason: "ok", evidence: [] },
    time: { verdict: "pass", score: 0.1, reason: "ok", evidence: [] },
  },
  overallVerdict: "pass",
  coverage: { verified: 5, skipped: 0, total: 5, confidence: "high" },
  exitCode: 0,
};

// ─── env scaffolding (avoid leaking real CI env into tests) ─────────

const ENV_KEYS = [
  "GITHUB_ACTIONS",
  "GITHUB_REPOSITORY",
  "GITHUB_REF",
  "GITHUB_TOKEN",
  "GITLAB_CI",
  "BITBUCKET_BUILD_NUMBER",
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

// ─── parseIncludes ───────────────────────────────────────────────────

describe("parseIncludes", () => {
  it("returns the default set when input is empty/undefined", () => {
    expect(parseIncludes(undefined)).toEqual(["audit", "atrophy"]);
    expect(parseIncludes("")).toEqual(["audit", "atrophy"]);
  });
  it("respects a custom list", () => {
    expect(parseIncludes("ghost,promise")).toEqual(["ghost", "promise"]);
  });
  it("ignores unknown analyzers", () => {
    expect(parseIncludes("audit,bogus,atrophy")).toEqual(["audit", "atrophy"]);
  });
  it("dedupes repeat entries and lower-cases", () => {
    expect(parseIncludes("AUDIT,audit, atrophy ")).toEqual(["audit", "atrophy"]);
  });
});

// ─── botCommand ──────────────────────────────────────────────────────

describe("botCommand — dry-run path", () => {
  let repo: string;
  beforeEach(() => {
    repo = makeRepo();
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("dry-run prints the assembled comment without posting", async () => {
    const out: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      out.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    }) as typeof process.stdout.write;

    try {
      const code = await botCommand({
        cwd: repo,
        dryRun: true,
        include: "audit",
        runner: makeRunner({ "audit --certify": PASS_CERT }),
        adapters: [],
      });
      expect(code).toBe(0);
    } finally {
      process.stdout.write = origWrite;
    }
    const joined = out.join("");
    expect(joined).toContain("Mneme audit");
    expect(joined).toContain("Verdict:");
    expect(joined).toContain("✅ pass");
  });

  it("dry-run --json emits the structured envelope including the body", async () => {
    const out: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      out.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    }) as typeof process.stdout.write;

    try {
      const code = await botCommand({
        cwd: repo,
        dryRun: true,
        json: true,
        include: "audit",
        runner: makeRunner({ "audit --certify": PASS_CERT }),
        adapters: [],
      });
      expect(code).toBe(0);
    } finally {
      process.stdout.write = origWrite;
    }
    const parsed = JSON.parse(out.join(""));
    expect(parsed.mode).toBe("dry-run");
    expect(parsed.includes).toEqual(["audit"]);
    expect(parsed.body).toContain("Mneme audit");
  });

  it("returns 1 when not in a git repo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mneme-bot-nogit-"));
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (() => true) as typeof process.stderr.write;
    try {
      const code = await botCommand({
        cwd: dir,
        dryRun: true,
        runner: makeRunner({}),
        adapters: [],
      });
      expect(code).toBe(1);
    } finally {
      process.stderr.write = origErr;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── post path with mocked adapter ──────────────────────────────────

describe("botCommand — post path", () => {
  let repo: string;
  beforeEach(() => {
    repo = makeRepo();
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("returns 1 when no adapter is detected and --dry-run is not set", async () => {
    const errs: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      errs.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    }) as typeof process.stderr.write;

    try {
      const code = await botCommand({
        cwd: repo,
        runner: makeRunner({ "audit --certify": PASS_CERT }),
        adapters: [],
      });
      expect(code).toBe(1);
    } finally {
      process.stderr.write = origErr;
    }
    expect(errs.join("")).toContain("No CI platform detected");
  });

  it("uses the explicit --platform override and exits 1 on missing token", async () => {
    const adapter: PlatformAdapter = {
      name: "github",
      detect: () => ({ matches: false, reason: "" }),
      resolveContext: () => ({ repo: "owner/name", pr: 5, token: undefined }),
      post: vi.fn(async () => ({ ok: false, error: "GITHUB_TOKEN missing" })),
    };
    const code = await botCommand({
      cwd: repo,
      platform: "github",
      runner: makeRunner({ "audit --certify": PASS_CERT }),
      adapters: [adapter],
    });
    expect(code).toBe(1);
    expect(adapter.post).toHaveBeenCalledTimes(1);
  });

  it("returns 0 and reports success when the adapter posts ok", async () => {
    const adapter: PlatformAdapter = {
      name: "github",
      detect: () => ({ matches: true, reason: "stub" }),
      resolveContext: () => ({ repo: "o/n", pr: 9, token: "tok" }),
      post: vi.fn(async () => ({ ok: true, statusCode: 201, url: "https://x" })),
    };
    const code = await botCommand({
      cwd: repo,
      runner: makeRunner({ "audit --certify": PASS_CERT }),
      adapters: [adapter],
    });
    expect(code).toBe(0);
    expect(adapter.post).toHaveBeenCalledTimes(1);
    const call = (adapter.post as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.body).toContain("Mneme audit");
    expect(call.pr).toBe(9);
  });
});

// ─── live smoke against the built CLI (skipped if dist missing) ─────

const REPO = process.cwd().replace(/\\/g, "/");
const CLI = join(REPO, "packages/cli/bin/mneme.js");
const distExists = (() => {
  try {
    return require("fs").existsSync(join(REPO, "packages/cli/dist/commands/bot.js"));
  } catch {
    return false;
  }
})();
const describeIfBuilt = distExists ? describe : describe.skip;

// v2.19.7 — retry up to 2 times. The built-CLI smoke spawns a Node
// subprocess and reads its full stdout; under heavy CI parallelism this
// occasionally hits transient EBUSY (Windows) or partial-stream reads.
// The CLI itself is deterministic — flakes are environmental.
describeIfBuilt("mneme bot — built CLI smoke", { retry: 2 }, () => {
  it("`mneme bot --dry-run --include audit` prints a comment and exits 0", () => {
    const r = spawnSync(process.execPath, [CLI, "bot", "--dry-run", "--include", "audit"], {
      cwd: REPO,
      encoding: "utf8",
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      windowsHide: true,
      timeout: 120_000,
    });
    if (r.status !== 0) {
      // surface debug
      console.error("smoke stderr:", r.stderr);
      console.error("smoke stdout (first 500):", (r.stdout || "").slice(0, 500));
    }
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Mneme");
  });

  it("`mneme bot --dry-run --json` emits a structured envelope", () => {
    const r = spawnSync(process.execPath, [CLI, "bot", "--dry-run", "--json"], {
      cwd: REPO,
      encoding: "utf8",
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      windowsHide: true,
      timeout: 120_000,
    });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.mode).toBe("dry-run");
    expect(typeof parsed.body).toBe("string");
    expect(parsed.body).toContain("Mneme");
    expect(Array.isArray(parsed.includes)).toBe(true);
  });
});
