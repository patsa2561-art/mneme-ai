/**
 * Dual-jury logic — verify prosecution/defense partitioning + verdict mapping.
 *
 * The full conscience command needs a git repo + index, so this test exercises
 * the pure logic via a tiny adapter that mimics the related-commit shape.
 */
import { describe, expect, it } from "vitest";

interface RelatedCommitMin {
  riskScore: number;
  fileOverlapRatio: number;
  incidentCount: number;
  incidentIds: string[];
  commit: { hash: string; shortHash?: string; subject: string; authorDate: string };
}

interface DualJury {
  prosecution: RelatedCommitMin[];
  defense: RelatedCommitMin[];
  verdictScore: number;
  verdict: "block" | "caution" | "clear";
  totalCommits: number;
}

function buildDualJury(related: RelatedCommitMin[]): DualJury {
  const prosecution = related
    .filter((r) => r.incidentCount > 0)
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 3);
  const defense = related
    .filter((r) => r.incidentCount === 0)
    .sort((a, b) => b.fileOverlapRatio - a.fileOverlapRatio)
    .slice(0, 3);
  const prosStrength = prosecution.reduce((s, r) => s + r.riskScore, 0);
  const defStrength = defense.reduce((s, r) => s + r.fileOverlapRatio, 0);
  const total = prosStrength + defStrength;
  const verdictScore = total > 0 ? (prosStrength - defStrength) / total : 0;
  let verdict: DualJury["verdict"];
  if (verdictScore > 0.4) verdict = "block";
  else if (verdictScore > -0.1) verdict = "caution";
  else verdict = "clear";
  return { prosecution, defense, verdictScore, verdict, totalCommits: related.length };
}

const c = (
  hash: string,
  riskScore: number,
  overlap: number,
  incidents = 0,
): RelatedCommitMin => ({
  riskScore,
  fileOverlapRatio: overlap,
  incidentCount: incidents,
  incidentIds: incidents > 0 ? [`INC-${hash}`] : [],
  commit: { hash, shortHash: hash.slice(0, 7), subject: `subject for ${hash}`, authorDate: "2025-01-01" },
});

describe("conscience dual-jury", () => {
  it("partitions prosecution (incidents) and defense (clean)", () => {
    const related = [
      c("aaa", 0.9, 0.8, 2),
      c("bbb", 0.6, 0.5, 0),
      c("ccc", 0.4, 0.7, 1),
    ];
    const j = buildDualJury(related);
    expect(j.prosecution.map((p) => p.commit.hash)).toEqual(["aaa", "ccc"]);
    expect(j.defense.map((d) => d.commit.hash)).toEqual(["bbb"]);
  });

  it("returns verdict=block when prosecution dominates", () => {
    const related = [c("a", 0.95, 0.9, 3), c("b", 0.85, 0.8, 2)];
    const j = buildDualJury(related);
    expect(j.verdict).toBe("block");
    expect(j.verdictScore).toBeGreaterThan(0.4);
  });

  it("returns verdict=clear when defense dominates", () => {
    const related = [c("a", 0.0, 0.9, 0), c("b", 0.0, 0.8, 0), c("c", 0.0, 0.7, 0)];
    const j = buildDualJury(related);
    expect(j.verdict).toBe("clear");
    expect(j.verdictScore).toBeLessThan(-0.1);
  });

  it("returns verdict=caution when balanced (prosecution and defense roughly equal)", () => {
    // Prosecution risk 0.5, defense overlap 0.5 → score = 0 → caution band [-0.1, 0.4]
    const related = [c("a", 0.5, 0.5, 1), c("b", 0.0, 0.5, 0)];
    const j = buildDualJury(related);
    expect(j.verdict).toBe("caution");
  });

  it("returns verdict=caution when no related commits", () => {
    const j = buildDualJury([]);
    expect(j.verdict).toBe("caution");
    expect(j.verdictScore).toBe(0);
    expect(j.prosecution).toHaveLength(0);
    expect(j.defense).toHaveLength(0);
  });

  it("caps prosecution + defense at 3 each", () => {
    const related = [
      c("a", 0.9, 0.5, 1),
      c("b", 0.8, 0.5, 1),
      c("c", 0.7, 0.5, 1),
      c("d", 0.6, 0.5, 1),
      c("e", 0.5, 0.5, 1),
    ];
    const j = buildDualJury(related);
    expect(j.prosecution).toHaveLength(3);
    // The strongest 3 by riskScore should be picked
    expect(j.prosecution[0]!.commit.hash).toBe("a");
  });
});
