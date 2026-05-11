import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { harvestBounties, listSubmittedDrafts, inRange } from "./bounty_harvester.js";

function setupRepo(repo: string, deps: Record<string, string>, advisories: object[]): void {
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "t", version: "1.0.0", dependencies: deps }));
  if (advisories.length > 0) {
    mkdirSync(join(repo, ".mneme/advisories"), { recursive: true });
    writeFileSync(join(repo, ".mneme/advisories/npm.jsonl"), advisories.map((a) => JSON.stringify(a)).join("\n") + "\n");
  }
}

describe("teeth/bounty_harvester · range matching", () => {
  it("matches simple < range", () => {
    expect(inRange("1.2.3", "<1.3.0")).toBe(true);
    expect(inRange("1.3.0", "<1.3.0")).toBe(false);
  });
  it("matches AND clause", () => {
    expect(inRange("1.2.5", ">=1.2.0 <1.3.0")).toBe(true);
    expect(inRange("1.4.0", ">=1.2.0 <1.3.0")).toBe(false);
  });
  it("matches OR clause", () => {
    expect(inRange("1.0.5", "<1.1.0 || >=2.0.0 <2.1.0")).toBe(true);
    expect(inRange("2.0.5", "<1.1.0 || >=2.0.0 <2.1.0")).toBe(true);
    expect(inRange("1.5.0", "<1.1.0 || >=2.0.0 <2.1.0")).toBe(false);
  });
  it("fails closed on unparseable range", () => {
    expect(inRange("1.0.0", "totally-bogus")).toBe(false);
  });
  it("rejects pre-release-only mismatched semver", () => {
    expect(inRange("not-a-version", ">=1.0.0")).toBe(false);
  });
});

describe("teeth/bounty_harvester · empty/no-op cases", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-bounty-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("returns empty when no advisories on disk", () => {
    setupRepo(repo, { foo: "1.0.0" }, []);
    const r = harvestBounties(repo);
    expect(r.drafted).toEqual([]);
    expect(r.skipped).toEqual([]);
  });

  it("returns empty when no package.json", () => {
    mkdirSync(join(repo, ".mneme/advisories"), { recursive: true });
    writeFileSync(join(repo, ".mneme/advisories/npm.jsonl"), JSON.stringify({ id: "x", ecosystem: "npm", package: "foo", vulnerableRange: "<2", fixedIn: "2.0.0", severity: "critical", title: "t", summary: "s", references: [] }) + "\n");
    const r = harvestBounties(repo);
    expect(r.scanned).toBe(0);
    expect(r.drafted).toEqual([]);
  });

  it("scans deps even with zero matching advisories", () => {
    setupRepo(repo, { foo: "1.0.0", bar: "2.0.0" }, []);
    const r = harvestBounties(repo);
    expect(r.scanned).toBe(2);
  });
});

describe("teeth/bounty_harvester · draft creation", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-bounty-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  const critical = (pkg: string, range: string, fix: string | null) => ({
    id: `GHSA-test-${pkg}`,
    ecosystem: "npm",
    package: pkg,
    vulnerableRange: range,
    fixedIn: fix,
    severity: "critical",
    title: `${pkg} flaw`,
    summary: `serious bug in ${pkg}`,
    references: ["https://example.com/advisory"],
  });

  it("drafts a markdown report for a vulnerable critical dep", () => {
    setupRepo(repo, { foo: "1.0.0" }, [critical("foo", "<2.0.0", "2.0.0")]);
    const r = harvestBounties(repo);
    expect(r.drafted).toHaveLength(1);
    expect(r.drafted[0]!.outcome).toBe("drafted");
    expect(existsSync(r.drafted[0]!.reportPath)).toBe(true);
    const md = readFileSync(r.drafted[0]!.reportPath, "utf8");
    expect(md).toContain("# Vulnerability Report");
    expect(md).toContain("**Status:** DRAFT");
    expect(md).toContain("foo");
  });

  it("filters below-threshold severity (medium → skipped)", () => {
    setupRepo(repo, { foo: "1.0.0" }, [{ ...critical("foo", "<2.0.0", "2.0.0"), severity: "medium" }]);
    const r = harvestBounties(repo);
    expect(r.drafted).toHaveLength(0);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]!.outcome).toBe("below-threshold");
  });

  it("suppresses already-patched (installed >= fixed)", () => {
    setupRepo(repo, { foo: "2.5.0" }, [critical("foo", "<10.0.0", "2.0.0")]);
    const r = harvestBounties(repo);
    expect(r.drafted).toHaveLength(0);
    expect(r.skipped[0]?.outcome).toBe("already-patched");
  });

  it("does not draft when version is outside vulnerable range", () => {
    setupRepo(repo, { foo: "5.0.0" }, [critical("foo", "<2.0.0", "2.0.0")]);
    const r = harvestBounties(repo);
    expect(r.drafted).toHaveLength(0);
    // not vulnerable → silent (no skip noise)
    expect(r.skipped).toHaveLength(0);
  });

  it("dedupes on second run via submitted ledger", () => {
    setupRepo(repo, { foo: "1.0.0" }, [critical("foo", "<2.0.0", "2.0.0")]);
    const r1 = harvestBounties(repo);
    expect(r1.drafted).toHaveLength(1);
    const r2 = harvestBounties(repo);
    expect(r2.drafted).toHaveLength(0);
    expect(r2.skipped[0]?.outcome).toBe("duplicate");
    expect(listSubmittedDrafts(repo)).toHaveLength(1);
  });

  it("strips caret/tilde from version range when matching", () => {
    setupRepo(repo, { foo: "^1.0.0" }, [critical("foo", "<2.0.0", "2.0.0")]);
    const r = harvestBounties(repo);
    expect(r.drafted).toHaveLength(1);
    expect(r.drafted[0]!.installedVersion).toBe("1.0.0");
  });

  it("includes repro scaffold ONLY when advisory has it", () => {
    setupRepo(repo, { foo: "1.0.0" }, [{ ...critical("foo", "<2.0.0", "2.0.0"), repro: "curl -X POST /api/foo --data '...'" }]);
    const r = harvestBounties(repo);
    const md = readFileSync(r.drafted[0]!.reportPath, "utf8");
    expect(md).toContain("This is a SCAFFOLD only");
    expect(md).toContain("curl -X POST");
  });

  it("notes 'no fix' when advisory.fixedIn is null", () => {
    setupRepo(repo, { foo: "1.0.0" }, [critical("foo", "<99.0.0", null)]);
    const r = harvestBounties(repo);
    const md = readFileSync(r.drafted[0]!.reportPath, "utf8");
    expect(md).toContain("_no fix yet_");
    expect(md).toContain("No upstream fix is published");
  });

  it("escapes pipe in summary so markdown table is not broken", () => {
    setupRepo(repo, { foo: "1.0.0" }, [{ ...critical("foo", "<2.0.0", "2.0.0"), summary: "bad | really bad" }]);
    const r = harvestBounties(repo);
    const md = readFileSync(r.drafted[0]!.reportPath, "utf8");
    expect(md).toContain("bad \\| really bad");
  });

  it("processes multiple deps × multiple advisories", () => {
    setupRepo(repo, { foo: "1.0.0", bar: "1.0.0" }, [
      critical("foo", "<2.0.0", "2.0.0"),
      critical("bar", "<2.0.0", "2.0.0"),
    ]);
    const r = harvestBounties(repo);
    expect(r.drafted).toHaveLength(2);
  });
});
