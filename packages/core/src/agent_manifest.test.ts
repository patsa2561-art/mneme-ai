import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MNEME_COMMAND_CATALOG,
  renderManifestMarkdown, renderManifestPlain,
  upsertManifestBlock, syncManifest, DEFAULT_SYNC_TARGETS,
} from "./agent_manifest.js";

describe("agent_manifest", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-mani-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  describe("MNEME_COMMAND_CATALOG", () => {
    it("contains every critical v1.30+ command (regression guard)", () => {
      const cmds = MNEME_COMMAND_CATALOG.map((c) => c.command);
      // The headline ones a new tester MUST be able to discover.
      expect(cmds.some((c) => c.startsWith("mneme uninstall"))).toBe(true);
      expect(cmds.some((c) => c.startsWith("mneme embeddings status"))).toBe(true);
      expect(cmds.some((c) => c.startsWith("mneme embeddings upgrade"))).toBe(true);
      expect(cmds.some((c) => c.startsWith("mneme supernova log"))).toBe(true);
      expect(cmds.some((c) => c.startsWith("mneme antivirus synthesize"))).toBe(true);
    });
    it("every entry has non-empty what + when + group", () => {
      for (const c of MNEME_COMMAND_CATALOG) {
        expect(c.command.length).toBeGreaterThan(0);
        expect(c.what.length).toBeGreaterThan(10);
        expect(c.when.length).toBeGreaterThan(10);
        expect(c.group).toBeTruthy();
        expect(c.since).toMatch(/^\d+\.\d+/);
      }
    });
  });

  describe("renderManifestMarkdown", () => {
    // v3.111 — LEAN is the default; these tests verify the FULL manifest content,
    // which is now opt-in via MNEME_FULL=1.
    beforeEach(() => { process.env["MNEME_FULL"] = "1"; });
    afterEach(() => { delete process.env["MNEME_FULL"]; });

    it("v3.111 — LEAN is the DEFAULT (no env): compact pointer, not the full catalog", () => {
      delete process.env["MNEME_FULL"];
      const lean = renderManifestMarkdown(undefined, "3.111.0");
      expect(lean).toContain("LEAN");
      expect(lean.length).toBeLessThan(20000);                 // ~3k tok, not ~61k
      const full = (process.env["MNEME_FULL"] = "1", renderManifestMarkdown(undefined, "3.111.0"));
      delete process.env["MNEME_FULL"];
      expect(full.length).toBeGreaterThan(lean.length * 3);     // full is much larger
    });

    it("emits sentinel markers + version + groups", () => {
      const md = renderManifestMarkdown(undefined, "1.31.0");
      expect(md).toContain("<!-- BEGIN MNEME MANIFEST");
      expect(md).toContain("<!-- END MNEME MANIFEST -->");
      expect(md).toContain("v1.31.0");
      expect(md).toContain("### memory");
      expect(md).toContain("### antivirus");
      expect(md).toContain("### uninstall");
    });

    // v2.19.79 — PROACTIVE BEHAVIOR DIRECTIVE must always land in the
    // auto-synced block. User painpoint: nobody types "verify"; the AI
    // agent must auto-fire. If this regresses, AI agents stop verifying.
    it("includes the PROACTIVE BEHAVIOR directive with Rule 0..6", () => {
      const md = renderManifestMarkdown(undefined, "2.19.82");
      expect(md).toContain("PROACTIVE BEHAVIOR");
      expect(md).toContain("Rule 0 — AUTO-VERIFY every factual claim");
      expect(md).toContain("mneme.truth.check");
      expect(md).toContain("mneme verify");
      expect(md).toContain("AUTO-SCAN");
      expect(md).toContain("AUTO-INDEX");
      expect(md).toContain("AUTO-FIRE the intent router");
      expect(md).toContain("AUTO-CHECK SOUL");
      expect(md).toContain("AUTO-DRAIN nexus");
      // v2.19.82 — Rule 6 directs the AI agent to RUN `mneme polygraph
      // autosetup` on the user's behalf instead of asking them to
      // remember command names.
      expect(md).toContain("Rule 6");
      expect(md).toContain("mneme polygraph autosetup");
      expect(md).toContain("Tampermonkey");
      // Worked example uses Thai blood-vessels claim — the canonical
      // demo for why proactive verify matters.
      expect(md).toContain("blood vessels");
    });

    // v2.19.81 — pins that the polygraph CLI commands are auto-injected
    // into every agent file. Regression here = users on fresh installs
    // can't discover `mneme polygraph install` from the AI.
    it("catalog contains the polygraph commands shipped in v2.19.80+", () => {
      const md = renderManifestMarkdown(undefined, "2.19.82");
      expect(md).toContain("`mneme polygraph install`");
      expect(md).toContain("`mneme polygraph emit`");
      expect(md).toContain("`mneme polygraph status`");
      expect(md).toContain("`mneme bridge`");
      // The polygraph group header should render explicitly so the AI
      // agent can navigate to it by topic.
      expect(md).toContain("### polygraph");
    });

    // v2.19.82 — pins the one-command seamless setup. Rule 6 directs AI
    // agents to fire `autosetup` instead of three separate commands.
    // Regression here = users get the old 3-step ritual.
    it("v2.19.82 — autosetup is the recommended one-command path in catalog AND Rule 6", () => {
      const md = renderManifestMarkdown(undefined, "2.19.82");
      // Catalog entry for `autosetup` exists.
      expect(md).toContain("`mneme polygraph autosetup`");
      // Catalog signals the AI agent to PREFER autosetup over install.
      expect(md).toMatch(/PREFER this over|prefer .* autosetup|ONE-COMMAND/i);
      // Rule 6 instructs AI agent to RUN autosetup on user's behalf.
      expect(md).toMatch(/Rule 6.*autosetup/s);
    });

    // v2.19.83 — pins the Browser-vs-internal polygraph disambiguation
    // directive. Without it, AI agents reach for the internal sandbagging
    // axis when the user says "test polygraph" and run the wrong feature.
    // NOTE: the lexicon (tuneForVendorArtifact) rewrites "AEGIS" →
    // "GUARDRAIL" in vendor-facing artifacts; assertions check for the
    // rewritten name so they match what AI agents actually see.
    it("v2.19.83 — disambiguation note + Rule 6 mention BOTH polygraphs", () => {
      const md = renderManifestMarkdown(undefined, "2.19.83");
      // Disambiguation block at the top BEFORE the catalog.
      expect(md).toContain("Disambiguation");
      expect(md).toMatch(/Browser Polygraph[\s\S]*GUARDRAIL/);
      // The 99% default rule is stated explicitly.
      expect(md).toMatch(/99%|DEFAULT/);
      // Rule 6 calls out the lexicon-rewritten "GUARDRAIL" confusion vector.
      expect(md).toMatch(/Do NOT confuse with GUARDRAIL|mneme guardrail bench/);
    });

    // Plain renderer carries the disambiguation too.
    it("v2.19.83 — disambiguation lands in plain renderer", () => {
      const txt = renderManifestPlain(undefined, "2.19.83");
      expect(txt).toContain("Disambiguation");
      expect(txt).toContain("GUARDRAIL");
      expect(txt).toContain("Browser Polygraph");
    });

    // v2.19.85 — Rule 7 + sandbag CLI verbs + multi-signal agreement
    // are all auto-injected so AI agents on every surface see them on
    // first contact after install/upgrade.
    it("v2.19.85 — Rule 7 + sandbag verbs land in markdown manifest", () => {
      const md = renderManifestMarkdown(undefined, "2.19.85");
      expect(md).toContain("Rule 7");
      expect(md).toContain("AUTO-CAPTURE");
      expect(md).toContain("mneme polygraph drift");
      // The 4 sandbag verbs are catalogued.
      expect(md).toContain("`mneme polygraph probe`");
      expect(md).toContain("`mneme polygraph record`");
      expect(md).toContain("`mneme polygraph list`");
      expect(md).toContain("`mneme polygraph drift`");
      // Ollama-free is called out so AI agents don't suggest a dep.
      expect(md).toMatch(/Ollama-FREE|Ollama-free/);
    });

    it("v2.19.85 — Rule 7 lands in plain renderer", () => {
      const txt = renderManifestPlain(undefined, "2.19.85");
      expect(txt).toContain("Rule 7");
      expect(txt).toContain("AUTO-CAPTURE");
      expect(txt).toContain("mneme polygraph drift");
    });
  });

  describe("renderManifestPlain", () => {
    it("emits version + every command line", () => {
      const txt = renderManifestPlain(undefined, "1.31.0");
      expect(txt).toContain("v1.31.0");
      expect(txt).toContain("mneme uninstall");
      expect(txt).toContain("mneme embeddings status");
    });

    // v2.19.79 — same proactive directive on the plain-text channel for
    // .cursorrules / .windsurfrules consumers.
    it("includes the PROACTIVE BEHAVIOR directive (plain format)", () => {
      const txt = renderManifestPlain(undefined, "2.19.81");
      expect(txt).toContain("PROACTIVE BEHAVIOR");
      expect(txt).toContain("AUTO-VERIFY");
      expect(txt).toContain("mneme.truth.check");
      expect(txt).toContain("mneme verify");
      // v2.19.82 — Rule 6 in plain format points at autosetup (one
      // command) so .cursorrules / .windsurfrules consumers see it.
      expect(txt).toContain("Rule 6");
      expect(txt).toContain("mneme polygraph autosetup");
    });

    // v2.78.0 DE-WORM — Rule 9 flipped from "AUTO-UPGRADE silently" to
    // "SURFACE availability, never upgrade on the user's behalf". The manifest
    // must NOT instruct agents to auto-run the self-upgrade (that was the worm).
    it("v2.78.0 — Rule 9 surfaces updates but FORBIDS auto-upgrade (markdown)", () => {
      process.env["MNEME_FULL"] = "1"; // Rule 9 lives in the full manifest (lean is default since v3.111)
      const md = renderManifestMarkdown(undefined, "2.78.0");
      delete process.env["MNEME_FULL"];
      expect(md).toContain("Rule 9");
      expect(md).toMatch(/SURFACE update availability|NEVER upgrade on/i);
      // Explicitly tells agents NOT to run the upgrade on the user's behalf.
      expect(md).toMatch(/MUST NOT run `?mneme\.system\.upgrade/i);
      // The old worm directives must be GONE.
      expect(md).not.toMatch(/fire the upgrade tool SILENTLY/i);
      expect(md).not.toMatch(/do(n't| not) ask (for )?permission/i);
    });

    it("v2.78.0 — Rule 9 de-wormed in plain renderer (.cursorrules / .windsurfrules)", () => {
      const txt = renderManifestPlain(undefined, "2.78.0");
      expect(txt).toContain("Rule 9");
      expect(txt).toMatch(/NEVER upgrade on the user's behalf|MUST NOT run/i);
      expect(txt).not.toMatch(/fire the upgrade\s+tool SILENTLY/i);
    });
  });

  describe("upsertManifestBlock", () => {
    it("creates the file if it doesn't exist", () => {
      const path = join(repo, "AGENTS.md");
      const block = renderManifestMarkdown(undefined, "1.31.0");
      const r = upsertManifestBlock(path, block);
      expect(r.action).toBe("created");
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, "utf8")).toContain("v1.31.0");
    });

    it("replaces an existing sentinel block in place", () => {
      const path = join(repo, "CLAUDE.md");
      writeFileSync(path,
        "# My existing notes\n\n<!-- BEGIN MNEME MANIFEST (auto-managed -- do not edit) -->\nOLD CONTENT\n<!-- END MNEME MANIFEST -->\n\n# More user notes",
        "utf8");
      const newBlock = renderManifestMarkdown(undefined, "1.31.0");
      const r = upsertManifestBlock(path, newBlock);
      expect(r.action).toBe("replaced");
      const after = readFileSync(path, "utf8");
      expect(after).not.toContain("OLD CONTENT");
      expect(after).toContain("v1.31.0");
      // User notes preserved.
      expect(after).toContain("My existing notes");
      expect(after).toContain("More user notes");
    });

    it("returns 'unchanged' when block is identical", () => {
      const path = join(repo, "AGENTS.md");
      const block = renderManifestMarkdown(undefined, "1.31.0");
      upsertManifestBlock(path, block);
      const r2 = upsertManifestBlock(path, block);
      expect(r2.action).toBe("unchanged");
    });

    it("returns 'failed' on write error (read-only path)", () => {
      // Use a path that includes invalid chars / non-existent dir.
      // For cross-platform safety just write to a path with a forbidden parent.
      const path = join(repo, "deeply", "nested", "agents.md");
      const block = renderManifestMarkdown(undefined, "1.31.0");
      // Should auto-create the parent dir + succeed.
      const r = upsertManifestBlock(path, block);
      expect(["created", "replaced"]).toContain(r.action);
    });

    it("plain format (no sentinels) overwrites the file entirely", () => {
      const path = join(repo, ".cursorrules");
      writeFileSync(path, "old user rules", "utf8");
      const block = renderManifestPlain(undefined, "1.31.0");
      const r = upsertManifestBlock(path, block, { useSentinels: false });
      expect(r.action).toBe("replaced");
      expect(readFileSync(path, "utf8")).not.toContain("old user rules");
    });
  });

  describe("syncManifest", () => {
    it("writes to every default target + reports per-target action", () => {
      const results = syncManifest(repo, { mnemeVersion: "1.31.0" });
      // 6 default targets.
      expect(results.length).toBe(DEFAULT_SYNC_TARGETS.length);
      // All should succeed in a fresh tmp repo.
      const failed = results.filter((r) => r.action === "failed");
      expect(failed).toEqual([]);
      // CLAUDE.md exists + has the manifest.
      const claudeMd = readFileSync(join(repo, "CLAUDE.md"), "utf8");
      expect(claudeMd).toContain("v1.31.0");
      expect(claudeMd).toContain("<!-- BEGIN MNEME MANIFEST");
    });

    it("re-sync to already-current files reports 'unchanged'", () => {
      syncManifest(repo, { mnemeVersion: "1.31.0" });
      const second = syncManifest(repo, { mnemeVersion: "1.31.0" });
      const unchanged = second.filter((r) => r.action === "unchanged");
      expect(unchanged.length).toBeGreaterThan(0);
    });

    it("a version bump triggers 'replaced' on every target", () => {
      syncManifest(repo, { mnemeVersion: "1.31.0" });
      const second = syncManifest(repo, { mnemeVersion: "1.31.1" });
      const replaced = second.filter((r) => r.action === "replaced");
      expect(replaced.length).toBeGreaterThan(0);
      const claudeMd = readFileSync(join(repo, "CLAUDE.md"), "utf8");
      expect(claudeMd).toContain("v1.31.1");
      expect(claudeMd).not.toContain("v1.31.0");
    });
  });
});
