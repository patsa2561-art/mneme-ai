import { describe, it, expect } from "vitest";
import {
  decisionsToVault,
  storyToVault,
  expertsToVault,
  slug,
  escapeMd,
} from "./obsidian.js";
import type { ExtractedDecision } from "./decisions.js";
import type { Story } from "./story.js";
import type { ExpertCandidate } from "./who-knows.js";

const decision = (overrides: Partial<ExtractedDecision> = {}): ExtractedDecision => ({
  commitHash: "abcdef1234567890abcdef1234567890abcdef12",
  shortHash: "abcdef1",
  date: "2024-08-12",
  author: "Alice",
  summary: "switched from passport to JWT",
  rationale: "compliance flagged session storage",
  kind: "switched",
  confidence: 0.9,
  ...overrides,
});

describe("slug", () => {
  it("lowercases and collapses whitespace", () => {
    expect(slug("Hello World")).toBe("hello-world");
  });

  it("strips non-word characters", () => {
    expect(slug("decided to use Map!")).toBe("decided-to-use-map");
  });

  it("collapses multiple dashes", () => {
    expect(slug("foo - - bar")).toBe("foo-bar");
  });

  it("trims leading/trailing dashes", () => {
    expect(slug("--hello--")).toBe("hello");
  });

  it("caps at 80 chars", () => {
    expect(slug("a".repeat(200)).length).toBeLessThanOrEqual(80);
  });
});

describe("escapeMd", () => {
  it("escapes pipe characters (table separator)", () => {
    expect(escapeMd("foo|bar")).toBe("foo\\|bar");
  });

  it("breaks wiki-link delimiters that would corrupt rendering", () => {
    expect(escapeMd("see [[other]]")).not.toContain("[[");
    expect(escapeMd("see [[other]]")).not.toContain("]]");
  });

  it("preserves normal text", () => {
    expect(escapeMd("ordinary commit subject")).toBe("ordinary commit subject");
  });
});

describe("decisionsToVault — empty case", () => {
  it("returns a single index file when no decisions", () => {
    const files = decisionsToVault([]);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("index.md");
    expect(files[0]!.content).toContain("No decisions extracted");
  });
});

describe("decisionsToVault — full case", () => {
  it("emits one note per decision plus authors plus index", () => {
    const decisions = [
      decision({ author: "Alice", summary: "A" }),
      decision({ author: "Alice", summary: "B" }),
      decision({ author: "Bob", summary: "C" }),
    ];
    const files = decisionsToVault(decisions);

    const decisionFiles = files.filter((f) => f.path.startsWith("decisions/"));
    const authorFiles = files.filter((f) => f.path.startsWith("authors/"));
    const indexFiles = files.filter((f) => f.path === "index.md");

    expect(decisionFiles).toHaveLength(3); // one per decision
    expect(authorFiles).toHaveLength(2);   // 2 distinct authors
    expect(indexFiles).toHaveLength(1);
  });

  it("each decision note has YAML frontmatter with date, author, kind, confidence", () => {
    const files = decisionsToVault([decision()]);
    const note = files.find((f) => f.path.startsWith("decisions/"))!;
    expect(note.content).toMatch(/^---\n/);
    expect(note.content).toContain("date: 2024-08-12");
    expect(note.content).toContain("author: Alice");
    expect(note.content).toContain("kind: switched");
    expect(note.content).toContain("confidence: 0.9");
    expect(note.content).toContain("commit: abcdef1");
  });

  it("decision note links back to the author hub", () => {
    const files = decisionsToVault([decision({ author: "Alice" })]);
    const note = files.find((f) => f.path.startsWith("decisions/"))!;
    expect(note.content).toContain("[[authors/alice|Alice]]");
  });

  it("decision note shows rationale when present", () => {
    const files = decisionsToVault([decision({ rationale: "compliance reasons" })]);
    const note = files.find((f) => f.path.startsWith("decisions/"))!;
    expect(note.content).toContain("Rationale");
    expect(note.content).toContain("compliance reasons");
  });

  it("author hub lists all decisions for that author", () => {
    const decisions = [
      decision({ author: "Alice", summary: "A1", date: "2024-01-01" }),
      decision({ author: "Alice", summary: "A2", date: "2024-02-01" }),
    ];
    const files = decisionsToVault(decisions);
    const hub = files.find((f) => f.path === "authors/alice.md")!;
    expect(hub.content).toContain("A1");
    expect(hub.content).toContain("A2");
    expect(hub.content).toContain("decisionCount: 2");
  });

  it("index.md contains a wiki-linked table of recent decisions", () => {
    const files = decisionsToVault([decision({ summary: "use Postgres" })]);
    const index = files.find((f) => f.path === "index.md")!;
    expect(index.content).toContain("[[decisions/");
    expect(index.content).toContain("use Postgres");
  });

  it("filenames are filesystem- and Obsidian-safe", () => {
    const tricky = decision({ summary: "decided to use C++ / Rust!" });
    const files = decisionsToVault([tricky]);
    for (const f of files) {
      expect(f.path).not.toMatch(/[/\\:*?"<>|]/g.source.replace(/\//g, ""));
      // No spaces in filenames (Obsidian works fine with them, but slugs are cleaner).
      expect(f.path.split("/").pop()!).not.toContain(" ");
    }
  });
});

describe("storyToVault", () => {
  const sampleStory: Story = {
    topic: "authentication",
    totalCommits: 3,
    spanDays: 90,
    acts: [
      {
        id: "initial",
        title: "Act I — The Beginning",
        fromDate: "2024-01-01",
        toDate: "2024-01-01",
        commits: [
          {
            hash: "a1",
            shortHash: "a1",
            authorName: "alice",
            authorEmail: "a@x",
            authorDate: "2024-01-01T00:00:00Z",
            committerDate: "2024-01-01T00:00:00Z",
            subject: "feat: passport",
            body: "",
            parents: [],
            files: [],
          },
        ],
      },
      {
        id: "refactor",
        title: "Act II — The Refactor",
        fromDate: "2024-02-01",
        toDate: "2024-04-01",
        commits: [
          {
            hash: "b1",
            shortHash: "b1",
            authorName: "alice",
            authorEmail: "a@x",
            authorDate: "2024-02-01T00:00:00Z",
            committerDate: "2024-02-01T00:00:00Z",
            subject: "refactor: replace passport",
            body: "",
            parents: [],
            files: [],
          },
        ],
      },
    ],
  };

  it("returns a single .md file for a story", () => {
    const files = storyToVault(sampleStory);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("story-authentication.md");
  });

  it("includes frontmatter with topic, acts, commits, spanDays", () => {
    const files = storyToVault(sampleStory);
    const c = files[0]!.content;
    expect(c).toContain("type: mneme-story");
    expect(c).toContain("topic: authentication");
    expect(c).toContain("acts: 2");
    expect(c).toContain("commits: 3");
    expect(c).toContain("spanDays: 90");
  });

  it("renders each act as a heading + commit list", () => {
    const c = storyToVault(sampleStory)[0]!.content;
    expect(c).toContain("## Act I");
    expect(c).toContain("## Act II");
    expect(c).toContain("feat: passport");
    expect(c).toContain("refactor: replace passport");
  });

  it("includes LLM act summaries when provided", () => {
    const summaries = new Map<number, string>([
      [0, "Started with passport.js OAuth"],
      [1, "Replaced passport with custom JWT"],
    ]);
    const c = storyToVault(sampleStory, summaries)[0]!.content;
    expect(c).toContain("Started with passport.js");
    expect(c).toContain("Replaced passport");
  });

  it("falls back to a clean note when story has no acts", () => {
    const empty: Story = { topic: "x", totalCommits: 0, spanDays: 0, acts: [] };
    const files = storyToVault(empty);
    expect(files[0]!.content).toContain("No commits matched");
  });
});

describe("expertsToVault", () => {
  const sampleExperts: ExpertCandidate[] = [
    {
      name: "Alice",
      email: "a@x",
      commitCount: 20,
      filesTouched: 50,
      lastTouch: "2026-04-01T00:00:00Z",
      score: 4.0,
      tier: "definitive",
    },
    {
      name: "Bob",
      email: "b@x",
      commitCount: 5,
      filesTouched: 12,
      lastTouch: "2025-12-01T00:00:00Z",
      score: 1.5,
      tier: "stale",
    },
  ];

  it("returns a single experts note", () => {
    const files = expertsToVault("stripe", sampleExperts);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("experts-stripe.md");
  });

  it("renders a markdown table with tier, name, counts, last touch", () => {
    const c = expertsToVault("stripe", sampleExperts)[0]!.content;
    expect(c).toContain("| Tier | Name | Commits | Files | Last touch |");
    expect(c).toContain("definitive");
    expect(c).toContain("Alice");
    expect(c).toContain("20");
  });

  it("links each name to the author hub", () => {
    const c = expertsToVault("stripe", sampleExperts)[0]!.content;
    expect(c).toContain("[[authors/alice|Alice]]");
    expect(c).toContain("[[authors/bob|Bob]]");
  });

  it("falls back to a friendly note when no experts found", () => {
    const c = expertsToVault("nothing", [])[0]!.content;
    expect(c).toContain("No experts found");
  });
});
