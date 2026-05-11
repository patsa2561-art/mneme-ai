import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { resolveMnemeVersion, _resetMnemeVersionCache } from "./mneme_version.js";

describe("mneme_version · resolution", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env["npm_package_version"];
    _resetMnemeVersionCache();
  });
  afterEach(() => {
    if (saved === undefined) delete process.env["npm_package_version"];
    else process.env["npm_package_version"] = saved;
    _resetMnemeVersionCache();
  });

  it("uses env var when set", () => {
    process.env["npm_package_version"] = "9.9.9";
    expect(resolveMnemeVersion()).toBe("9.9.9");
  });

  it("memoizes the resolved value across calls", () => {
    process.env["npm_package_version"] = "5.5.5";
    const a = resolveMnemeVersion();
    process.env["npm_package_version"] = "1.1.1";
    const b = resolveMnemeVersion();
    expect(a).toBe(b);
  });

  it("falls back to package.json when env unset", () => {
    delete process.env["npm_package_version"];
    const v = resolveMnemeVersion();
    // Either a real semver from package.json, or the explicit unknown sentinel.
    // Both are acceptable -- the point is NO stale hard-coded version like "1.27.9".
    expect(v).toMatch(/^\d+\.\d+\.\d+/);
    expect(v).not.toBe("1.27.9");
    expect(v).not.toBe("1.19.0");
    expect(v).not.toBe("1.24.1");
  });

  it("rejects malformed env var (no semver)", () => {
    process.env["npm_package_version"] = "not-a-version";
    const v = resolveMnemeVersion();
    expect(v).not.toBe("not-a-version");
  });
});
