import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectProjectShape, curate, persistCurated, renderCuratedMarkdown,
  CURATED_CATALOG,
} from "./tool_curator.js";

describe("tool_curator", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-curator-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  describe("detectProjectShape", () => {
    it("returns no tags on empty dir", () => {
      const s = detectProjectShape(repo);
      expect(s.detectedTags).toEqual([]);
      expect(s.summary).toContain("no recognized framework");
    });

    it("detects NestJS + Postgres + Stripe (the user's stack)", () => {
      writeFileSync(join(repo, "package.json"), JSON.stringify({
        name: "ctm-api",
        dependencies: {
          "@nestjs/core": "^10",
          "pg": "^8",
          "stripe": "^14",
          "typescript": "^5",
        },
      }), "utf8");
      const s = detectProjectShape(repo);
      expect(s.detectedTags).toContain("nestjs");
      expect(s.detectedTags).toContain("postgres");
      expect(s.detectedTags).toContain("stripe");
      expect(s.detectedTags).toContain("typescript");
      expect(s.detectedTags).toContain("node");
    });

    it("detects Python + FastAPI", () => {
      writeFileSync(join(repo, "requirements.txt"), "fastapi==0.110\nsqlalchemy\n", "utf8");
      const s = detectProjectShape(repo);
      expect(s.detectedTags).toContain("python");
      expect(s.detectedTags).toContain("fastapi");
    });

    it("detects Rust", () => {
      writeFileSync(join(repo, "Cargo.toml"), "[package]\nname = \"test\"\n", "utf8");
      const s = detectProjectShape(repo);
      expect(s.detectedTags).toContain("rust");
    });

    it("detects Docker", () => {
      writeFileSync(join(repo, "Dockerfile"), "FROM node:24", "utf8");
      const s = detectProjectShape(repo);
      expect(s.detectedTags).toContain("docker");
    });

    it("detects monorepo", () => {
      writeFileSync(join(repo, "package.json"), JSON.stringify({
        name: "monorepo", workspaces: ["packages/*"],
      }), "utf8");
      const s = detectProjectShape(repo);
      expect(s.detectedTags).toContain("monorepo");
    });
  });

  describe("CURATED_CATALOG sanity", () => {
    it("ships honeypot tools that are clearly flagged", () => {
      const honeypots = CURATED_CATALOG.filter((t) => t.honeypot);
      expect(honeypots.length).toBeGreaterThanOrEqual(3);
      for (const h of honeypots) {
        expect(h.bucket).toBe("DANGER");
        expect(h.plainLabel).toContain("HONEYPOT");
      }
    });
    it("includes mneme.do router for overlap collapse", () => {
      expect(CURATED_CATALOG.some((t) => t.id === "mneme.do")).toBe(true);
    });
    it("memory + analysis tools are universal (relevantTo: [])", () => {
      const memory = CURATED_CATALOG.filter((t) => t.bucket === "memory");
      for (const t of memory) {
        expect(t.relevantTo).toEqual([]);
      }
    });
  });

  describe("curate end-to-end", () => {
    it("on the user's stack (NestJS + Postgres + Stripe), recommends framework-specific tools", () => {
      writeFileSync(join(repo, "package.json"), JSON.stringify({
        name: "ctm-api",
        dependencies: {
          "@nestjs/core": "^10",
          "pg": "^8",
          "stripe": "^14",
        },
      }), "utf8");
      const listing = curate(repo);
      const ids = listing.recommended.map((t) => t.id);
      // Should include NestJS-specific (express tools fire on nestjs too).
      expect(ids).toContain("mneme.express.find_unprotected_endpoints");
      // Should include Postgres-specific.
      expect(ids).toContain("mneme.postgres.find_n_plus_one");
      // Should include Stripe-specific.
      expect(ids).toContain("mneme.stripe.audit_pii_handlers");
      // Should NOT include honeypots in recommended.
      expect(ids).not.toContain("mneme.admin.delete_all");
      // Honeypots ARE listed separately.
      expect(listing.honeypotsToAvoid.length).toBeGreaterThanOrEqual(3);
    });

    it("on a Python-only project, omits Stripe/Postgres (Node) tools", () => {
      writeFileSync(join(repo, "requirements.txt"), "flask==3\n", "utf8");
      const listing = curate(repo);
      const ids = listing.recommended.map((t) => t.id);
      expect(ids).not.toContain("mneme.stripe.audit_pii_handlers");
      expect(ids).not.toContain("mneme.postgres.find_n_plus_one");
      // Universal tools should still be present.
      expect(ids).toContain("mneme.memory.ask");
      expect(ids).toContain("mneme.atrophy");
    });

    it("on an empty dir, recommends only universal tools", () => {
      const listing = curate(repo);
      for (const t of listing.recommended) {
        expect(t.relevantTo).toEqual([]);   // all are universal
      }
    });
  });

  describe("persistCurated + renderCuratedMarkdown", () => {
    it("persists a JSON file at .mneme/curated-tools.json", () => {
      mkdirSync(join(repo, ".mneme"), { recursive: true });
      const listing = curate(repo);
      const path = persistCurated(repo, listing);
      expect(existsSync(path)).toBe(true);
      const json = JSON.parse(readFileSync(path, "utf8"));
      expect(json.recommended).toBeDefined();
      expect(json.honeypotsToAvoid).toBeDefined();
    });
    it("renders markdown with HONEYPOT warning section", () => {
      const listing = curate(repo);
      const md = renderCuratedMarkdown(listing);
      expect(md).toContain("Mneme curated tool list");
      expect(md).toContain("HONEYPOT");
      expect(md).toContain("DO NOT CALL");
      expect(md).toContain("mneme.do");
    });
  });
});
