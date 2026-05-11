import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extractFactClaims, verifyFacts, checkClaim, hasFalseFact } from "./fact_grounding.js";

describe("fact_grounding · extractFactClaims", () => {
  it("extracts a language claim", () => {
    const claims = extractFactClaims("the daemon is written in rust");
    expect(claims.some((c) => c.kind === "language" && c.asserted === "rust")).toBe(true);
  });

  it("extracts a tool-count claim", () => {
    const claims = extractFactClaims("Mneme has 200 tools");
    expect(claims.some((c) => c.kind === "tool_count" && c.asserted === "200")).toBe(true);
  });

  it("extracts a version claim", () => {
    const claims = extractFactClaims("we shipped v2.5.7 last week");
    expect(claims.some((c) => c.kind === "version" && c.asserted === "2.5.7")).toBe(true);
  });

  it("extracts a file-path claim", () => {
    const claims = extractFactClaims("the bug is in src/utils/helper.ts");
    expect(claims.some((c) => c.kind === "file_exists" && c.asserted === "src/utils/helper.ts")).toBe(true);
  });

  it("extracts a function/class claim", () => {
    const claims = extractFactClaims("the function computeFoo handles edge cases");
    expect(claims.some((c) => c.kind === "function_exists" && c.asserted === "computeFoo")).toBe(true);
  });

  it("multiple claims in one sentence", () => {
    const claims = extractFactClaims("Mneme has 200 tools and the daemon is written in Rust");
    expect(claims.length).toBeGreaterThanOrEqual(2);
    expect(claims.some((c) => c.kind === "language" && c.asserted === "rust")).toBe(true);
    expect(claims.some((c) => c.kind === "tool_count" && c.asserted === "200")).toBe(true);
  });

  it("rejects generic word filter for library claims", () => {
    const claims = extractFactClaims("uses it for everything");
    // 'it' should be filtered out by the GENERIC set
    expect(claims.filter((c) => c.kind === "library_used")).toEqual([]);
  });
});

describe("fact_grounding · verifyFacts — language ground truth", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-grounding-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("verifies TRUE when many .ts files exist", () => {
    mkdirSync(join(repo, "packages/core/src"), { recursive: true });
    for (let i = 0; i < 6; i++) writeFileSync(join(repo, `packages/core/src/m${i}.ts`), "export {};");
    const results = verifyFacts(repo, [{ kind: "language", asserted: "typescript", raw: "in TypeScript" }]);
    expect(results[0]!.verdict).toBe("true");
  });

  it("verifies FALSE when claiming Rust but zero .rs files exist", () => {
    mkdirSync(join(repo, "packages/core/src"), { recursive: true });
    for (let i = 0; i < 10; i++) writeFileSync(join(repo, `packages/core/src/m${i}.ts`), "export {};");
    const results = verifyFacts(repo, [{ kind: "language", asserted: "rust", raw: "in Rust" }]);
    expect(results[0]!.verdict).toBe("false");
    expect(results[0]!.groundTruth).toContain("zero rust");
  });

  it("returns unverifiable for unknown languages", () => {
    const results = verifyFacts(repo, [{ kind: "language", asserted: "klingon", raw: "in Klingon" }]);
    expect(results[0]!.verdict).toBe("unverifiable");
  });
});

describe("fact_grounding · verifyFacts — tool count", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-grounding-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("FALSE when asserted 200 but only 12 in source", () => {
    mkdirSync(join(repo, "packages/mcp/src/tools"), { recursive: true });
    let body = "";
    for (let i = 0; i < 12; i++) body += `{ name: "mneme.test.tool${i}", category: "x" },\n`;
    writeFileSync(join(repo, "packages/mcp/src/tools/_x.ts"), body);
    const results = verifyFacts(repo, [{ kind: "tool_count", asserted: "200", raw: "has 200 tools" }]);
    expect(results[0]!.verdict).toBe("false");
    expect(results[0]!.groundTruth).toBe("12");
  });

  it("TRUE within 15% slack ('around 50' matches 47)", () => {
    mkdirSync(join(repo, "packages/mcp/src/tools"), { recursive: true });
    let body = "";
    for (let i = 0; i < 47; i++) body += `{ name: "mneme.x.t${i}" },\n`;
    writeFileSync(join(repo, "packages/mcp/src/tools/_x.ts"), body);
    const results = verifyFacts(repo, [{ kind: "tool_count", asserted: "50", raw: "has 50 tools" }]);
    expect(results[0]!.verdict).toBe("true");
  });
});

describe("fact_grounding · verifyFacts — library used", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-grounding-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("TRUE when library is in package.json", () => {
    writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "x", version: "1.0.0", dependencies: { express: "^4.0.0" } }));
    const results = verifyFacts(repo, [{ kind: "library_used", asserted: "express", raw: "depends on express" }]);
    expect(results[0]!.verdict).toBe("true");
  });

  it("FALSE when library not in package.json", () => {
    writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "x", version: "1.0.0", dependencies: {} }));
    const results = verifyFacts(repo, [{ kind: "library_used", asserted: "express", raw: "uses express" }]);
    expect(results[0]!.verdict).toBe("false");
  });
});

describe("fact_grounding · verifyFacts — version", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-grounding-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("TRUE when version matches package.json", () => {
    writeFileSync(join(repo, "package.json"), JSON.stringify({ version: "1.50.0" }));
    const results = verifyFacts(repo, [{ kind: "version", asserted: "1.50.0", raw: "v1.50.0" }]);
    expect(results[0]!.verdict).toBe("true");
  });

  it("FALSE when claim says different version", () => {
    writeFileSync(join(repo, "package.json"), JSON.stringify({ version: "1.50.0" }));
    const results = verifyFacts(repo, [{ kind: "version", asserted: "2.0.0", raw: "v2.0.0" }]);
    expect(results[0]!.verdict).toBe("false");
  });
});

describe("fact_grounding · the smoking gun (tester report)", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-grounding-"));
    // Simulate Mneme's actual codebase shape: ~12 TS source files, no Rust.
    mkdirSync(join(repo, "packages/mcp/src/tools"), { recursive: true });
    let body = "";
    for (let i = 0; i < 12; i++) body += `{ name: "mneme.cat.t${i}" },\n`;
    writeFileSync(join(repo, "packages/mcp/src/tools/_x.ts"), body);
    for (let i = 0; i < 12; i++) writeFileSync(join(repo, `packages/mcp/src/tools/_m${i}.ts`), "export {};");
    writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "mneme-ai", version: "1.50.0" }));
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("catches BOTH falsehoods in 'Mneme has 200 tools and the daemon is written in Rust'", () => {
    const results = checkClaim(repo, "Mneme has 200 tools and the daemon is written in Rust");
    expect(hasFalseFact(results)).toBe(true);
    const falseOnes = results.filter((r) => r.verdict === "false");
    expect(falseOnes.length).toBeGreaterThanOrEqual(2);
    expect(falseOnes.some((r) => r.claim.kind === "language" && r.claim.asserted === "rust")).toBe(true);
    expect(falseOnes.some((r) => r.claim.kind === "tool_count")).toBe(true);
  });

  it("supports an honest claim ('Mneme has 12 tools written in TypeScript')", () => {
    // 12 tools matches; 12 ts files >= 5 threshold = true
    const results = checkClaim(repo, "Mneme has 12 tools written in TypeScript");
    expect(hasFalseFact(results)).toBe(false);
  });
});
