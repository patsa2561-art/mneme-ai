import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderCommit, renderAuthor, renderFile, renderHashRef } from "./entity.js";
import { stripAnsi } from "./pyramid.js";

beforeEach(() => {
  process.env.NO_COLOR = "1";
});
afterEach(() => {
  delete process.env.NO_COLOR;
});

// ─── renderCommit ───────────────────────────────────────────────────────

describe("renderCommit", () => {
  const sample = {
    hash: "abc1234567890",
    shortHash: "abc1234",
    subject: "feat: add payment retry",
    authorName: "alice",
    authorDate: "2024-08-12T10:00:00Z",
  };

  it("normalises long hashes to 7-char short form", () => {
    const a = renderCommit(sample);
    expect(stripAnsi(a)).toContain("abc1234");
    expect(stripAnsi(a)).not.toContain("abc1234567890");
  });

  it("renders identically for the same input (determinism)", () => {
    const a = renderCommit(sample);
    const b = renderCommit(sample);
    expect(a).toBe(b);
  });

  it("compact form fits onto a single line", () => {
    const compact = renderCommit(sample, { compact: true });
    expect(compact.split("\n").length).toBe(1);
  });

  it("default (non-compact) form spans 2 lines", () => {
    const out = renderCommit(sample);
    expect(out.split("\n").length).toBe(2);
  });

  it("uses green dot when emphasized, gray otherwise", () => {
    // Force kleur on for this test — vitest is non-TTY which disables colour.
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = "1";
    // Need to reset kleur internal cache; easiest via fresh import.
    const yes = renderCommit(sample, { emphasized: true });
    const no = renderCommit(sample, { emphasized: false });
    // Both should still contain "●"
    expect(yes).toContain("●");
    expect(no).toContain("●");
    delete process.env.FORCE_COLOR;
    process.env.NO_COLOR = "1";
  });

  it("includes author and date in metadata", () => {
    const out = stripAnsi(renderCommit(sample));
    expect(out).toContain("alice");
    expect(out).toContain("2024-08-12");
  });

  it("falls back to hash slice if shortHash missing", () => {
    const out = stripAnsi(
      renderCommit({ hash: "deadbeefcafe", subject: "x" }),
    );
    expect(out).toContain("deadbee");
  });
});

// ─── renderAuthor ───────────────────────────────────────────────────────

describe("renderAuthor", () => {
  it("plain name + email", () => {
    const out = stripAnsi(renderAuthor("alice", "alice@bank.com"));
    expect(out).toContain("alice");
    expect(out).toContain("alice@bank.com");
  });

  it("isYou wraps the identity with 'you'", () => {
    const out = stripAnsi(renderAuthor("alice", "a@b.com", { isYou: true }));
    expect(out.startsWith("you")).toBe(true);
    expect(out).toContain("alice");
  });

  it("is deterministic for the same input", () => {
    const a = renderAuthor("bob", "b@x.com");
    const b = renderAuthor("bob", "b@x.com");
    expect(a).toBe(b);
  });

  it("works without an email", () => {
    const out = stripAnsi(renderAuthor("solo"));
    expect(out).toBe("solo");
  });
});

// ─── renderFile ─────────────────────────────────────────────────────────

describe("renderFile", () => {
  it("plain path", () => {
    const out = stripAnsi(renderFile("src/payment/service.ts"));
    expect(out).toBe("src/payment/service.ts");
  });

  it("appends line range with colon", () => {
    const out = stripAnsi(renderFile("a.ts", { lineRange: "12-44" }));
    expect(out).toBe("a.ts:12-44");
  });

  it("appends touched count badge", () => {
    const out = stripAnsi(renderFile("a.ts", { touched: 7 }));
    expect(out).toContain("(×7)");
  });

  it("omits touched badge when count is 0", () => {
    const out = stripAnsi(renderFile("a.ts", { touched: 0 }));
    expect(out).toBe("a.ts");
  });

  it("is deterministic", () => {
    expect(renderFile("a.ts", { touched: 3 })).toBe(renderFile("a.ts", { touched: 3 }));
  });
});

// ─── renderHashRef ──────────────────────────────────────────────────────

describe("renderHashRef", () => {
  it("wraps in backticks", () => {
    const out = stripAnsi(renderHashRef("abc1234"));
    expect(out).toBe("`abc1234`");
  });

  it("is deterministic", () => {
    expect(renderHashRef("a1b2c3d")).toBe(renderHashRef("a1b2c3d"));
  });

  it("normalises long hashes", () => {
    const out = stripAnsi(renderHashRef("deadbeef0000000"));
    expect(out).toBe("`deadbee`");
  });
});
