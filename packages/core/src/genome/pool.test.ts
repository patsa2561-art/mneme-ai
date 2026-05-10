import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pool } from "./index.js";

let repo: string;
beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-genome-pool-")); });
afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

function writeChromosomes(repoRoot: string, items: Array<Record<string, unknown>>): void {
  const dir = join(repoRoot, ".mneme/lineage");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "chromosomes.jsonl"),
    items.map((c) => JSON.stringify(c)).join("\n") + "\n",
    "utf8");
}

describe("pool.scrubPII", () => {
  it("redacts emails", () => {
    expect(pool.scrubPII("contact alice@example.com today")).toContain("<EMAIL>");
    expect(pool.scrubPII("contact alice@example.com today")).not.toContain("alice@example.com");
  });

  it("redacts absolute Windows paths", () => {
    const out = pool.scrubPII("see C:\\Users\\alice\\code\\secret.ts");
    expect(out).toContain("<PATH>");
    expect(out).not.toContain("alice");
  });

  it("redacts absolute POSIX paths", () => {
    expect(pool.scrubPII("at /home/alice/repo")).toContain("<PATH>");
    expect(pool.scrubPII("at /Users/alice/code")).toContain("<PATH>");
    expect(pool.scrubPII("at /tmp/secret")).toContain("<PATH>");
  });

  it("redacts GitHub @handles", () => {
    expect(pool.scrubPII("ping @alice for review")).toContain("<HANDLE>");
  });

  it("redacts IP addresses", () => {
    expect(pool.scrubPII("connect to 192.168.1.42")).toContain("<IP>");
  });

  it("redacts long alphanumeric tokens (heuristic)", () => {
    expect(pool.scrubPII("Bearer abcdefghijklmnopqrstuvwxyz12")).toContain("<SECRET>");
  });

  it("preserves normal text", () => {
    expect(pool.scrubPII("the quick brown fox")).toBe("the quick brown fox");
  });
});

describe("pool.buildPackage", () => {
  it("returns null when no chromosomes", () => {
    expect(pool.buildPackage(repo)).toBeNull();
  });

  it("builds a package with redacted entries", () => {
    writeChromosomes(repo, [
      { vendor: "claude", topic: "stripe-webhook", notes: "alice@x.com hit /home/alice/code/billing.ts" },
      { vendor: "cursor", topic: "react-hook", notes: "useEffect cleanup pattern" },
    ]);
    const pkg = pool.buildPackage(repo);
    expect(pkg).not.toBeNull();
    expect(pkg!.count).toBe(2);
    expect(pkg!.v).toBe(1);
    expect(pkg!.entries[0]!.body).toContain("<EMAIL>");
    expect(pkg!.entries[0]!.body).toContain("<PATH>");
    expect(pkg!.entries[0]!.body).not.toContain("alice@x.com");
  });

  it("filters chromosomes missing topic or notes", () => {
    writeChromosomes(repo, [
      { vendor: "claude", topic: "valid", notes: "ok" },
      { vendor: "claude", notes: "no topic" },
      { vendor: "claude", topic: "no notes" },
    ]);
    const pkg = pool.buildPackage(repo);
    expect(pkg!.count).toBe(1);
  });

  it("entries have stable hash + contributedAt timestamp", () => {
    writeChromosomes(repo, [{ vendor: "claude", topic: "t", notes: "n" }]);
    const pkg = pool.buildPackage(repo)!;
    expect(pkg.entries[0]!.hash).toMatch(/^[a-f0-9]{16}$/);
    expect(pkg.entries[0]!.contributedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("repoFingerprint is deterministic per repo path", () => {
    writeChromosomes(repo, [{ vendor: "claude", topic: "t", notes: "n" }]);
    const a = pool.buildPackage(repo)!.repoFingerprint;
    const b = pool.buildPackage(repo)!.repoFingerprint;
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe("pool.writePackage", () => {
  it("writes to default path under .mneme/genome-pool/", () => {
    writeChromosomes(repo, [{ vendor: "claude", topic: "t", notes: "n" }]);
    const pkg = pool.buildPackage(repo)!;
    const path = pool.writePackage(repo, pkg);
    expect(existsSync(path)).toBe(true);
    expect(path).toContain(".mneme");
    expect(path).toContain("genome-pool");
    const back = JSON.parse(readFileSync(path, "utf8"));
    expect(back.count).toBe(1);
  });

  it("respects --out override", () => {
    writeChromosomes(repo, [{ vendor: "claude", topic: "t", notes: "n" }]);
    const pkg = pool.buildPackage(repo)!;
    const out = join(repo, "custom-out.json");
    pool.writePackage(repo, pkg, out);
    expect(existsSync(out)).toBe(true);
  });
});

describe("pool.packageSummary", () => {
  it("renders human-readable summary", () => {
    writeChromosomes(repo, [{ vendor: "claude", topic: "t1", notes: "body" }]);
    const pkg = pool.buildPackage(repo)!;
    const s = pool.packageSummary(pkg);
    expect(s).toContain("Genome Pool contribution");
    expect(s).toContain("Chromosomes:   1");
    expect(s).toContain("t1");
  });
});
