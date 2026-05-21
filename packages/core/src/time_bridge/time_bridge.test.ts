import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inscribe, surface, resurrect, recordOverride,
  markHeeded, markIgnored, fireWatchers, tree,
  enableAutoInscription,
  formatSurfaceMatches, formatResurrectionVerdict,
  FORMAT_VERSION,
} from "./index.js";
import { withSuperNova, clearObservers } from "../super_nova/index.js";

describe("time_bridge", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-tb-"));
    clearObservers();
  });
  afterEach(() => {
    clearObservers();
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  describe("inscribe", () => {
    it("writes an HMAC-signed inscription to disk", async () => {
      const i = await inscribe(repo, {
        author: "Shinnapat",
        kind: "constraint",
        headline: "never auto-merge without polygraph green",
        reasoning: "we had a regression in 2024 when an auto-merge bypassed polygraph",
        fra: { appliesWhen: "any PR auto-merge attempt", signals: { keywords: ["auto-merge", "merge"] } },
        tags: ["ci", "polygraph"],
      });
      expect(i.v).toBe(FORMAT_VERSION);
      expect(i.id).toMatch(/^ins_/);
      expect(i.sig).toMatch(/^[A-Za-z0-9_-]{20,}$/);
      expect(i.kind).toBe("constraint");
      expect(existsSync(join(repo, ".mneme/time_bridge/inscriptions.jsonl"))).toBe(true);
    });
  });

  describe("surface (FRP + DAS + Spotlight)", () => {
    it("returns no matches when no inscriptions exist", async () => {
      const m = await surface(repo, { file: "src/foo.ts" });
      expect(m).toEqual([]);
    });
    it("matches on keyword overlap with planned text", async () => {
      await inscribe(repo, {
        author: "past-me",
        kind: "warning",
        headline: "be careful with rate-limit headers",
        reasoning: "X-RateLimit-* breaks Cloudflare in EU region",
        fra: { appliesWhen: "any rate-limit work", signals: { keywords: ["rate-limit", "X-RateLimit"] }, initialWeight: 0.6 },
        tags: ["rate-limit"],
      });
      const m = await surface(repo, { text: "I'll add X-RateLimit-Remaining to the response" });
      expect(m.length).toBeGreaterThan(0);
      expect(m[0]!.inscription.headline).toContain("rate-limit");
      expect(m[0]!.reasons.some((r) => r.includes("keyword"))).toBe(true);
    });
    it("file-signal matches when file path overlap", async () => {
      await inscribe(repo, {
        author: "past-me",
        kind: "constraint",
        headline: "auth.ts module must always validate JWT exp",
        reasoning: "incident in 2025 — skipped exp check",
        fra: { appliesWhen: "any touch of auth.ts", signals: { files: ["src/auth.ts"] }, initialWeight: 0.6 },
        tags: ["auth"],
      });
      const m = await surface(repo, { file: "src/auth.ts" });
      expect(m.length).toBeGreaterThan(0);
      expect(m[0]!.inscription.id).toMatch(/^ins_/);
    });
    it("respects threshold + topK", async () => {
      for (let i = 0; i < 6; i++) {
        await inscribe(repo, {
          author: "x", kind: "annotation", headline: `note ${i}`, reasoning: "...",
          fra: { appliesWhen: "always", signals: { keywords: ["alpha"] }, initialWeight: 0.6 },
          tags: ["alpha"],
        });
      }
      const m = await surface(repo, { text: "alpha event", topK: 3 });
      expect(m.length).toBeLessThanOrEqual(3);
    });
  });

  describe("resurrect", () => {
    it("does NOT block when no constraints contradict the plan", async () => {
      const v = await resurrect(repo, "add a new feature");
      expect(v.blocked).toBe(false);
      expect(v.contradicts).toEqual([]);
    });
    it("BLOCKS when plan contradicts a stored constraint", async () => {
      await inscribe(repo, {
        author: "past-me",
        kind: "constraint",
        headline: "no auto-merge",
        reasoning: "see 2024 regression",
        fra: { appliesWhen: "any auto-merge", signals: { keywords: ["auto-merge"] }, initialWeight: 0.7 },
        tags: ["ci"],
      });
      const v = await resurrect(repo, "set up GitHub Actions to auto-merge PRs once tests pass");
      expect(v.blocked).toBe(true);
      expect(v.contradicts.length).toBeGreaterThan(0);
      expect(v.requiredOverride).toContain("TIME BRIDGE OVERRIDE");
    });
  });

  describe("recordOverride", () => {
    it("writes a signed override record", async () => {
      const r = await recordOverride(repo, { overrider: "me-today", inscriptionId: "ins_abc", reason: "different context now" });
      expect(r.v).toBe(1);
      expect(r.sig).toMatch(/^[A-Za-z0-9_-]{20,}$/);
      expect(existsSync(join(repo, ".mneme/time_bridge/overrides.jsonl"))).toBe(true);
    });
  });

  describe("Spotlight auto-tuning (markHeeded / markIgnored)", () => {
    it("boosts score for heavily-heeded inscriptions + suppresses heavily-ignored", async () => {
      const heeded = await inscribe(repo, {
        author: "x", kind: "warning", headline: "h", reasoning: "r",
        fra: { appliesWhen: "any", signals: { keywords: ["test"] }, initialWeight: 0.5 },
        tags: [],
      });
      const ignored = await inscribe(repo, {
        author: "x", kind: "warning", headline: "i", reasoning: "r",
        fra: { appliesWhen: "any", signals: { keywords: ["test"] }, initialWeight: 0.5 },
        tags: [],
      });
      for (let i = 0; i < 5; i++) markHeeded(repo, heeded.id);
      for (let i = 0; i < 5; i++) markIgnored(repo, ignored.id);
      const m = await surface(repo, { text: "test alpha" });
      const hMatch = m.find((x) => x.inscription.id === heeded.id);
      const iMatch = m.find((x) => x.inscription.id === ignored.id);
      expect(hMatch).toBeDefined();
      // Heeded got boosted; ignored may have been suppressed below threshold.
      if (iMatch) {
        expect(hMatch!.score).toBeGreaterThan(iMatch.score);
      }
    });
  });

  describe("fireWatchers (wake predicates)", () => {
    it("fires date-reached predicate when the time has passed", async () => {
      await inscribe(repo, {
        author: "x", kind: "annotation", headline: "wake me past-date", reasoning: "...",
        fra: { appliesWhen: "later" },
        wakes: [{ description: "after past date", trigger: { kind: "date-reached", iso: "2020-01-01T00:00:00Z" } }],
        tags: [],
      });
      const fired = await fireWatchers(repo);
      expect(fired.length).toBeGreaterThan(0);
      expect(fired[0]!.predicate.trigger.kind).toBe("date-reached");
    });
    it("does NOT fire date-reached for future dates", async () => {
      await inscribe(repo, {
        author: "x", kind: "annotation", headline: "wake me future", reasoning: "...",
        fra: { appliesWhen: "later" },
        wakes: [{ description: "after future date", trigger: { kind: "date-reached", iso: "2099-01-01T00:00:00Z" } }],
        tags: [],
      });
      const fired = await fireWatchers(repo);
      expect(fired.length).toBe(0);
    });
    it("fires file-touched predicate when context matches", async () => {
      await inscribe(repo, {
        author: "x", kind: "warning", headline: "wake on auth.ts touch", reasoning: "...",
        fra: { appliesWhen: "later" },
        wakes: [{ description: "auth.ts touched", trigger: { kind: "file-touched", pattern: "auth.ts" } }],
        tags: [],
      });
      const fired = await fireWatchers(repo, { file: "src/auth.ts" });
      expect(fired.length).toBeGreaterThan(0);
    });
    it("does not refire a wake that already fired", async () => {
      await inscribe(repo, {
        author: "x", kind: "annotation", headline: "wake once", reasoning: "...",
        fra: { appliesWhen: "later" },
        wakes: [{ description: "past", trigger: { kind: "date-reached", iso: "2020-01-01T00:00:00Z" } }],
        tags: [],
      });
      const a = await fireWatchers(repo);
      const b = await fireWatchers(repo);
      expect(a.length).toBeGreaterThan(0);
      expect(b.length).toBe(0);
    });
  });

  describe("tree (Generational Constraint Tree)", () => {
    it("returns parent + children lineage", async () => {
      const root = await inscribe(repo, {
        author: "x", kind: "constraint", headline: "v1 constraint", reasoning: "r",
        fra: { appliesWhen: "always" }, tags: [],
      });
      const child = await inscribe(repo, {
        author: "x", kind: "constraint", headline: "v2 overrides", reasoning: "r",
        fra: { appliesWhen: "always" }, parentId: root.id, tags: [],
      });
      const t = tree(repo, root.id);
      expect(t).not.toBeNull();
      expect(t!.inscription.id).toBe(root.id);
      expect(t!.children.length).toBe(1);
      expect(t!.children[0]!.inscription.id).toBe(child.id);
    });
  });

  describe("auto-inscription via SUPER NOVA observer", () => {
    it("enableAutoInscription installs an observer that records noteworthy verbs", async () => {
      const off = enableAutoInscription({ repoRoot: repo, author: "auto-test" });
      // Fire a "noteworthy" verb shape that matches the inscriber regex.
      await withSuperNova(
        { verb: "mneme.cert.mint.test", surface: "lib", repoRoot: repo, vendor: "test" },
        async () => "ok",
      );
      const path = join(repo, ".mneme/time_bridge/inscriptions.jsonl");
      expect(existsSync(path)).toBe(true);
      off();
    });
  });

  describe("formatters", () => {
    it("formatSurfaceMatches prints a readable list", async () => {
      const i = await inscribe(repo, {
        author: "Shinnapat", kind: "warning", headline: "watch this", reasoning: "...",
        fra: { appliesWhen: "always", signals: { keywords: ["watch"] }, initialWeight: 0.7 },
        tags: [],
      });
      const m = await surface(repo, { text: "I will watch" });
      const out = formatSurfaceMatches(m);
      expect(out).toContain("TIME BRIDGE");
      expect(out).toContain(i.id);
      expect(out).toContain("Shinnapat");
    });
    it("formatResurrectionVerdict surfaces required override text on block", async () => {
      await inscribe(repo, {
        author: "x", kind: "constraint", headline: "never delete .env", reasoning: "...",
        fra: { appliesWhen: "any .env touch", signals: { keywords: ["delete .env", ".env"] }, initialWeight: 0.8 },
        tags: [],
      });
      const v = await resurrect(repo, "I'll delete .env to clean up");
      const out = formatResurrectionVerdict(v);
      expect(out).toContain("RESURRECTION");
      expect(out).toContain("TIME BRIDGE OVERRIDE");
    });
  });
});
