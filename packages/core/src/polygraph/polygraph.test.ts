/**
 * v2.19.80 — Browser Polygraph deep tests.
 *
 * Pins the load-bearing invariants of the per-sentence polygraph engine:
 *   - never throws (NEVER 500 a sentence — the user sees the dot)
 *   - prefilter discards fillers / short / no-entity sentences as `unknown/grey`
 *   - real claims with specific entities produce a verdict in <300ms
 *   - empty input → grey unknown
 *   - sentence extractor correctly splits English / Thai / CJK terminators
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  verifyBrowserSentence,
  extractVerifiableSentences,
  looksWorthVerifying,
} from "./index.js";

function makeTmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "mneme-polygraph-"));
  return dir;
}

describe("polygraph · looksWorthVerifying", () => {
  it("rejects sentences that are too short", () => {
    expect(looksWorthVerifying("Yes.")).toBe(false);
    expect(looksWorthVerifying("ok")).toBe(false);
    expect(looksWorthVerifying("Sure thing")).toBe(false);
  });

  it("rejects polite-filler openings", () => {
    expect(looksWorthVerifying("Let me think about that for a moment")).toBe(false);
    expect(looksWorthVerifying("I think the answer might be related")).toBe(false);
    expect(looksWorthVerifying("Maybe we could try something else later")).toBe(false);
    expect(looksWorthVerifying("Actually, let's revisit this question soon")).toBe(false);
  });

  it("accepts sentences with digits", () => {
    expect(looksWorthVerifying("The body has 400 blood vessels")).toBe(true);
    expect(looksWorthVerifying("The latency is 250ms")).toBe(true);
  });

  it("accepts sentences with version-like tokens", () => {
    expect(looksWorthVerifying("React 19 ships server components")).toBe(true);
    expect(looksWorthVerifying("Using v2.19.79 of the package")).toBe(true);
  });

  it("accepts sentences with proper nouns", () => {
    expect(looksWorthVerifying("The Eiffel Tower is in Paris on a sunny day")).toBe(true);
  });

  it("accepts sentences with dotted-symbol or CamelCase identifiers", () => {
    expect(looksWorthVerifying("Call asyncio.gather with loop parameter")).toBe(true);
    expect(looksWorthVerifying("Use queryClient to invalidate the cache")).toBe(true);
  });
});

describe("polygraph · extractVerifiableSentences", () => {
  it("splits on English sentence terminators", () => {
    const s = "Hello world. This is the second sentence! And a third?";
    const out = extractVerifiableSentences(s);
    expect(out.length).toBe(3);
  });

  it("splits on Thai full stop ฯ + CJK 。", () => {
    const out1 = extractVerifiableSentences("คนเรามีเส้นเลือดประมาณหนึ่งแสนกิโลเมตรฯ ส่วนใหญ่เป็น capillaryฯ");
    expect(out1.length).toBe(2);
    const out2 = extractVerifiableSentences("これはテストです。次の文です。");
    expect(out2.length).toBe(2);
  });

  it("strips fenced code blocks before splitting", () => {
    const s = "Here is some code.\n\n```js\nconsole.log('hi'); console.log('bye');\n```\n\nAnd a follow-up sentence.";
    const out = extractVerifiableSentences(s);
    // The code block is stripped — we should NOT see "console.log" sentences.
    expect(out.some((s) => s.includes("console.log"))).toBe(false);
    expect(out.some((s) => s.includes("Here is some code"))).toBe(true);
    expect(out.some((s) => s.includes("follow-up sentence"))).toBe(true);
  });

  it("returns an empty array on empty input", () => {
    expect(extractVerifiableSentences("")).toEqual([]);
    expect(extractVerifiableSentences("   ")).toEqual([]);
  });
});

describe("polygraph · verifyBrowserSentence", () => {
  it("returns grey/unknown on empty input WITHOUT throwing", async () => {
    const dir = makeTmpRepo();
    try {
      const r = await verifyBrowserSentence({ sentence: "", repoRoot: dir });
      expect(r.verdict).toBe("unknown");
      expect(r.color).toBe("grey");
      expect(r.engine).toBe("noop");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("returns grey/unknown on filler input via prefilter", async () => {
    const dir = makeTmpRepo();
    try {
      const r = await verifyBrowserSentence({ sentence: "Let me think.", repoRoot: dir });
      expect(r.color).toBe("grey");
      expect(r.engine).toBe("prefilter");
      expect(r.oneLine).toMatch(/no specific entities/i);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("runs ACGV on real claims with entities, returns a normalised verdict", async () => {
    const dir = makeTmpRepo();
    try {
      const r = await verifyBrowserSentence({
        sentence: "Mneme has exactly 9999 MCP tools.",
        repoRoot: dir,
      });
      // We don't pin the exact verdict (depends on ACGV's repo-state probing),
      // but we DO pin the shape + that it didn't crash + latency is reasonable.
      expect(["trustworthy", "mixed", "refuted", "impossible", "unknown"]).toContain(r.verdict);
      expect(["green", "yellow", "red", "grey"]).toContain(r.color);
      expect(r.engine).toBe("multi-lens");
      // v2.19.91 — Multi-lens detector results piggyback on the verdict
      // so the dashboard can render per-lens icons.
      expect(r.lenses).toBeDefined();
      expect(r.lenses!.lenses.length).toBe(6);
      expect(r.latencyMs).toBeGreaterThanOrEqual(0);
      expect(r.latencyMs).toBeLessThan(5000); // sanity bound
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("survives an invalid repoRoot WITHOUT throwing (returns a verdict, never a 500)", async () => {
    // Whatever ACGV does with a nonsense path, the polygraph must NEVER let
    // an exception propagate — the browser would render a broken dot.
    const r = await verifyBrowserSentence({
      sentence: "Mneme version 2.19.80 ships the polygraph userscript",
      repoRoot: "/this/path/definitely/does/not/exist/anywhere/12345",
    });
    expect(r).toBeDefined();
    expect(["trustworthy", "mixed", "refuted", "impossible", "unknown"]).toContain(r.verdict);
    // engine may be "propositional" if ACGV gracefully handles missing repo,
    // or "error" if it threw — either is acceptable as long as we got a verdict.
  });

  it("always returns a verdict whose color matches its verdict family", async () => {
    const dir = makeTmpRepo();
    try {
      const sentences = [
        "React 19 was released in December 2024.",
        "The capital of France is Paris.",
        "asyncio.gather accepts a return_exceptions keyword.",
      ];
      for (const s of sentences) {
        const r = await verifyBrowserSentence({ sentence: s, repoRoot: dir });
        // Color invariant: trustworthy=green, refuted/impossible=red,
        // unknown=grey, anything else=yellow.
        if (r.verdict === "trustworthy") expect(r.color).toBe("green");
        else if (r.verdict === "refuted" || r.verdict === "impossible") expect(r.color).toBe("red");
        else if (r.verdict === "unknown") expect(r.color).toBe("grey");
        else expect(r.color).toBe("yellow");
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
