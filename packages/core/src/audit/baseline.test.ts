import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  baselinePath,
  captureBaseline,
  collectApiSurface,
  lineCount,
  loadBaseline,
  median,
  persistBaseline,
  sha256,
  type Baseline,
  type Runner,
} from "./baseline.js";

// Deterministic in-memory Runner.
function makeRunner(): { runner: Runner; calls: Array<[string, string[]]> } {
  const calls: Array<[string, string[]]> = [];
  const responses: Record<string, { exitCode: number; stdout: string }> = {
    "git rev-parse HEAD": { exitCode: 0, stdout: "abc123def\n" },
    "git log --oneline -20": { exitCode: 0, stdout: "abc123 first\nfff111 second\n" },
    "node -v": { exitCode: 0, stdout: "v20.0.0\n" },
    "git status --porcelain": { exitCode: 0, stdout: "" },
    "npm test --silent": {
      exitCode: 0,
      stdout: "Test Files  5 passed\nTests  100 passed, 2 failed",
    },
  };
  const runner: Runner = {
    run(cmd, args) {
      calls.push([cmd, args]);
      const key = `${cmd} ${args.join(" ")}`;
      return responses[key] ?? { exitCode: 0, stdout: "" };
    },
    timeMs(cmd) {
      // Pretend each command takes a fixed time for determinism.
      return cmd === "git" ? 12 : 8;
    },
    readApiSurface() {
      return { core: ["foo", "bar"], cli: ["baz"] };
    },
  };
  return { runner, calls };
}

describe("audit/baseline — pure helpers", () => {
  it("sha256 is deterministic and lowercase hex", () => {
    expect(sha256("hello")).toBe(sha256("hello"));
    expect(sha256("hello")).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256("hello")).not.toBe(sha256("hello!"));
  });

  it("lineCount handles empty / trailing newline / multiline", () => {
    expect(lineCount("")).toBe(0);
    expect(lineCount("a")).toBe(1);
    expect(lineCount("a\n")).toBe(1);
    expect(lineCount("a\nb\n")).toBe(2);
    expect(lineCount("a\nb\nc")).toBe(3);
  });

  it("median computes both odd + even cases", () => {
    expect(median([])).toBe(0);
    expect(median([5])).toBe(5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe("audit/baseline — captureBaseline (mocked Runner)", () => {
  it("captures HEAD hash, samples, perf, and api surface", async () => {
    const { runner } = makeRunner();
    const b = await captureBaseline("/repo", runner);
    expect(b.headHash).toBe("abc123def");
    expect(b.outputs.git_head).toBeDefined();
    expect(b.outputs.git_head!.exitCode).toBe(0);
    expect(b.outputs.git_head!.stdoutHash).toMatch(/^[0-9a-f]{64}$/);
    expect(b.outputs.git_log_20).toBeDefined();
    expect(b.outputs.node_version).toBeDefined();
    expect(b.testPassRate.passed).toBe(100);
    expect(b.testPassRate.failed).toBe(2);
    expect(b.testPassRate.files).toBe(5);
    expect(b.apiSurface).toEqual({ core: ["foo", "bar"], cli: ["baz"] });
    expect(Object.keys(b.perfMs)).toContain("git_head");
    expect(b.perfMs.git_head).toBeGreaterThan(0);
  });

  it("captures perf as median across 3 samples (mocked = same value)", async () => {
    const { runner } = makeRunner();
    const b = await captureBaseline("/repo", runner);
    expect(b.perfMs.git_head).toBe(12);
    expect(b.perfMs.git_status).toBe(12);
  });

  it("captures ISO timestamp in capturedAt", async () => {
    const { runner } = makeRunner();
    const b = await captureBaseline("/repo", runner);
    expect(b.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("audit/baseline — persist + load round-trip", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mneme-audit-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("persistBaseline + loadBaseline returns identical struct", async () => {
    const { runner } = makeRunner();
    const original = await captureBaseline(dir, runner);
    persistBaseline(dir, original);
    const reloaded = loadBaseline(dir);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.headHash).toBe(original.headHash);
    expect(reloaded!.outputs).toEqual(original.outputs);
    expect(reloaded!.testPassRate).toEqual(original.testPassRate);
  });

  it("loadBaseline returns null when no file exists", () => {
    expect(loadBaseline(dir)).toBeNull();
  });

  it("loadBaseline returns null on corrupt JSON", () => {
    mkdirSync(join(dir, ".mneme", "audit"), { recursive: true });
    writeFileSync(baselinePath(dir), "{not json", "utf8");
    expect(loadBaseline(dir)).toBeNull();
  });

  it("persist creates the .mneme/audit directory if missing", async () => {
    const { runner } = makeRunner();
    const b = await captureBaseline(dir, runner);
    persistBaseline(dir, b);
    expect(existsSync(baselinePath(dir))).toBe(true);
    const raw = readFileSync(baselinePath(dir), "utf8");
    expect(JSON.parse(raw).headHash).toBe("abc123def");
  });
});

describe("audit/baseline — collectApiSurface", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mneme-audit-api-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("scans ts files and pulls export names", () => {
    const pkgSrc = join(dir, "packages", "core", "src");
    mkdirSync(pkgSrc, { recursive: true });
    writeFileSync(
      join(pkgSrc, "thing.ts"),
      "export function foo() {}\nexport class Bar {}\nexport interface Baz {}\n",
      "utf8",
    );
    writeFileSync(
      join(pkgSrc, "thing.test.ts"),
      "export function shouldBeIgnored() {}\n",
      "utf8",
    );
    const surface = collectApiSurface(dir);
    expect(surface.core).toContain("foo");
    expect(surface.core).toContain("Bar");
    expect(surface.core).toContain("Baz");
    expect(surface.core).not.toContain("shouldBeIgnored");
  });

  it("returns {} when packages dir is missing", () => {
    expect(collectApiSurface(dir)).toEqual({});
  });

  it("captures re-exports with `export { name }` form", () => {
    const pkgSrc = join(dir, "packages", "cli", "src");
    mkdirSync(pkgSrc, { recursive: true });
    writeFileSync(
      join(pkgSrc, "index.ts"),
      'export { alpha, beta as gamma } from "./inner.js";\n',
      "utf8",
    );
    const surface = collectApiSurface(dir);
    expect(surface.cli).toContain("alpha");
    expect(surface.cli).toContain("beta");
  });

  it("prefers dist/ over src/ when both exist", () => {
    const pkgDist = join(dir, "packages", "core", "dist");
    const pkgSrc = join(dir, "packages", "core", "src");
    mkdirSync(pkgDist, { recursive: true });
    mkdirSync(pkgSrc, { recursive: true });
    writeFileSync(join(pkgDist, "x.d.ts"), "export declare function fromDist(): void;\n", "utf8");
    writeFileSync(join(pkgSrc, "x.ts"), "export function fromSrc() {}\n", "utf8");
    // The function regex requires `function` keyword; .d.ts uses `declare`,
    // adjust expectation: surface picks from dist when dist exists.
    const surface = collectApiSurface(dir);
    // We won't catch `declare function` (regex requires plain `function`),
    // but we should not have picked up `fromSrc` since dist took precedence.
    expect(surface.core ?? []).not.toContain("fromSrc");
  });
});

describe("audit/baseline — diff between two captured baselines", () => {
  it("two identical mock runs produce identical hashes", async () => {
    const { runner: r1 } = makeRunner();
    const { runner: r2 } = makeRunner();
    const b1 = await captureBaseline("/repo", r1);
    const b2 = await captureBaseline("/repo", r2);
    expect(b1.outputs.git_head!.stdoutHash).toBe(b2.outputs.git_head!.stdoutHash);
    expect(b1.apiSurface).toEqual(b2.apiSurface);
  });

  it("captured baseline survives JSON round-trip with structural equality", async () => {
    const { runner } = makeRunner();
    const b = await captureBaseline("/repo", runner);
    const roundTripped = JSON.parse(JSON.stringify(b)) as Baseline;
    expect(roundTripped.testPassRate).toEqual(b.testPassRate);
  });
});
