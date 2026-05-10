import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fileToCommunityIndex, communityForFile, writeCachedCommunities,
} from "./index.js";

describe("file → community lookup (used by GraphRAG retrieve filter)", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-grfilter-"));
    mkdirSync(join(repo, ".mneme/graphrag"), { recursive: true });
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("returns null when no communities cached", () => {
    expect(fileToCommunityIndex(repo)).toBeNull();
  });

  it("indexes file members of communities, ignores non-file members", () => {
    writeCachedCommunities(repo, {
      communities: [
        {
          id: "c0", members: ["file:src/a.ts", "file:src/b.ts", "commit:abc1234", "author:x"],
          density: 0.5, label: "src", topics: ["src"],
        },
        {
          id: "c1", members: ["file:tests/t.ts"], density: 0.3, label: "tests", topics: ["test"],
        },
      ],
      modularity: 0.4, iterations: 3, ranAt: new Date().toISOString(),
    });
    const idx = fileToCommunityIndex(repo);
    expect(idx).not.toBeNull();
    expect(idx!.size).toBe(3);
    expect(communityForFile(idx, "src/a.ts")).toBe("c0");
    expect(communityForFile(idx, "tests/t.ts")).toBe("c1");
    expect(communityForFile(idx, "doesnt/exist.ts")).toBeNull();
  });

  it("communityForFile handles null index", () => {
    expect(communityForFile(null, "any/file.ts")).toBeNull();
  });

  it("survives malformed cached file", () => {
    writeFileSync(join(repo, ".mneme/graphrag/communities.json"), "not json", "utf8");
    expect(fileToCommunityIndex(repo)).toBeNull();
  });
});
