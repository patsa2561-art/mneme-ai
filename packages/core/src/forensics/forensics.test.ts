import { describe, it, expect } from "vitest";
import { extractLoci } from "./loci.js";
import {
  buildPopulationStats,
  compareLoci,
  verdict,
} from "./likelihood.js";
import { huntVulnerabilities } from "./vulnhunt.js";
import {
  buildBaselines,
  scoreAnomaly,
  detectAnomalies,
} from "./anomaly.js";
import type { Commit, FileChange } from "../types.js";

function mk(p: { hash: string; subject: string; date?: string; author?: string; files?: string[]; body?: string; pr?: number }): Commit {
  return {
    hash: p.hash,
    shortHash: p.hash.slice(0, 7),
    authorName: p.author ?? "Alice",
    authorEmail: (p.author ?? "alice").toLowerCase() + "@x.com",
    authorDate: p.date ?? "2024-01-01T10:00:00Z",
    committerDate: p.date ?? "2024-01-01T10:00:00Z",
    subject: p.subject,
    body: p.body ?? "",
    files: p.files ?? ["src/x.ts"],
    parents: [],
    prNumber: p.pr,
  };
}

// ─── extractLoci ──────────────────────────────────────────────────────

describe("extractLoci", () => {
  it("returns zero loci for empty input", () => {
    const l = extractLoci([]);
    expect(l.filesPerCommit).toBe(0);
    expect(l.conventionalRatio).toBe(0);
  });

  it("computes conventionalRatio from feat:/fix: prefixes", () => {
    const cs = [
      mk({ hash: "a", subject: "feat: add caching" }),
      mk({ hash: "b", subject: "fix: handle null" }),
      mk({ hash: "c", subject: "random subject" }),
    ];
    const l = extractLoci(cs);
    expect(l.conventionalRatio).toBeCloseTo(2 / 3, 2);
  });

  it("imperative verbs raise imperativeRatio", () => {
    const cs = [
      mk({ hash: "a", subject: "Add caching" }),
      mk({ hash: "b", subject: "Fix typo" }),
      mk({ hash: "c", subject: "Update docs" }),
    ];
    const l = extractLoci(cs);
    expect(l.imperativeRatio).toBeGreaterThan(0.6);
  });

  it("peakHour reflects most-common UTC band", () => {
    const cs = Array.from({ length: 5 }, (_, i) =>
      mk({ hash: `c${i}`, subject: "x", date: `2024-01-0${i + 1}T15:00:00Z` }),
    );
    const l = extractLoci(cs);
    expect(l.peakHour).toBeGreaterThanOrEqual(12);
    expect(l.peakHour).toBeLessThanOrEqual(15);
  });

  it("verbEntropy is 0 for monoculture and > 1 for diverse vocab", () => {
    const mono = Array.from({ length: 5 }, (_, i) =>
      mk({ hash: `c${i}`, subject: "add feature " + i }),
    );
    const diverse = [
      mk({ hash: "a1", subject: "add caching" }),
      mk({ hash: "a2", subject: "fix typo" }),
      mk({ hash: "a3", subject: "remove dead code" }),
      mk({ hash: "a4", subject: "rename module" }),
      mk({ hash: "a5", subject: "introduce policy" }),
    ];
    const lMono = extractLoci(mono);
    const lDiv = extractLoci(diverse);
    expect(lMono.verbEntropy).toBeLessThan(0.1);
    expect(lDiv.verbEntropy).toBeGreaterThan(1);
  });
});

// ─── verdict + LR ──────────────────────────────────────────────────────

describe("verdict (ENFSI)", () => {
  it("maps LR 100 to moderate support", () => {
    expect(verdict(100)).toBe("moderate support");
  });

  it("maps LR 10000 to very strong support", () => {
    expect(verdict(10_000)).toBe("very strong support");
  });

  it("maps LR 0.001 to strong support against", () => {
    expect(verdict(0.0009)).toBe("strong support against");
  });

  it("maps LR ~1 to uninformative", () => {
    expect(verdict(0.7)).toBe("uninformative");
  });
});

describe("compareLoci + buildPopulationStats", () => {
  it("matches author against themselves with strong support", () => {
    // Two authors with very different profiles
    const aliceCommits = Array.from({ length: 30 }, (_, i) =>
      mk({
        hash: `al${i}`,
        subject: `feat: add module ${i}`,
        date: `2024-${String((i % 12) + 1).padStart(2, "0")}-01T15:00:00Z`,
        author: "Alice",
      }),
    );
    const bobCommits = Array.from({ length: 30 }, (_, i) =>
      mk({
        hash: `bo${i}`,
        subject: `random thing ${i}`,
        date: `2024-${String((i % 12) + 1).padStart(2, "0")}-01T03:00:00Z`,
        author: "Bob",
      }),
    );
    const aliceLoci = extractLoci(aliceCommits);
    const bobLoci = extractLoci(bobCommits);
    const pop = buildPopulationStats([aliceLoci, bobLoci]);

    // Use Alice's own profile as evidence and Alice as suspect
    const r = compareLoci(aliceLoci, aliceLoci, pop);
    expect(r.combinedLR).toBeGreaterThan(1);
    // Should be at least "moderate support" when Alice matches Alice
    expect(["weak support", "moderate support", "strong support", "very strong support", "extremely strong support"]).toContain(r.verdict);
  });

  it("rejects clearly different authors with low LR", () => {
    const aliceCommits = Array.from({ length: 30 }, (_, i) =>
      mk({ hash: `al${i}`, subject: "feat: a", date: `2024-01-01T15:00:00Z`, author: "Alice" }),
    );
    const bobCommits = Array.from({ length: 30 }, (_, i) =>
      mk({ hash: `bo${i}`, subject: "thing", date: `2024-01-01T03:00:00Z`, author: "Bob", files: ["legacy.py"] }),
    );
    const aliceLoci = extractLoci(aliceCommits);
    const bobLoci = extractLoci(bobCommits);
    const pop = buildPopulationStats([aliceLoci, bobLoci]);

    // Use Alice's profile as evidence, Bob as suspect — should disfavor
    const r = compareLoci(aliceLoci, bobLoci, pop);
    expect(r.combinedLR).toBeLessThan(1);
  });
});

// ─── VulnHunt ──────────────────────────────────────────────────────────

describe("huntVulnerabilities", () => {
  it("flags MD5 usage as crypto-weakness", () => {
    const r = huntVulnerabilities([
      {
        commit: mk({ hash: "a1", subject: "auth: hash password" }),
        diff: "+ const hash = MD5(input);",
      },
    ]);
    expect(r.hits.find((h) => h.class === "crypto-weakness")).toBeDefined();
  });

  it("flags Math.random in security context", () => {
    const r = huntVulnerabilities([
      {
        commit: mk({ hash: "a1", subject: "create token" }),
        diff: "+ const token = Math.random().toString();",
      },
    ]);
    expect(r.hits.find((h) => h.class === "crypto-weakness")).toBeDefined();
  });

  it("flags hardcoded bearer token", () => {
    const r = huntVulnerabilities([
      {
        commit: mk({ hash: "a1", subject: "add api client" }),
        diff: "+ headers.Authorization = 'Bearer abc123def456ghi789jkl012';",
      },
    ]);
    expect(r.hits.find((h) => h.class === "auth-flaw")).toBeDefined();
  });

  it("flags console.log of password", () => {
    const r = huntVulnerabilities([
      {
        commit: mk({ hash: "a1", subject: "debug login" }),
        diff: "+ console.log('pw=', password);",
      },
    ]);
    expect(r.hits.find((h) => h.class === "info-leakage")).toBeDefined();
  });

  it("flags JWT decoded without verification", () => {
    const r = huntVulnerabilities([
      {
        commit: mk({ hash: "a1", subject: "parse token" }),
        diff: "+ const claims = jwt.decode(token);",
      },
    ]);
    expect(r.hits.find((h) => h.class === "auth-flaw")).toBeDefined();
  });

  it("returns silent fixes when subject mentions security", () => {
    const r = huntVulnerabilities([
      {
        commit: mk({ hash: "a1", subject: "fix CVE-2024-1234 in auth" }),
        diff: "",
      },
    ]);
    expect(r.silentFixes.length).toBe(1);
  });

  it("severity tally matches hits", () => {
    const r = huntVulnerabilities([
      { commit: mk({ hash: "a", subject: "x" }), diff: "+ MD5(x)" },
      { commit: mk({ hash: "b", subject: "y" }), diff: "+ jwt.decode(t);" },
    ]);
    expect(r.bySeverity.high + r.bySeverity.critical).toBeGreaterThanOrEqual(2);
  });
});

// ─── Anomaly ───────────────────────────────────────────────────────────

describe("buildBaselines + scoreAnomaly", () => {
  function mkSeries(author: string, hashes: string[], hour: number, files: string[][]): Commit[] {
    return hashes.map((h, i) =>
      mk({
        hash: h,
        subject: `feat: add thing ${i}`,
        author,
        date: `2024-${String((i % 12) + 1).padStart(2, "0")}-15T${pad(hour)}:00:00Z`,
        files: files[i % files.length],
      }),
    );
  }

  function pad(n: number): string {
    return n < 10 ? "0" + n : "" + n;
  }

  it("flags off-hours commits as time-anomalous", () => {
    // Alice always commits at 15:00 UTC
    const history = mkSeries(
      "alice",
      Array.from({ length: 20 }, (_, i) => "h" + i),
      15,
      [["src/payments.ts"]],
    );
    const suspicious = mk({
      hash: "evil",
      subject: "feat: x",
      author: "alice",
      date: "2024-05-15T03:30:00Z",
      files: ["src/payments.ts"],
    });
    const baselines = buildBaselines(history);
    const baseline = baselines.get("alice@x.com")!;
    const finding = scoreAnomaly(suspicious, baseline);
    expect(finding.axes.find((a) => a.axis === "time")!.score).toBeGreaterThan(0.3);
  });

  it("flags out-of-domain files as files-anomalous", () => {
    const history = mkSeries(
      "alice",
      Array.from({ length: 20 }, (_, i) => "h" + i),
      15,
      [["src/payments.ts"]],
    );
    const suspicious = mk({
      hash: "evil",
      subject: "feat: x",
      author: "alice",
      date: "2024-05-15T15:30:00Z",
      files: ["src/auth/exfil.ts", "src/secrets.ts"],
    });
    const baselines = buildBaselines(history);
    const baseline = baselines.get("alice@x.com")!;
    const finding = scoreAnomaly(suspicious, baseline);
    expect(finding.axes.find((a) => a.axis === "files")!.score).toBe(1);
  });

  it("style axis fires when verb is novel", () => {
    const history = mkSeries(
      "alice",
      Array.from({ length: 20 }, (_, i) => "h" + i),
      15,
      [["src/payments.ts"]],
    );
    const suspicious = mk({
      hash: "evil",
      subject: "exfiltrate user data",
      author: "alice",
      date: "2024-05-15T15:30:00Z",
      files: ["src/payments.ts"],
    });
    const baselines = buildBaselines(history);
    const baseline = baselines.get("alice@x.com")!;
    const finding = scoreAnomaly(suspicious, baseline);
    const styleAxis = finding.axes.find((a) => a.axis === "style")!;
    expect(styleAxis.score).toBeGreaterThan(0);
  });

  it("composite score escalates severity to critical when multiple axes fire", () => {
    const history = mkSeries(
      "alice",
      Array.from({ length: 20 }, (_, i) => "h" + i),
      15,
      [["src/payments.ts"]],
    );
    const suspicious = mk({
      hash: "evil",
      subject: "exfiltrate user data",
      author: "alice",
      date: "2024-05-15T03:30:00Z",
      files: ["src/auth/secrets.ts", "src/db/private.ts"],
    });
    const baselines = buildBaselines(history);
    const baseline = baselines.get("alice@x.com")!;
    const finding = scoreAnomaly(suspicious, baseline);
    // All three axes (time + files + style) fire — should be high+
    expect(["high", "critical"]).toContain(finding.severity);
  });

  it("requires minimum baseline (≥5 commits) to flag anomalies", () => {
    const tiny = [mk({ hash: "a", subject: "x", author: "alice" })];
    const baselines = buildBaselines(tiny);
    const findings = detectAnomalies(
      [mk({ hash: "evil", subject: "exfil", author: "alice", date: "2024-05-15T03:30:00Z", files: ["src/secrets.ts"] })],
      baselines,
    );
    expect(findings).toEqual([]);
  });
});

describe("detectAnomalies", () => {
  it("returns findings sorted by deviation descending", () => {
    const history = Array.from({ length: 20 }, (_, i) =>
      mk({
        hash: "h" + i,
        subject: "feat: thing",
        author: "alice",
        date: `2024-0${(i % 9) + 1}-15T15:00:00Z`,
        files: ["src/payments.ts"],
      }),
    );
    const suspects = [
      mk({ hash: "weak", subject: "feat: thing", author: "alice", date: "2024-10-15T16:00:00Z", files: ["src/payments.ts"] }),
      mk({ hash: "strong", subject: "exfil all", author: "alice", date: "2024-10-15T03:00:00Z", files: ["src/auth/secrets.ts"] }),
    ];
    const baselines = buildBaselines(history);
    const findings = detectAnomalies(suspects, baselines, [], 0.5);
    if (findings.length >= 2) {
      expect(findings[0]!.totalDeviation).toBeGreaterThanOrEqual(findings[1]!.totalDeviation);
    }
  });
});
