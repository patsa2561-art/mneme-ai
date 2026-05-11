/**
 * v1.57.0 -- SOVEREIGNTY KERNEL test suite, 100% accuracy lock-in.
 *
 * Tests use an injected fetchImpl (mock Ollama) so they run without
 * a live Ollama instance and stay deterministic across machines.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ollamaGenerate, ollamaHealth } from "./ollama_client.js";
import { buildContext } from "./context_builder.js";
import { sovereignAsk } from "./answer.js";

function setupRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "mneme-sovereign-"));
  writeFileSync(join(repo, "package.json"), JSON.stringify({
    name: "test-repo",
    version: "1.57.0",
    dependencies: { typescript: "^5.0.0" },
  }, null, 2));
  writeFileSync(join(repo, "README.md"), "Mneme is built with TypeScript and depends on the harmonic mean.");
  const pkg = join(repo, "packages", "core", "src");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(
    join(pkg, "harmonic.ts"),
    `// harmonic mean calculator for the resonance layer\nexport function harmonicMean(xs: number[]): number {\n  if (xs.some((x) => x <= 0)) return 0;\n  return xs.length / xs.reduce((a, b) => a + 1 / b, 0);\n}\n`,
  );
  try {
    execSync(`git init -q`, { cwd: repo, stdio: "ignore" });
    execSync(`git config user.email "t@t.com"`, { cwd: repo, stdio: "ignore" });
    execSync(`git config user.name "t"`, { cwd: repo, stdio: "ignore" });
    execSync(`git add .`, { cwd: repo, stdio: "ignore" });
    execSync(`git commit -m "feat(harmonic): add harmonic mean for resonance layer"`, { cwd: repo, stdio: "ignore" });
  } catch { /* */ }
  return repo;
}
function cleanup(r: string) { try { rmSync(r, { recursive: true, force: true }); } catch { /* */ } }

/** Mock Ollama fetch impl that returns a fixed response. */
function mockOllama(response: string, opts?: { healthOk?: boolean }) {
  return async (url: string, init?: { method?: string }): Promise<{ status: number; body: string }> => {
    if (url.endsWith("/api/tags")) {
      return opts?.healthOk === false
        ? { status: 500, body: "ollama down" }
        : { status: 200, body: JSON.stringify({ models: [] }) };
    }
    if (url.endsWith("/api/generate") && init?.method === "POST") {
      return { status: 200, body: JSON.stringify({ response, prompt_eval_count: 100, eval_count: 50 }) };
    }
    return { status: 404, body: "not found" };
  };
}

describe("v1.57 Sovereignty · ollama client", () => {
  it("ollamaGenerate returns parsed response on 200", async () => {
    const r = await ollamaGenerate("hello", { fetchImpl: mockOllama("hi back") });
    expect(r.ok).toBe(true);
    expect(r.text).toBe("hi back");
    expect(r.promptTokens).toBe(100);
    expect(r.responseTokens).toBe(50);
  });

  it("ollamaGenerate flags non-200 as not-ok", async () => {
    const r = await ollamaGenerate("hello", {
      fetchImpl: async () => ({ status: 500, body: "boom" }),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("boom");
  });

  it("ollamaHealth detects reachable instance", async () => {
    const r = await ollamaHealth({ fetchImpl: mockOllama("") });
    expect(r.ok).toBe(true);
  });

  it("ollamaHealth detects down instance", async () => {
    const r = await ollamaHealth({
      fetchImpl: async () => ({ status: 0, body: "ECONNREFUSED" }),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("0");
  });
});

describe("v1.57 Sovereignty · context builder", () => {
  let repo: string;
  beforeEach(() => { repo = setupRepo(); });
  afterEach(() => cleanup(repo));

  it("builds a prompt with SYSTEM + evidence + USER QUESTION sections", () => {
    const ctx = buildContext(repo, "what is the harmonic mean used for?");
    expect(ctx.prompt).toContain("[SYSTEM]");
    expect(ctx.prompt).toContain("[USER QUESTION]");
    expect(ctx.prompt).toContain("harmonic mean");
  });

  it("picks REPO evidence for token-matching files", () => {
    const ctx = buildContext(repo, "harmonic mean resonance");
    const repoSlice = ctx.slices.find((s) => s.label === "REPO");
    expect(repoSlice).toBeDefined();
    expect(repoSlice!.lines.length).toBeGreaterThan(0);
    // The .ts file with "harmonic" should be cited.
    expect(repoSlice!.lines.some((l) => l.includes("harmonic.ts"))).toBe(true);
  });

  it("picks HISTORY evidence for token-matching commits", () => {
    const ctx = buildContext(repo, "harmonic resonance layer");
    const histSlice = ctx.slices.find((s) => s.label === "HISTORY");
    expect(histSlice).toBeDefined();
    expect(histSlice!.lines.some((l) => l.includes("harmonic"))).toBe(true);
  });

  it("empty/vague question yields NO EVIDENCE marker", () => {
    const ctx = buildContext(repo, "??");
    expect(ctx.prompt).toContain("NO EVIDENCE FOUND");
  });

  it("token-counts the assembled prompt", () => {
    const ctx = buildContext(repo, "what is harmonic mean?");
    expect(ctx.approxTokens).toBeGreaterThan(50);
    expect(ctx.approxTokens).toBeLessThan(5000);
  });
});

describe("v1.57 Sovereignty · sovereignAsk end-to-end", () => {
  let repo: string;
  beforeEach(() => { repo = setupRepo(); });
  afterEach(() => cleanup(repo));

  it("returns 'ollama-unreachable' when health check fails", async () => {
    const r = await sovereignAsk({
      repoRoot: repo,
      question: "any",
      ollama: { fetchImpl: mockOllama("", { healthOk: false }) },
    });
    expect(r.verdict).toBe("ollama-unreachable");
    expect(r.text).toBe("");
  });

  it("returns grounded answer when Ollama produces a meta-refusal", async () => {
    const meta = "I do not see this in the evidence; the next step would be reading packages/core/src/harmonic.ts.";
    const r = await sovereignAsk({
      repoRoot: repo,
      question: "what is the harmonic mean?",
      ollama: { fetchImpl: mockOllama(meta) },
    });
    expect(r.verdict).toBe("grounded");
    expect(r.text).toBe(meta);
  });

  it("refuses ungrounded answer (Ollama claims something contradicting repo)", async () => {
    // Ollama returns a claim that Mneme is written in Rust (it isn't).
    const lie = "Mneme is written in Rust and uses the Tokio runtime.";
    const r = await sovereignAsk({
      repoRoot: repo,
      question: "what language is Mneme in?",
      ollama: { fetchImpl: mockOllama(lie) },
    });
    expect(["refused", "ungrounded"]).toContain(r.verdict);
  });

  it("--skip-grounding equivalent passes through ungrounded text", async () => {
    const lie = "Mneme is written in Rust.";
    const r = await sovereignAsk({
      repoRoot: repo,
      question: "what language?",
      ollama: { fetchImpl: mockOllama(lie) },
      skipGroundingGate: true,
    });
    expect(r.verdict).toBe("grounded");
    expect(r.text).toBe(lie);
  });

  it("captures latency breakdown", async () => {
    const r = await sovereignAsk({
      repoRoot: repo,
      question: "harmonic",
      ollama: { fetchImpl: mockOllama("answer") },
    });
    expect(r.latency.contextMs).toBeGreaterThanOrEqual(0);
    expect(r.latency.ollamaMs).toBeGreaterThanOrEqual(0);
    expect(r.latency.groundingMs).toBeGreaterThanOrEqual(0);
    expect(r.latency.totalMs).toBeGreaterThanOrEqual(0);
  });

  it("surfaces evidence slices in the response", async () => {
    const r = await sovereignAsk({
      repoRoot: repo,
      question: "harmonic mean",
      ollama: { fetchImpl: mockOllama("answer") },
    });
    expect(r.evidence.length).toBeGreaterThan(0);
  });

  it("empty Ollama response -> ungrounded verdict", async () => {
    const r = await sovereignAsk({
      repoRoot: repo,
      question: "any",
      ollama: { fetchImpl: mockOllama("") },
    });
    expect(r.verdict).toBe("ungrounded");
  });
});
