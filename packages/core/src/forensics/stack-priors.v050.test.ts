/**
 * v0.50 — Bayesian Filter MAX tests.
 *
 *  - 50+ rule IDs covered with priors
 *  - Multi-ecosystem detection (Node / Python / Go / Rust / Ruby / PHP)
 *  - New stack flags (XML / YAML / GraphQL / session / file-upload)
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildStackProfile, detectStackProfile, priorForRule, type RuleId } from "./stack-priors.js";
import { _RULES_FOR_TESTS } from "./vulnhunt.js";

describe("v0.50 — rule catalogue", () => {
  it("ships ≥ 50 rule IDs", () => {
    expect(_RULES_FOR_TESTS.length).toBeGreaterThanOrEqual(50);
  });

  it("every rule has a non-trivial pattern", () => {
    for (const r of _RULES_FOR_TESTS) {
      expect(r.pattern.source.length).toBeGreaterThan(5);
      expect(r.summary.length).toBeGreaterThan(10);
    }
  });

  it("every rule id has a prior function", () => {
    const seenIds = new Set<RuleId>();
    for (const r of _RULES_FOR_TESTS) {
      seenIds.add(r.id);
      const prior = priorForRule(r.id, buildStackProfile([]));
      expect(prior).toBeGreaterThanOrEqual(0);
      expect(prior).toBeLessThanOrEqual(1);
    }
    // Plus check the "new in v0.50" ids exist
    const newV050: RuleId[] = [
      "insecure-tls-version", "timing-attack",
      "xxe-external-entity", "xpath-injection", "ldap-injection",
      "command-substitution", "null-byte-injection", "format-string",
      "csrf-missing", "session-fixation",
      "integer-overflow",
      "path-traversal", "open-redirect", "unrestricted-file-upload",
      "graphql-introspection-enabled",
      "insecure-cookie-flags", "hsts-missing",
      "insecure-deserialization", "unsafe-yaml-load",
      "sensitive-data-in-url",
      "race-double-fetch",
      "debug-mode-in-prod", "unsafe-temp-file", "unsafe-regex-dos",
    ];
    for (const id of newV050) {
      expect(seenIds.has(id), `rule ${id} should be registered`).toBe(true);
    }
  });

  it("graphql-introspection silenced on a non-GraphQL stack", () => {
    const stack = buildStackProfile(["express"]);
    expect(priorForRule("graphql-introspection-enabled", stack)).toBeLessThan(0.2);
  });

  it("graphql-introspection active when @apollo/server is present", () => {
    const stack = buildStackProfile(["@apollo/server"]);
    expect(priorForRule("graphql-introspection-enabled", stack)).toBeGreaterThan(0.5);
  });

  it("xxe rule active when an XML parser is present", () => {
    const stack = buildStackProfile(["xml2js"]);
    expect(priorForRule("xxe-external-entity", stack)).toBeGreaterThan(0.5);
    expect(priorForRule("xpath-injection", stack)).toBeGreaterThan(0.5);
  });

  it("yaml rule active when a YAML parser is present", () => {
    const stack = buildStackProfile(["js-yaml"]);
    expect(priorForRule("unsafe-yaml-load", stack)).toBeGreaterThan(0.5);
  });

  it("file-upload rule active when multer is present", () => {
    const stack = buildStackProfile(["multer"]);
    expect(priorForRule("unrestricted-file-upload", stack)).toBeGreaterThan(0.5);
  });
});

describe("v0.50 — multi-ecosystem detection", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "mneme-stack-multi-"));
  });
  afterEach(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  it("detects Node.js via package.json", async () => {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({ dependencies: { express: "^5.0.0" } }));
    const profile = await detectStackProfile(tmp);
    expect(profile.ecosystemNode).toBe(true);
    expect(profile.hasWebFramework).toBe(true);
  });

  it("detects Python via requirements.txt", async () => {
    writeFileSync(join(tmp, "requirements.txt"), "fastapi==0.104.0\nsqlalchemy>=2.0\n");
    const profile = await detectStackProfile(tmp);
    expect(profile.ecosystemPython).toBe(true);
    expect(profile.hasWebFramework).toBe(true); // fastapi
    expect(profile.hasSql).toBe(true); // sqlalchemy
  });

  it("detects Python via pyproject.toml", async () => {
    writeFileSync(join(tmp, "pyproject.toml"), `[project]
name = "x"
dependencies = ["django>=5.0", "psycopg2-binary"]
`);
    const profile = await detectStackProfile(tmp);
    expect(profile.ecosystemPython).toBe(true);
    expect(profile.hasWebFramework).toBe(true);
  });

  it("detects Go via go.mod", async () => {
    writeFileSync(join(tmp, "go.mod"), `module example.com/app
go 1.22

require (
  github.com/gin-gonic/gin v1.9.1
  github.com/lib/pq v1.10.9
)
`);
    const profile = await detectStackProfile(tmp);
    expect(profile.ecosystemGo).toBe(true);
    expect(profile.hasWebFramework).toBe(true);
    expect(profile.hasSql).toBe(true);
  });

  it("detects Rust via Cargo.toml", async () => {
    writeFileSync(join(tmp, "Cargo.toml"), `[package]
name = "x"
[dependencies]
actix-web = "4"
sqlx = "0.7"
`);
    const profile = await detectStackProfile(tmp);
    expect(profile.ecosystemRust).toBe(true);
    expect(profile.hasWebFramework).toBe(true);
    expect(profile.hasSql).toBe(true);
  });

  it("detects Ruby via Gemfile", async () => {
    writeFileSync(join(tmp, "Gemfile"), `gem 'rails', '~> 7.1'
gem 'mongoid'
`);
    const profile = await detectStackProfile(tmp);
    expect(profile.ecosystemRuby).toBe(true);
    expect(profile.hasWebFramework).toBe(true);
    expect(profile.hasNoSql).toBe(true);
  });

  it("detects PHP via composer.json", async () => {
    writeFileSync(join(tmp, "composer.json"), JSON.stringify({
      require: { "laravel/framework": "^10.0" },
    }));
    const profile = await detectStackProfile(tmp);
    expect(profile.ecosystemPhp).toBe(true);
    expect(profile.hasWebFramework).toBe(true);
  });

  it("returns empty profile when no manifests found", async () => {
    const profile = await detectStackProfile(tmp);
    expect(profile.ecosystemNode).toBe(false);
    expect(profile.ecosystemPython).toBe(false);
    expect(profile.ecosystemGo).toBe(false);
    expect(profile.ecosystemRust).toBe(false);
    expect(profile.ecosystemRuby).toBe(false);
    expect(profile.ecosystemPhp).toBe(false);
  });
});

// Vitest needs explicit imports for beforeEach/afterEach in this file scope
import { beforeEach, afterEach } from "vitest";
