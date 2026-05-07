import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  addRepo,
  createOrg,
  deleteOrg,
  listOrgs,
  orgFilePath,
  orgsDir,
  parseRegistry,
  readRegistry,
  removeRepo,
  writeRegistry,
} from "./index.js";

let tmpHome: string;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "mneme-org-home-"));
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("org/registry — path helpers", () => {
  it("orgsDir resolves under the home dir", () => {
    expect(orgsDir(tmpHome)).toBe(join(tmpHome, ".mneme", "orgs"));
  });

  it("orgFilePath enforces a safe name", () => {
    expect(orgFilePath("good-name", tmpHome)).toContain("good-name.json");
    expect(() => orgFilePath("../escape", tmpHome)).toThrow(/Invalid org name/);
    expect(() => orgFilePath("with spaces", tmpHome)).toThrow();
  });
});

describe("org/registry — createOrg + readRegistry", () => {
  it("createOrg writes a file with empty repos array", () => {
    const reg = createOrg("alpha", tmpHome);
    expect(reg.name).toBe("alpha");
    expect(reg.repos).toEqual([]);
    expect(existsSync(orgFilePath("alpha", tmpHome))).toBe(true);
  });

  it("createOrg is idempotent — re-create returns existing reg", () => {
    const a = createOrg("alpha", tmpHome);
    const b = createOrg("alpha", tmpHome);
    expect(a.createdAt).toBe(b.createdAt);
  });

  it("readRegistry returns null when org does not exist", () => {
    expect(readRegistry("ghost", tmpHome)).toBeNull();
  });
});

describe("org/registry — addRepo / removeRepo", () => {
  it("addRepo persists absolute paths", () => {
    addRepo("alpha", "./relative/path", tmpHome);
    const reg = readRegistry("alpha", tmpHome)!;
    expect(reg.repos.length).toBe(1);
    expect(reg.repos[0]!.path).toMatch(/relative.+path$/);
  });

  it("addRepo de-duplicates", () => {
    addRepo("alpha", "/work/a", tmpHome);
    addRepo("alpha", "/work/a", tmpHome);
    addRepo("alpha", "/work/b", tmpHome);
    const reg = readRegistry("alpha", tmpHome)!;
    expect(reg.repos.length).toBe(2);
  });

  it("removeRepo drops the requested path; unknown path is no-op", () => {
    addRepo("alpha", "/work/a", tmpHome);
    addRepo("alpha", "/work/b", tmpHome);
    removeRepo("alpha", "/work/a", tmpHome);
    const reg = readRegistry("alpha", tmpHome)!;
    expect(reg.repos.length).toBe(1);
    expect(reg.repos[0]!.path).toMatch(/work.+b$/);
  });

  it("removeRepo on missing org returns null", () => {
    expect(removeRepo("ghost", "/work/a", tmpHome)).toBeNull();
  });
});

describe("org/registry — listOrgs / deleteOrg", () => {
  it("listOrgs returns all registered orgs sorted by name", () => {
    createOrg("zeta", tmpHome);
    createOrg("alpha", tmpHome);
    createOrg("mu", tmpHome);
    const names = listOrgs(tmpHome).map((o) => o.name);
    expect(names).toEqual(["alpha", "mu", "zeta"]);
  });

  it("listOrgs returns [] when no orgs exist", () => {
    expect(listOrgs(tmpHome)).toEqual([]);
  });

  it("deleteOrg removes the file + returns true", () => {
    createOrg("alpha", tmpHome);
    expect(deleteOrg("alpha", tmpHome)).toBe(true);
    expect(deleteOrg("alpha", tmpHome)).toBe(false);
    expect(readRegistry("alpha", tmpHome)).toBeNull();
  });
});

describe("org/registry — parseRegistry", () => {
  it("rejects malformed JSON", () => {
    expect(() => parseRegistry("{}")).toThrow(/malformed/);
    expect(() =>
      parseRegistry(JSON.stringify({ name: "x", createdAt: "now" })),
    ).toThrow();
  });

  it("filters out malformed repo entries", () => {
    const raw = JSON.stringify({
      name: "alpha",
      createdAt: "2026-01-01T00:00:00Z",
      repos: [{ path: "/work/a" }, { path: 12 }, "string-not-object", { path: "/work/b" }],
    });
    const reg = parseRegistry(raw);
    expect(reg.repos.length).toBe(2);
  });

  it("round-trips via writeRegistry / readRegistry", () => {
    const reg = {
      name: "alpha",
      createdAt: "2026-01-01T00:00:00Z",
      repos: [{ path: "/work/a" }, { path: "/work/b" }],
    };
    writeRegistry(reg, tmpHome);
    const back = readRegistry("alpha", tmpHome)!;
    expect(back).toEqual(reg);
  });
});
