/**
 * Genome Marketplace — unit tests on a tmpdir repo.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  packGenome,
  installGenome,
  verifyGenome,
  listInstalledGenomes,
  type Genome,
} from "./_genome_marketplace.js";

describe("packGenome / verifyGenome", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-genome-"));
    mkdirSync(join(repo, ".mneme"), { recursive: true });
  });
  afterEach(() => {
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("returns empty files array when .mneme/ has no portable files", () => {
    const g = packGenome(repo, "test", "1.0.0");
    expect(g.files).toHaveLength(0);
  });

  it("includes portable files (constitution, packs/) in the genome", () => {
    writeFileSync(join(repo, ".mneme", "constitution.json"), JSON.stringify({ rules: ["test"] }));
    mkdirSync(join(repo, ".mneme", "packs"), { recursive: true });
    writeFileSync(join(repo, ".mneme", "packs", "stripe.yml"), "name: stripe\n");
    const g = packGenome(repo, "test", "1.0.0");
    expect(g.files.some((f) => f.name === "constitution.json")).toBe(true);
    expect(g.files.some((f) => f.name === "packs/stripe.yml")).toBe(true);
  });

  it("scrubs email addresses while preserving the domain", () => {
    writeFileSync(
      join(repo, ".mneme", "tribal-knowledge.json"),
      JSON.stringify({ author: "alice@acme.com", note: "see bob@example.org for context" }),
    );
    const g = packGenome(repo, "test", "1.0.0");
    const f = g.files.find((x) => x.name === "tribal-knowledge.json");
    expect(f).toBeDefined();
    expect(f!.content).not.toContain("alice@acme.com");
    expect(f!.content).not.toContain("bob@example.org");
    expect(f!.content).toContain("<email>@acme.com");
    expect(f!.content).toContain("<email>@example.org");
  });

  it("does NOT include runtime state files (mneme.db, replay.jsonl, scoreboard)", () => {
    writeFileSync(join(repo, ".mneme", "mneme.db"), "binary-blob");
    writeFileSync(join(repo, ".mneme", "replay.jsonl"), `{"hash":"x"}\n`);
    writeFileSync(join(repo, ".mneme", "confess-scoreboard.json"), "{}");
    writeFileSync(join(repo, ".mneme", "constitution.json"), "{}");
    const g = packGenome(repo, "test", "1.0.0");
    expect(g.files.find((f) => f.name === "mneme.db")).toBeUndefined();
    expect(g.files.find((f) => f.name === "replay.jsonl")).toBeUndefined();
    expect(g.files.find((f) => f.name === "confess-scoreboard.json")).toBeUndefined();
    expect(g.files.find((f) => f.name === "constitution.json")).toBeDefined();
  });

  it("contentHash is deterministic + verifiable", () => {
    writeFileSync(join(repo, ".mneme", "constitution.json"), JSON.stringify({ a: 1 }));
    const g1 = packGenome(repo, "test", "1.0.0");
    const g2 = packGenome(repo, "test", "1.0.0");
    expect(g1.contentHash).toBe(g2.contentHash);
    expect(verifyGenome(g1).valid).toBe(true);
  });

  it("verifyGenome rejects tampered hash", () => {
    writeFileSync(join(repo, ".mneme", "constitution.json"), "{}");
    const g = packGenome(repo, "test", "1.0.0");
    g.files.push({ name: "extra.txt", content: "added after pack" });
    expect(verifyGenome(g).valid).toBe(false);
  });
});

describe("installGenome", () => {
  let src: string;
  let dest: string;
  beforeEach(() => {
    src = mkdtempSync(join(tmpdir(), "mneme-genome-src-"));
    dest = mkdtempSync(join(tmpdir(), "mneme-genome-dest-"));
    mkdirSync(join(src, ".mneme"), { recursive: true });
  });
  afterEach(() => {
    try { rmSync(src, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(dest, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("installs all files from a verified genome", () => {
    writeFileSync(join(src, ".mneme", "constitution.json"), JSON.stringify({ rules: [] }));
    const g = packGenome(src, "test", "1.0.0");
    const r = installGenome(dest, g);
    expect(r.installed).toBe(1);
    expect(r.skipped).toBe(0);
    expect(existsSync(join(dest, ".mneme", "constitution.json"))).toBe(true);
  });

  it("reports conflicts when destination already has the file (no force)", () => {
    writeFileSync(join(src, ".mneme", "constitution.json"), "newer");
    const g = packGenome(src, "test", "1.0.0");
    mkdirSync(join(dest, ".mneme"), { recursive: true });
    writeFileSync(join(dest, ".mneme", "constitution.json"), "older");
    const r = installGenome(dest, g);
    expect(r.installed).toBe(0);
    expect(r.skipped).toBe(1);
    expect(r.conflicts).toContain("constitution.json");
    expect(readFileSync(join(dest, ".mneme", "constitution.json"), "utf8")).toBe("older");
  });

  it("force=true overwrites existing files", () => {
    writeFileSync(join(src, ".mneme", "constitution.json"), "newer");
    const g = packGenome(src, "test", "1.0.0");
    mkdirSync(join(dest, ".mneme"), { recursive: true });
    writeFileSync(join(dest, ".mneme", "constitution.json"), "older");
    const r = installGenome(dest, g, { force: true });
    expect(r.installed).toBe(1);
    expect(readFileSync(join(dest, ".mneme", "constitution.json"), "utf8")).toBe("newer");
  });

  it("rejects path-traversal attempts", () => {
    const g: Genome = {
      schemaVersion: 1,
      id: "evil",
      title: "evil",
      description: "",
      publishedAt: "",
      publishedBy: "",
      mnemeVersion: "1.0.0",
      contentHash: "",
      files: [{ name: "../../../etc/passwd", content: "pwned" }],
    };
    // Patch the hash to make it pass verify.
    const properHash = require("node:crypto").createHash("sha256").update(JSON.stringify(g.files)).digest("hex");
    g.contentHash = properHash;
    const r = installGenome(dest, g);
    expect(r.installed).toBe(0);
    expect(r.conflicts.some((c) => c.includes("unsafe path"))).toBe(true);
  });

  it("throws when genome contentHash doesn't verify", () => {
    const g: Genome = {
      schemaVersion: 1,
      id: "tampered",
      title: "tampered",
      description: "",
      publishedAt: "",
      publishedBy: "",
      mnemeVersion: "1.0.0",
      contentHash: "deadbeef",
      files: [{ name: "constitution.json", content: "{}" }],
    };
    expect(() => installGenome(dest, g)).toThrow(/contentHash mismatch|hash/);
  });

  it("records the install in .mneme/genomes/{id}.installed.json", () => {
    writeFileSync(join(src, ".mneme", "constitution.json"), "{}");
    const g = packGenome(src, "myrepo", "1.0.0");
    installGenome(dest, g);
    const records = listInstalledGenomes(dest);
    expect(records).toHaveLength(1);
    expect(records[0]!.id).toBe(g.id);
    expect(records[0]!.contentHash).toBe(g.contentHash);
  });
});
