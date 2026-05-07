import { describe, it, expect } from "vitest";
import { findMnemeDb, mnemeDirFor, dbPathFor } from "../src/util/findDb.js";
import {
  bandForScore,
  humanDays,
  explainKnowledge,
  verdictText,
} from "../src/util/iconText.js";
import {
  renderAskMarkdown,
  renderWhyMarkdown,
  parseVerdict,
  renderAuditMarkdown,
  rewriteHtml,
  makeNonce,
} from "../src/util/render.js";

// ─── findDb ────────────────────────────────────────────────────────────

describe("findMnemeDb", () => {
  it("returns null when no folders are open", () => {
    expect(findMnemeDb(undefined)).toBeNull();
    expect(findMnemeDb([])).toBeNull();
  });

  it("returns the first folder containing a Mneme DB", () => {
    const found = findMnemeDb(
      [{ fsPath: "/no/here" }, { fsPath: "/yes/here" }],
      {
        exists: (p: string) => p.replace(/\\/g, "/").includes("/yes/here"),
      },
    );
    expect(found).not.toBeNull();
    expect(found!.repoRoot).toBe("/yes/here");
    expect(found!.dbPath.replace(/\\/g, "/")).toBe("/yes/here/.mneme/mneme.db");
  });

  it("returns null when none of the folders are indexed", () => {
    const found = findMnemeDb(
      [{ fsPath: "/a" }, { fsPath: "/b" }],
      { exists: () => false },
    );
    expect(found).toBeNull();
  });

  it("computes canonical paths regardless of existence", () => {
    expect(mnemeDirFor("/repo").replace(/\\/g, "/")).toBe("/repo/.mneme");
    expect(dbPathFor("/repo").replace(/\\/g, "/")).toBe("/repo/.mneme/mneme.db");
  });
});

// ─── iconText ──────────────────────────────────────────────────────────

describe("iconText helpers", () => {
  it("bandForScore maps to four bands", () => {
    expect(bandForScore(0.95)).toBe("fresh");
    expect(bandForScore(0.5)).toBe("warm");
    expect(bandForScore(0.2)).toBe("fading");
    expect(bandForScore(0.05)).toBe("ghosted");
  });

  it("humanDays handles the full range from today to years", () => {
    expect(humanDays(0.4)).toBe("today");
    expect(humanDays(1.5)).toBe("yesterday");
    expect(humanDays(7)).toBe("7 days ago");
    expect(humanDays(30)).toContain("weeks ago");
    expect(humanDays(150)).toContain("months ago");
    expect(humanDays(800)).toContain("years ago");
  });

  it("humanDays returns 'unknown' for invalid input", () => {
    expect(humanDays(Number.NaN)).toBe("unknown");
    expect(humanDays(-1)).toBe("unknown");
  });

  it("explainKnowledge returns a non-empty plain-English string", () => {
    expect(explainKnowledge(0.95)).toContain("front of someone");
    expect(explainKnowledge(0.05)).toContain("ghost");
  });

  it("verdictText prefixes the right vscode codicon", () => {
    expect(verdictText("pass")).toContain("$(check)");
    expect(verdictText("warn")).toContain("$(warning)");
    expect(verdictText("fail")).toContain("$(error)");
    expect(verdictText("idle")).toContain("$(info)");
  });
});

// ─── ask / why renderers ───────────────────────────────────────────────

describe("renderAskMarkdown", () => {
  it("renders the question, answer, and citation list", () => {
    const md = renderAskMarkdown(
      "why try/catch?",
      JSON.stringify({
        answer: "Because the upstream parser throws on bad input.",
        citations: [{ filePath: "src/parse.ts", reason: "introduced in PR #214" }],
      }),
    );
    expect(md).toContain("why try/catch?");
    expect(md).toContain("upstream parser throws");
    expect(md).toContain("src/parse.ts");
  });

  it("falls back to raw output when JSON parsing fails", () => {
    const md = renderAskMarkdown("q", "not json");
    expect(md).toContain("not json");
  });

  it("surfaces a refusal reason instead of an answer", () => {
    const md = renderAskMarkdown(
      "q",
      JSON.stringify({ refusalReason: "Cannot cite — index is empty." }),
    );
    expect(md).toContain("refused");
    expect(md).toContain("Cannot cite");
  });
});

describe("renderWhyMarkdown", () => {
  it("includes file/line and the summary", () => {
    const md = renderWhyMarkdown(
      "src/auth.ts",
      42,
      JSON.stringify({
        summary: "This guard was added after a 2022 outage.",
        commit: { hash: "abcdef0123456789", subject: "harden auth" },
      }),
    );
    expect(md).toContain("src/auth.ts:42");
    expect(md).toContain("2022 outage");
    expect(md).toContain("abcdef012345");
  });
});

// ─── audit renderer ────────────────────────────────────────────────────

describe("audit verdict + markdown", () => {
  it("parseVerdict reads the overall verdict", () => {
    expect(parseVerdict(JSON.stringify({ overallVerdict: "pass" }))).toBe("pass");
    expect(parseVerdict(JSON.stringify({ overallVerdict: "fail" }))).toBe("fail");
    expect(parseVerdict("not json")).toBe("idle");
  });

  it("renderAuditMarkdown lists the axes", () => {
    const md = renderAuditMarkdown(
      JSON.stringify({
        overallVerdict: "warn",
        axes: { aiNarrative: { verdict: "warn", reason: "claim partly verified" } },
        forensicAxes: { size: "pass", files: "pass", style: "warn", time: "pass" },
      }),
    );
    expect(md).toContain("warn");
    expect(md).toContain("aiNarrative");
    expect(md).toContain("Forensic axes");
  });
});

// ─── webview rewrite ───────────────────────────────────────────────────

describe("rewriteHtml", () => {
  const fakeWebview = {
    cspSource: "vscode-webview://fake",
    asWebviewUri: (u: { toString(): string }) => ({ toString: () => `wv://${u.toString()}` }),
  };
  // Cast the trivial uri object — the rewriter only calls toString() on it.
  const fakeUri = { toString: () => "/repo/packages/web/dist" } as unknown as import("vscode").Uri;

  it("replaces /mneme-ai/... asset paths with webview URIs", () => {
    const html = `<html><head></head><body><script src="/mneme-ai/assets/index.js"></script></body></html>`;
    const out = rewriteHtml(html, fakeWebview, fakeUri, "abc123");
    expect(out).toContain("wv://");
    expect(out).not.toContain('"/mneme-ai/');
  });

  it("injects a strict CSP and a nonce on every script", () => {
    const html = `<html><head></head><body><script src="/mneme-ai/x.js"></script><script>console.log(1)</script></body></html>`;
    const out = rewriteHtml(html, fakeWebview, fakeUri, "nonce42");
    expect(out).toContain("Content-Security-Policy");
    expect(out).toContain("'nonce-nonce42'");
    // Both scripts get a nonce.
    expect((out.match(/<script nonce="nonce42"/g) || []).length).toBe(2);
    expect(out).not.toContain("unsafe-eval");
  });

  it("strips any pre-existing CSP from the bundle", () => {
    const html = `<html><head><meta http-equiv="Content-Security-Policy" content="default-src *"></head><body></body></html>`;
    const out = rewriteHtml(html, fakeWebview, fakeUri, "abc");
    expect(out).not.toContain("default-src *");
    expect(out).toContain("'nonce-abc'");
  });

  it("makeNonce returns a 32-hex-char string", () => {
    const n = makeNonce();
    expect(n).toMatch(/^[0-9a-f]{32}$/);
    expect(n).not.toBe(makeNonce());
  });
});
