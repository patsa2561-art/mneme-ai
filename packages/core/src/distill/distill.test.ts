import { describe, it, expect } from "vitest";
import { distill, estimateTokens, extractDiffLoci, distillGauntlet } from "./index.js";

const OUTPUT = [
  "Traceback (most recent call last):",
  '  File "train.py", line 88, in <module>',
  "RuntimeError: CUDA out of memory. Tried to allocate 2.00 GiB",
].join("\n") + "\n" + "verbose noise ".repeat(100);

const DIFF = [
  "--- a/train.py",
  "+++ b/train.py",
  "@@ -85,6 +85,7 @@ def main():",
  "+    model = model.cuda()",
].join("\n");

describe("v2.111 MNEME DISTILL — signed, measured token-budget receipt", () => {
  it("compresses a verbose error+diff into a small causal brief", () => {
    const r = distill({ command: "python train.py", output: OUTPUT, exitCode: 1, diff: DIFF });
    expect(r.measured.charsAfter).toBeLessThan(r.measured.charsBefore);
    expect(r.measured.reductionPct).toBeGreaterThan(50);
    expect(r.brief.length).toBe(r.measured.charsAfter); // measurement is exact
  });

  it("preserves the causal signal (error class + changed file:line)", () => {
    const r = distill({ command: "python train.py", output: OUTPUT, exitCode: 1, diff: DIFF });
    expect(r.brief).toContain("oom");
    expect(r.brief).toContain("train.py:L85");
  });

  it("folds in a recalled known fix, keyed by the failure signature", () => {
    const recall = (sig: string) => (sig.length > 0 ? "torch.cuda.empty_cache()" : null);
    const r = distill({ command: "python train.py", output: OUTPUT, exitCode: 1, diff: DIFF, recall });
    expect(r.brief).toContain("KNOWN FIX");
    expect(r.brief).toContain("empty_cache");
  });

  it("the token estimate is labeled as an estimate (no fabricated tokenizer)", () => {
    const r = distill({ command: "x", output: "error: boom", exitCode: 1 });
    expect(r.measured.note).toMatch(/estimate/i);
    expect(r.measured.note).toMatch(/not a vendor/i);
    expect(estimateTokens("abcd")).toBe(1); // chars/4
    expect(estimateTokens("")).toBe(0);
  });

  it("reductionPct is exact (matches the character counts, not a guess)", () => {
    const r = distill({ command: "python train.py", output: OUTPUT, exitCode: 1, diff: DIFF });
    const exact = Math.round((1 - r.measured.charsAfter / r.measured.charsBefore) * 1000) / 10;
    expect(r.measured.reductionPct).toBe(exact);
  });

  it("extractDiffLoci pulls file + first hunk line; ignores /dev/null", () => {
    const loci = extractDiffLoci(DIFF);
    expect(loci[0]!.file).toBe("train.py");
    expect(loci[0]!.line).toBe(85);
    expect(extractDiffLoci("--- a/x\n+++ /dev/null\n").length).toBe(0);
  });

  it("folds a NEGATIVE-knowledge dead-end warning into the brief (advisory)", () => {
    const r = distill({ command: "docker build", output: "error: build failed", exitCode: 1, deadEnd: { isDeadEnd: true, base: "docker:build", failures: 4 } });
    expect(r.brief).toContain("DEAD-END");
    expect(r.brief).toContain("docker:build");
    expect(r.brief).toContain("4×");
    // a non-dead-end approach adds no warning
    const r2 = distill({ command: "docker build", output: "error: build failed", exitCode: 1, deadEnd: { isDeadEnd: false, base: "docker:build", failures: 0 } });
    expect(r2.brief).not.toContain("DEAD-END");
  });

  it("a clean success produces an OK brief, no error noise", () => {
    const r = distill({ command: "npm test", output: "All tests passed", exitCode: 0 });
    expect(r.hadError).toBe(false);
    expect(r.brief).toContain("OK");
  });

  it("gauntlet scores 100", () => {
    const g = distillGauntlet();
    expect(g.reduces).toBe(true);
    expect(g.measurementHonest).toBe(true);
    expect(g.preservesSignal).toBe(true);
    expect(g.foldsKnownFix).toBe(true);
    expect(g.score).toBe(100);
  });

  it("STABILITY — total on garbage", () => {
    expect(() => distill(null as never)).not.toThrow();
    expect(distill(null as never).brief).toBe("");
    expect(() => extractDiffLoci(null as never)).not.toThrow();
    expect(() => estimateTokens(null as never)).not.toThrow();
  });
});
