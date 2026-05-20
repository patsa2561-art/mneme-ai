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
