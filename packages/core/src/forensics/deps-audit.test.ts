import { describe, expect, it } from "vitest";
import { auditDependencies, parseLockfile } from "./deps-audit.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("forensics/deps-audit — parseLockfile", () => {
  it("parses npm v3 lockfile into (name, version) inventory", () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { name: "root", version: "0.1.0" },
        "node_modules/express": { version: "4.18.0" },
        "node_modules/express/node_modules/qs": { version: "6.10.0" },
        "node_modules/typescript": { name: "typescript", version: "5.3.0" },
      },
    });
    const inv = parseLockfile(lock);
    const names = inv.map((p) => `${p.name}@${p.version}`);
    expect(names).toContain("express@4.18.0");
    expect(names).toContain("qs@6.10.0");
    expect(names).toContain("typescript@5.3.0");
  });

  it("dedupes identical (name, version) pairs", () => {
    const lock = JSON.stringify({
      packages: {
        "node_modules/lodash": { version: "4.17.21" },
        "node_modules/express/node_modules/lodash": { version: "4.17.21" },
      },
    });
    expect(parseLockfile(lock)).toHaveLength(1);
  });

  it("returns empty array on malformed JSON", () => {
    expect(parseLockfile("{not json")).toEqual([]);
  });
});

describe("forensics/deps-audit — auditDependencies", () => {
  it("returns notes when there's no lockfile", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "mneme-audit-"));
    try {
      const r = await auditDependencies({ cwd: tmp });
      expect(r.findings).toEqual([]);
      expect(r.notes[0]).toMatch(/No package-lock\.json/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("offline mode skips the network and reports it", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "mneme-audit-"));
    try {
      writeFileSync(
        join(tmp, "package-lock.json"),
        JSON.stringify({ packages: { "node_modules/express": { version: "4.18.0" } } }),
      );
      const r = await auditDependencies({ cwd: tmp, offline: true });
      expect(r.findings).toEqual([]);
      expect(r.notes.some((n) => n.includes("offline mode"))).toBe(true);
      expect(r.packagesScanned).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("propagates a fetch failure as a note rather than throwing", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "mneme-audit-"));
    try {
      writeFileSync(
        join(tmp, "package-lock.json"),
        JSON.stringify({ packages: { "node_modules/express": { version: "4.18.0" } } }),
      );
      const flakyFetch = (() => {
        throw new Error("network down");
      }) as unknown as typeof fetch;
      const r = await auditDependencies({ cwd: tmp, fetchImpl: flakyFetch });
      expect(r.findings).toEqual([]);
      expect(r.notes.some((n) => /OSV\.dev query failed/.test(n))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("maps OSV findings into the report shape", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "mneme-audit-"));
    try {
      writeFileSync(
        join(tmp, "package-lock.json"),
        JSON.stringify({ packages: { "node_modules/lodash": { version: "4.17.20" } } }),
      );
      const fakeFetch = (async (url: string) => {
        if (url.endsWith("/v1/querybatch")) {
          return new Response(JSON.stringify({ results: [{ vulns: [{ id: "GHSA-xxxx-yyyy-zzzz" }] }] }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            id: "GHSA-xxxx-yyyy-zzzz",
            summary: "Prototype pollution in lodash",
            aliases: ["CVE-2020-8203"],
            database_specific: { severity: "high" },
            affected: [{ ranges: [{ events: [{ fixed: "4.17.21" }] }] }],
            references: [{ url: "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz" }],
          }),
          { status: 200 },
        );
      }) as unknown as typeof fetch;
      const r = await auditDependencies({ cwd: tmp, fetchImpl: fakeFetch });
      expect(r.findings).toHaveLength(1);
      const f = r.findings[0]!;
      expect(f.id).toBe("GHSA-xxxx-yyyy-zzzz");
      expect(f.severity).toBe("high");
      expect(f.package).toBe("lodash");
      expect(f.installedVersion).toBe("4.17.20");
      expect(f.fixedIn).toBe("4.17.21");
      expect(f.aliases).toContain("CVE-2020-8203");
      expect(r.bySeverity.high).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
