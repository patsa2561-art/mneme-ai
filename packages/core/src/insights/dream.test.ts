import { describe, it, expect } from "vitest";
import {
  buildDreamPrompt,
  parseDreamIdeas,
  heuristicDream,
  type RepoSignals,
} from "./dream.js";

const sampleSignals: RepoSignals = {
  totalCommits: 100,
  totalEntities: 500,
  totalIncidents: 5,
  languages: [
    { name: "typescript", count: 400 },
    { name: "python", count: 80 },
    { name: "go", count: 20 },
  ],
  recentSubjects: [
    "fix: stripe webhook on bigint",
    "feat: add jwt rotation",
    "refactor: extract OrderService",
  ],
  topModules: [
    { name: "src/payment", count: 60 },
    { name: "src/auth", count: 40 },
    { name: "src/orders", count: 30 },
  ],
  patternSuffixes: [
    { suffix: "Service", count: 12 },
    { suffix: "Adapter", count: 8 },
    { suffix: "Controller", count: 6 },
  ],
};

describe("buildDreamPrompt", () => {
  it("includes total counts and language distribution", () => {
    const p = buildDreamPrompt(sampleSignals, 5);
    expect(p).toContain("Total commits indexed: 100");
    expect(p).toContain("Total entities indexed: 500");
    expect(p).toContain("typescript: 400");
    expect(p).toContain("python: 80");
  });

  it("includes top modules and pattern suffixes", () => {
    const p = buildDreamPrompt(sampleSignals, 5);
    expect(p).toContain("src/payment");
    expect(p).toContain("Service (12×)");
  });

  it("includes recent commit subjects (capped)", () => {
    const p = buildDreamPrompt(sampleSignals, 5);
    expect(p).toContain("stripe webhook on bigint");
  });

  it("requests JSON output", () => {
    const p = buildDreamPrompt(sampleSignals, 3);
    expect(p.toLowerCase()).toContain("json");
    expect(p).toContain("3");
  });
});

describe("parseDreamIdeas", () => {
  it("parses a clean JSON array", () => {
    const raw = JSON.stringify([
      {
        title: "MultiCurrencyAdapter",
        pitch: "You already abstract Stripe via PaymentAdapter. Extending to multi-currency is a small parallel.",
        precedents: ["PaymentAdapter"],
        effort: "small",
        risk: "low",
      },
    ]);
    const ideas = parseDreamIdeas(raw);
    expect(ideas).toHaveLength(1);
    expect(ideas[0]!.title).toBe("MultiCurrencyAdapter");
    expect(ideas[0]!.effort).toBe("small");
  });

  it("strips markdown fences and prose around the JSON", () => {
    const raw = "Here are some ideas:\n```json\n" +
      JSON.stringify([{ title: "X", pitch: "Y", precedents: [], effort: "medium", risk: "low" }]) +
      "\n```\nLet me know if you want more.";
    expect(parseDreamIdeas(raw)).toHaveLength(1);
  });

  it("returns [] on malformed JSON instead of throwing", () => {
    expect(parseDreamIdeas("this is not json at all")).toEqual([]);
    expect(parseDreamIdeas("[invalid, json,]")).toEqual([]);
  });

  it("filters out items without title or pitch", () => {
    const raw = JSON.stringify([
      { title: "Good", pitch: "yes" },
      { title: "BadNoOitch" }, // missing pitch
      { pitch: "no title" },   // missing title
    ]);
    const ideas = parseDreamIdeas(raw);
    expect(ideas).toHaveLength(1);
    expect(ideas[0]!.title).toBe("Good");
  });

  it("normalizes invalid effort/risk to defaults", () => {
    const raw = JSON.stringify([
      { title: "X", pitch: "y", effort: "extreme", risk: "🚨" },
    ]);
    const ideas = parseDreamIdeas(raw);
    expect(ideas[0]!.effort).toBe("medium");
    expect(ideas[0]!.risk).toBe("medium");
  });

  it("handles non-array input gracefully", () => {
    expect(parseDreamIdeas('{"not": "array"}')).toEqual([]);
  });
});

describe("heuristicDream — deterministic no-LLM fallback", () => {
  it("returns up to N ideas", () => {
    expect(heuristicDream(sampleSignals, 3).length).toBeLessThanOrEqual(3);
    expect(heuristicDream(sampleSignals, 5).length).toBeLessThanOrEqual(5);
  });

  it("includes IncidentReplayHarness when incidents > 0", () => {
    const ideas = heuristicDream(sampleSignals, 5);
    expect(ideas.find((i) => i.title === "IncidentReplayHarness")).toBeDefined();
  });

  it("omits IncidentReplayHarness when incidents = 0", () => {
    const noIncidents = { ...sampleSignals, totalIncidents: 0 };
    const ideas = heuristicDream(noIncidents, 5);
    expect(ideas.find((i) => i.title === "IncidentReplayHarness")).toBeUndefined();
  });

  it("uses the top pattern suffix in idea naming", () => {
    const ideas = heuristicDream(sampleSignals, 5);
    expect(ideas.some((i) => i.title.includes("Service"))).toBe(true);
  });

  it("every idea has the required fields populated", () => {
    const ideas = heuristicDream(sampleSignals, 5);
    for (const idea of ideas) {
      expect(idea.title.length).toBeGreaterThan(0);
      expect(idea.pitch.length).toBeGreaterThan(20);
      expect(["small", "medium", "large"]).toContain(idea.effort);
      expect(["low", "medium", "high"]).toContain(idea.risk);
    }
  });
});
