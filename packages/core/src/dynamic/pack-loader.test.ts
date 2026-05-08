/**
 * Pack loader tests — every error path exercised.
 *
 * Critical guarantees verified:
 *   • One bad pack does NOT prevent siblings from loading
 *   • Errors are STRUCTURED (phase + message + path)
 *   • Source-priority resolution (repo > user > bundled)
 *   • Cross-platform file discovery (.yml + .yaml)
 *   • NEVER throws, always returns Result-shaped values
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadPackFromString,
  loadPackFromFile,
  listPackFiles,
  loadAllPacks,
  getDefaultPackSearchPaths,
  type PackSearchPaths,
} from "./pack-loader.js";

const VALID_YAML = `
schemaVersion: 1
id: stripe
displayName: Stripe Payments
description: Detect Stripe SDK usage and expose ecosystem-specific tools.
version: 1.0.0
mnemeMinVersion: 1.13.0
maintainer:
  name: Test
detection:
  packageDeps:
    - stripe
tools:
  - id: find_pricing_logic
    description: Find Stripe pricing logic in this codebase. Returns code locations + history.
    query:
      kind: code-search
      patterns:
        - "stripe\\\\.prices\\\\."
`;

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mneme-pack-loader-"));
});

afterEach(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

describe("loadPackFromString — happy path", () => {
  it("parses a valid YAML pack", () => {
    const r = loadPackFromString(VALID_YAML);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.pack.id).toBe("stripe");
    expect(r.pack.tools).toHaveLength(1);
    expect(r.pack.tools[0]!.id).toBe("find_pricing_logic");
  });

  it("uses '<inline>' as default source when not given", () => {
    const r = loadPackFromString(VALID_YAML);
    if (!r.ok) throw new Error("expected ok");
    expect(r.source).toBe("<inline>");
  });
});

describe("loadPackFromString — yaml-parse failures", () => {
  it("rejects malformed YAML", () => {
    const r = loadPackFromString("foo: [unclosed");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.phase).toBe("yaml-parse");
    expect(r.message).toMatch(/Failed to parse YAML/);
  });

  it("rejects YAML root that's an array (parseable but wrong shape)", () => {
    const r = loadPackFromString("- one\n- two\n");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // Arrays parse as valid YAML — caught at schema layer for clearer error
    expect(r.phase).toBe("schema-validate");
  });

  it("rejects YAML root that's a scalar (parseable but wrong shape)", () => {
    const r = loadPackFromString("just a string");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.phase).toBe("schema-validate");
  });

  it("rejects empty string at yaml-parse (no pack data at all)", () => {
    const r = loadPackFromString("");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.phase).toBe("yaml-parse");
  });
});

describe("loadPackFromString — schema-validate failures", () => {
  it("returns structured Zod errors with dot-paths", () => {
    const yaml = VALID_YAML.replace("schemaVersion: 1", "schemaVersion: 99");
    const r = loadPackFromString(yaml);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.phase).toBe("schema-validate");
    expect(r.errors).toBeDefined();
    expect(r.errors!.some((e) => e.path === "schemaVersion")).toBe(true);
  });

  it("collects multiple errors at once", () => {
    const yaml = `
schemaVersion: 1
id: BAD-UPPERCASE
displayName: ""
description: short
version: nope
mnemeMinVersion: invalid
maintainer:
  name: ""
detection: {}
tools: []
`;
    const r = loadPackFromString(yaml);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors!.length).toBeGreaterThan(3);
  });
});

describe("loadPackFromFile", () => {
  it("loads a real pack from disk", () => {
    const path = join(tmp, "pack.yml");
    writeFileSync(path, VALID_YAML);
    const r = loadPackFromFile(path);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.source).toBe(path);
  });

  it("reports read failure for missing file", () => {
    const r = loadPackFromFile(join(tmp, "no-such-file.yml"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.phase).toBe("read");
  });
});

describe("listPackFiles", () => {
  it("finds .yml and .yaml files (case-insensitive)", () => {
    writeFileSync(join(tmp, "alpha.yml"), "x");
    writeFileSync(join(tmp, "beta.yaml"), "x");
    writeFileSync(join(tmp, "gamma.YML"), "x");
    writeFileSync(join(tmp, "ignore.json"), "x");
    const files = listPackFiles(tmp);
    expect(files).toHaveLength(3);
    expect(files.some((f) => f.endsWith("alpha.yml"))).toBe(true);
    expect(files.some((f) => f.endsWith("beta.yaml"))).toBe(true);
    expect(files.some((f) => f.endsWith("gamma.YML"))).toBe(true);
  });

  it("returns empty array for missing dir (no throw)", () => {
    const files = listPackFiles(join(tmp, "missing"));
    expect(files).toEqual([]);
  });

  it("returns empty array if dir contains no yml files", () => {
    writeFileSync(join(tmp, "x.json"), "x");
    expect(listPackFiles(tmp)).toEqual([]);
  });

  it("returns sorted result for deterministic ordering", () => {
    writeFileSync(join(tmp, "zebra.yml"), "x");
    writeFileSync(join(tmp, "alpha.yml"), "x");
    writeFileSync(join(tmp, "mango.yml"), "x");
    const files = listPackFiles(tmp);
    expect(files).toHaveLength(3);
    const names = files.map((f) => f.split(/[/\\]/).pop()!);
    expect(names).toEqual(["alpha.yml", "mango.yml", "zebra.yml"]);
  });
});

describe("loadAllPacks — multi-source", () => {
  it("loads packs from a single dir", () => {
    const dir = join(tmp, "bundled");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "stripe.yml"), VALID_YAML);

    const paths: PackSearchPaths = { bundled: dir, user: "/nope1", repo: "/nope2" };
    const r = loadAllPacks(paths);
    expect(r.packs).toHaveLength(1);
    expect(r.packs[0]!.id).toBe("stripe");
    expect(r.failures).toEqual([]);
  });

  it("ONE bad pack does NOT prevent siblings from loading", () => {
    const dir = join(tmp, "bundled");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "good.yml"), VALID_YAML);
    writeFileSync(join(dir, "bad.yml"), "this is not yaml: [");

    const r = loadAllPacks({ bundled: dir, user: "/no-user", repo: "/no-repo" });
    expect(r.packs).toHaveLength(1);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]!.phase).toBe("yaml-parse");
  });

  it("source priority: repo > user > bundled (later wins on id collision)", () => {
    const bundled = join(tmp, "bundled");
    const user = join(tmp, "user");
    const repo = join(tmp, "repo");
    mkdirSync(bundled, { recursive: true });
    mkdirSync(user, { recursive: true });
    mkdirSync(repo, { recursive: true });

    // Same pack id "stripe" in all 3 dirs but different versions
    writeFileSync(join(bundled, "stripe.yml"), VALID_YAML.replace("1.0.0", "1.0.0"));
    writeFileSync(join(user, "stripe.yml"), VALID_YAML.replace("version: 1.0.0", "version: 2.0.0"));
    writeFileSync(join(repo, "stripe.yml"), VALID_YAML.replace("version: 1.0.0", "version: 9.9.9"));

    const r = loadAllPacks({ bundled, user, repo });
    expect(r.packs).toHaveLength(1);
    expect(r.packs[0]!.version).toBe("9.9.9"); // repo wins
  });

  it("user beats bundled when no repo override", () => {
    const bundled = join(tmp, "bundled");
    const user = join(tmp, "user");
    mkdirSync(bundled, { recursive: true });
    mkdirSync(user, { recursive: true });
    writeFileSync(join(bundled, "stripe.yml"), VALID_YAML.replace("1.0.0", "1.0.0"));
    writeFileSync(join(user, "stripe.yml"), VALID_YAML.replace("version: 1.0.0", "version: 5.5.5"));

    const r = loadAllPacks({ bundled, user, repo: "/nope" });
    expect(r.packs[0]!.version).toBe("5.5.5");
  });

  it("returns sourcesScanned for debugging", () => {
    const bundled = join(tmp, "bundled");
    mkdirSync(bundled);
    const r = loadAllPacks({ bundled, user: "/u", repo: "/r" });
    expect(r.sourcesScanned).toContain(bundled);
    expect(r.sourcesScanned).toContain("/u");
    expect(r.sourcesScanned).toContain("/r");
  });

  it("handles missing dirs gracefully", () => {
    const r = loadAllPacks({ bundled: "/nope1", user: "/nope2", repo: "/nope3" });
    expect(r.packs).toEqual([]);
    expect(r.failures).toEqual([]);
  });
});

describe("getDefaultPackSearchPaths", () => {
  it("returns repo + user + bundled paths from /someroot", () => {
    delete process.env["MNEME_USER_PACKS_DIR"];
    delete process.env["MNEME_REPO_PACKS_DIR_NAME"];
    const paths = getDefaultPackSearchPaths("/someroot", "/bundled-default");
    expect(paths.repo).toMatch(/someroot/);
    expect(paths.repo).toMatch(/\.mneme.packs$/);
    expect(paths.user).toMatch(/\.mneme.packs$/);
    expect(paths.bundled).toBe("/bundled-default");
  });

  it("respects env override for user dir", () => {
    process.env["MNEME_USER_PACKS_DIR"] = "/custom-user-packs";
    try {
      const paths = getDefaultPackSearchPaths("/someroot");
      expect(paths.user).toBe("/custom-user-packs");
    } finally {
      delete process.env["MNEME_USER_PACKS_DIR"];
    }
  });
});
