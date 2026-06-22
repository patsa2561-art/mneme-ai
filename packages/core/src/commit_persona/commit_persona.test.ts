import { describe, it, expect } from "vitest";
import { buildPersona, analyzeCommitPersonas, personaAvatarSvg, personaGauntlet, type CommitRec } from "./index.js";

function mk(author: string, subject: string, over: Partial<CommitRec> = {}): CommitRec {
  return { author, ts: 1_700_000_000 + 43200, subject, files: ["src/a.ts"], insertions: 20, deletions: 5, ...over };
}

describe("v3.123 · COMMIT PERSONA — git style as a measured 3D cartoon", () => {
  it("gauntlet is 100", () => expect(personaGauntlet().score).toBe(100));

  it("a structured `fix(core):` is NOT firefighting; an ad-hoc 'fix bug oops' IS", () => {
    const tidy = buildPersona("a", Array.from({ length: 10 }, () => mk("a", "fix(core): tighten guard", { files: ["src/x.ts", "src/x.test.ts"], insertions: 10, deletions: 3 })));
    expect(tidy.archetype).not.toBe("The Firefighter");
    const panic = buildPersona("b", Array.from({ length: 10 }, () => mk("b", "fix bug oops")));
    expect(panic.archetype).toBe("The Firefighter");
  });

  it("groups by author, busiest first, and avatars are distinct per author", () => {
    const commits = [
      ...Array.from({ length: 6 }, () => mk("alice", "feat: x")),
      ...Array.from({ length: 3 }, () => mk("bob", "chore: y")),
    ];
    const ps = analyzeCommitPersonas(commits);
    expect(ps[0]!.author).toBe("alice");
    expect(ps[0]!.metrics.commits).toBe(6);
    expect(personaAvatarSvg(ps[0]!)).not.toBe(personaAvatarSvg(ps[1]!));
  });

  it("the avatar is a self-contained SVG (no external fetch)", () => {
    const p = buildPersona("z", [mk("z", "feat: a")]);
    const svg = personaAvatarSvg(p);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(/<script|xlink:href|\b(?:href|src)\s*=|<image/i.test(svg)).toBe(false);
  });

  it("is total on hostile input", () => {
    expect(() => analyzeCommitPersonas(null as never)).not.toThrow();
    expect(() => buildPersona("", [])).not.toThrow();
    expect(analyzeCommitPersonas([]).length).toBe(0);
  });
});
