// v2.22.3 — Finding #6 regression: tighten security primitives.

import { describe, expect, it } from "vitest";
import { containsShellMetaChars, containsPathTraversal } from "./shield.js";

describe("shield v2.22.3 — tightened denylists", () => {
  describe("containsShellMetaChars", () => {
    it("flags shell separator + pipe", () => {
      expect(containsShellMetaChars("foo;bar")).toBe(true);
      expect(containsShellMetaChars("foo|bar")).toBe(true);
      expect(containsShellMetaChars("foo&bar")).toBe(true);
    });

    it("flags backticks + dollar + command substitution braces", () => {
      expect(containsShellMetaChars("`whoami`")).toBe(true);
      expect(containsShellMetaChars("$(pwd)")).toBe(true);
      expect(containsShellMetaChars("${HOME}")).toBe(true);
    });

    it("flags redirection + escapes + quotes", () => {
      expect(containsShellMetaChars("foo>out")).toBe(true);
      expect(containsShellMetaChars("foo<in")).toBe(true);
      expect(containsShellMetaChars("foo\\bar")).toBe(true);
      expect(containsShellMetaChars('foo"bar')).toBe(true);
      expect(containsShellMetaChars("foo'bar")).toBe(true);
    });

    it("flags newline + carriage return + tab + null byte (v2.22.3 additions)", () => {
      expect(containsShellMetaChars("foo\nbar")).toBe(true);
      expect(containsShellMetaChars("foo\rbar")).toBe(true);
      expect(containsShellMetaChars("foo\tbar")).toBe(true);
      expect(containsShellMetaChars("foo\0bar")).toBe(true);
    });

    it("does NOT flag innocuous text (letters / digits / spaces / dashes)", () => {
      expect(containsShellMetaChars("hello world")).toBe(false);
      expect(containsShellMetaChars("path/to/file.txt")).toBe(false);
      expect(containsShellMetaChars("v2.22.3-rc.1")).toBe(false);
    });
  });

  describe("containsPathTraversal", () => {
    it("flags ../", () => {
      expect(containsPathTraversal("../etc/passwd")).toBe(true);
      expect(containsPathTraversal("foo/../bar")).toBe(true);
    });

    it("flags Windows ..\\", () => {
      expect(containsPathTraversal("..\\windows\\system32")).toBe(true);
    });

    it("flags URL-encoded %2e%2e", () => {
      expect(containsPathTraversal("%2e%2e/etc")).toBe(true);
    });

    it("does NOT flag legitimate `..` in unrelated context", () => {
      // Just two dots in version string — no slash or backslash near it.
      expect(containsPathTraversal("v1.0..v2.0")).toBe(false);
      expect(containsPathTraversal("ellipsis...")).toBe(false);
    });

    it("does NOT flag a single relative path component", () => {
      expect(containsPathTraversal("./local/file")).toBe(false);
      expect(containsPathTraversal("normal/path")).toBe(false);
    });
  });
});
