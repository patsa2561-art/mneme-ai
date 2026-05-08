import { describe, expect, it } from "vitest";
import { parseLogStream, _SENTINEL_FOR_TESTS, _buildArgsForTests } from "./batch-log.js";

const S = _SENTINEL_FOR_TESTS;
const NUL = "\x00";

function fixture(commits: Array<{ hash: string; date: string; name: string; email: string; subject: string; body: string; diff: string }>): string {
  return commits
    .map((c) => `${S}${NUL}${c.hash}${NUL}${c.date}${NUL}${c.name}${NUL}${c.email}${NUL}${c.subject}${NUL}${c.body}${NUL}\n${c.diff}`)
    .join("");
}

describe("git/batch-log — parseLogStream", () => {
  it("parses a single commit + diff", () => {
    const raw = fixture([{
      hash: "abc1234567",
      date: "2026-01-01T00:00:00Z",
      name: "Alice",
      email: "alice@x",
      subject: "feat: add login",
      body: "more details\nhere",
      diff: "diff --git a/auth.ts b/auth.ts\n+const login = 1;\n",
    }]);
    const out = parseLogStream(raw);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      hash: "abc1234567",
      authorDate: "2026-01-01T00:00:00Z",
      authorName: "Alice",
      authorEmail: "alice@x",
      subject: "feat: add login",
      body: "more details\nhere",
    });
    expect(out[0]!.diff).toContain("auth.ts");
    expect(out[0]!.diff).toContain("+const login = 1;");
  });

  it("parses multiple commits in one stream", () => {
    const raw = fixture([
      { hash: "a1", date: "2026-01-01T00:00:00Z", name: "A", email: "a@x", subject: "first", body: "", diff: "diff --git a/x b/x\n+ first\n" },
      { hash: "b2", date: "2026-01-02T00:00:00Z", name: "B", email: "b@x", subject: "second", body: "", diff: "diff --git a/y b/y\n+ second\n" },
      { hash: "c3", date: "2026-01-03T00:00:00Z", name: "C", email: "c@x", subject: "third", body: "", diff: "" },
    ]);
    const out = parseLogStream(raw);
    expect(out).toHaveLength(3);
    expect(out.map((c) => c.hash)).toEqual(["a1", "b2", "c3"]);
    expect(out[0]!.diff).toContain("first");
    expect(out[1]!.diff).toContain("second");
    expect(out[2]!.diff).toBe("");
  });

  it("handles an empty body field", () => {
    const raw = fixture([{
      hash: "h", date: "d", name: "n", email: "e", subject: "s", body: "", diff: "",
    }]);
    const out = parseLogStream(raw);
    expect(out[0]!.body).toBe("");
  });

  it("handles a multi-line body with embedded newlines", () => {
    const raw = fixture([{
      hash: "h", date: "d", name: "n", email: "e",
      subject: "s",
      body: "line one\nline two\nline three",
      diff: "",
    }]);
    const out = parseLogStream(raw);
    expect(out[0]!.body).toBe("line one\nline two\nline three");
  });

  it("returns [] on empty input", () => {
    expect(parseLogStream("")).toEqual([]);
  });

  it("returns [] when no sentinel is found", () => {
    expect(parseLogStream("just some random text")).toEqual([]);
  });

  it("does not split when diff text contains the sentinel without a NUL header", () => {
    // A pathological commit subject mentioning the sentinel string. The
    // parser only treats SENTINEL+NUL as a header — bare SENTINEL in text
    // shouldn't fire a false split.
    const diffWithFakeSentinel = `diff --git a/x b/x\n+ this string contains ${S} but no nul\n`;
    const raw = fixture([{
      hash: "abc", date: "d", name: "n", email: "e", subject: "s", body: "", diff: diffWithFakeSentinel,
    }]);
    const out = parseLogStream(raw);
    expect(out).toHaveLength(1);
    expect(out[0]!.diff).toContain("contains");
  });

  it("parses a commit whose diff is enormous (binary-files line, 1MB body)", () => {
    const big = "x".repeat(1024 * 1024);
    const raw = fixture([{
      hash: "h", date: "d", name: "n", email: "e", subject: "s", body: big, diff: "Binary files differ\n",
    }]);
    const out = parseLogStream(raw);
    expect(out).toHaveLength(1);
    expect(out[0]!.body).toHaveLength(1024 * 1024);
  });
});

/**
 * Regression: `git log` argv must NOT contain literal NUL bytes —
 * Windows' CreateProcess rejects them and Node throws
 * `ERR_INVALID_ARG_VALUE: must be a string without null bytes`.
 *
 * Git interprets `%x00` in --pretty as "emit one NUL byte in OUTPUT",
 * which is what we actually want — same wire format, no NUL in argv.
 *
 * Bug surfaced in v1.1.0 on Windows: `mneme forensics vulns` crashed.
 * Fixed in v1.1.1 by replacing the literal NUL constant with `%x00`.
 */
describe("git/batch-log — argv null-byte safety (Windows regression)", () => {
  it("argv contains zero literal NUL bytes", () => {
    const args = _buildArgsForTests({ cwd: "." });
    for (const a of args) {
      expect(a.includes("\x00"), `argv "${a}" contains a literal NUL`).toBe(false);
    }
  });

  it("the --pretty argv element uses %x00 placeholder, not literal NUL", () => {
    const args = _buildArgsForTests({ cwd: "." });
    const pretty = args.find((a) => a.startsWith("--pretty="));
    expect(pretty).toBeTruthy();
    expect(pretty!).toContain("%x00");
    expect(pretty!.includes("\x00")).toBe(false);
  });

  it("argv with all options set still has no NUL bytes", () => {
    const args = _buildArgsForTests({
      cwd: ".",
      maxCommits: 500,
      since: "2026-01-01",
      pathPrefix: "src/",
      noMerges: true,
    });
    for (const a of args) {
      expect(a.includes("\x00")).toBe(false);
    }
    expect(args).toContain("--no-merges");
    expect(args).toContain("-n");
    expect(args).toContain("500");
    expect(args).toContain("--since=2026-01-01");
  });
});
