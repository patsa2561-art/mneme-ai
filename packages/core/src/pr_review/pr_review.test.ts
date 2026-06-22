import { describe, it, expect } from "vitest";
import { buildPrComment, prReviewGauntlet, type PrCommit } from "./index.js";

function cs(): PrCommit[] {
  return Array.from({ length: 10 }, (_, i) => ({ hash: "q" + String(i).padStart(3, "0") + "beadfeed", author: "ana", ts: 1_700_000_000 + i * 86400, subject: "feat(auth): work", files: ["src/auth.ts"], churn: 30 }));
}

describe("v3.133 · PR REVIEW — the grounded PR comment (daily-loop wedge)", () => {
  it("gauntlet is 100", () => expect(prReviewGauntlet().score).toBe(100));

  it("VERICERTs the PR body + surfaces cited file context + persona", () => {
    const r = buildPrComment({ title: "fix(auth): tighten expiry", body: "Verify against staging.", changedFiles: ["src/auth.ts"], commits: cs(), author: "ana" });
    expect(r.cert.verdict).toBe("CERTIFIED");
    const f = r.fileContexts.find((x) => x.file === "src/auth.ts")!;
    expect(f.touches).toBeGreaterThan(0);
    expect(r.citations).toContain(f.lastHash);
    expect(r.persona!.tier).toBeTruthy();
    expect(r.markdown).toContain("🧭 Mneme — PR context & checks");
  });

  it("a hallucinated PR description is NOT certified; a brand-new file isn't invented", () => {
    const r = buildPrComment({ title: "x", body: "This always works and never fails on any input.", changedFiles: ["src/fresh.ts"], commits: cs(), author: "ana" });
    expect(r.cert.verdict).not.toBe("CERTIFIED");
    const nf = r.fileContexts.find((x) => x.file === "src/fresh.ts")!;
    expect(nf.touches).toBe(0);
    expect(nf.lastHash).toBe("");
  });

  it("is total on hostile input", () => {
    expect(() => buildPrComment(null as never)).not.toThrow();
    expect(buildPrComment({ title: "", changedFiles: [], commits: [] }).prReview).toBe("PRREVIEW/1");
  });
});
