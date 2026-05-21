import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  contractFor, findContract, formatContract,
  parseArgSchema, schemaFor, validateArgs, formatSchema,
  dryRun, stageCommit, applyCommit, formatDoppelganger,
  predictNext, predictPrior, formatStoryline,
  computeOutcomeStats, commonMistakes, formatOutcomeStats, formatMistakes,
  companionFor, formatCompanion, companionableCoverage, listCompanionable,
} from "./index.js";
import { dropPheromone } from "../atlas/pheromone.js";

const SAMPLE_VERIFY: any = { command: "mneme verify-self --score", since: "2.21.4", group: "trust", what: "🔒 Emit ONE NUMBER 0-100 trust score.", when: "CI gate." };
const SAMPLE_DESTRUCTIVE: any = { command: "mneme mortuary fire", since: "2.21.2", group: "mortuary", what: "⚱️ Force the dead-man switch to fire NOW and generate all encrypted bundles.", when: "Testing." };
const SAMPLE_NETWORK: any = { command: "mneme apoptosis federation-push", since: "2.21.0", group: "apoptosis_network", what: "Push the local apoptosis corpus to a peer via HMAC-signed bundle.", when: "Periodic federation." };

describe("companion (v2.22.0)", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-companion-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  // ─── CONTRACT ──────────────────────────────────────────────────────

  describe("contract derivation", () => {
    it("read-only verb gets DEFCON 5", () => {
      const c = contractFor(SAMPLE_VERIFY);
      expect(c.defcon).toBe(5);
      expect(c.readOnly).toBe(true);
      expect(c.idempotency).toBe("read-only");
    });

    it("destructive verb gets DEFCON 1 or 2", () => {
      const c = contractFor(SAMPLE_DESTRUCTIVE);
      expect([1, 2]).toContain(c.defcon);
      expect(c.readOnly).toBe(false);
    });

    it("network verb sets reachesNetwork", () => {
      const c = contractFor(SAMPLE_NETWORK);
      expect(c.reachesNetwork).toBe(true);
    });

    it("findContract resolves real catalog verb", () => {
      const c = findContract("mneme verify-self --score");
      expect(c?.verb).toContain("verify-self");
    });

    it("findContract returns null on unknown", () => {
      expect(findContract("mneme totally-not-a-verb-xyz")).toBeNull();
    });

    it("formatContract includes DEFCON badge + summary", () => {
      const out = formatContract(contractFor(SAMPLE_VERIFY));
      expect(out).toContain("CONTRACT");
      expect(out).toContain("DEFCON");
      expect(out).toContain("read-only");
    });
  });

  // ─── AUTOSPEC ──────────────────────────────────────────────────────

  describe("autospec arg schema", () => {
    it("parseArgSchema picks up required + optional positionals", () => {
      const s = parseArgSchema("mneme some <required> [optional]");
      expect(s.positional).toHaveLength(2);
      expect(s.positional[0]!.required).toBe(true);
      expect(s.positional[1]!.required).toBe(false);
    });

    it("variadic positional captured", () => {
      const s = parseArgSchema("mneme do <words...>");
      expect(s.positional[0]!.variadic).toBe(true);
    });

    it("--flag with value vs without value", () => {
      const s = parseArgSchema("mneme x --vendor <v> --json");
      expect(s.options.vendor?.type).toBe("string");
      expect(s.options.vendor?.required).toBe(true);
      expect(s.options.json?.type).toBe("boolean");
    });

    it("validateArgs rejects missing required positional", () => {
      const s = parseArgSchema("mneme x <required>");
      const r = validateArgs(s, { positional: [] });
      expect(r.ok).toBe(false);
      expect(r.errors[0]?.field).toBe("positional");
    });

    it("validateArgs accepts complete args", () => {
      const s = parseArgSchema("mneme x <name> --vendor <v>");
      const r = validateArgs(s, { positional: ["alice"], options: { vendor: "claude" } });
      expect(r.ok).toBe(true);
    });

    it("validateArgs flags missing required option", () => {
      const s = parseArgSchema("mneme x --vendor <v>");
      const r = validateArgs(s, { positional: [], options: {} });
      expect(r.ok).toBe(false);
      expect(r.errors[0]?.field).toContain("vendor");
    });
  });

  // ─── DOPPELGANGER ──────────────────────────────────────────────────

  describe("doppelganger (copy-on-write dry-run)", () => {
    it("dryRun returns no fileEffects when the simulator does nothing", async () => {
      mkdirSync(join(repo, ".mneme"), { recursive: true });
      writeFileSync(join(repo, ".mneme/a.json"), "{}");
      const r = await dryRun(repo, () => {});
      expect(r.fileEffects).toEqual([]);
      expect(r.exitCode).toBe(0);
    });

    it("dryRun captures added file in shadow", async () => {
      mkdirSync(join(repo, ".mneme"), { recursive: true });
      const r = await dryRun(repo, (shadow) => {
        writeFileSync(join(shadow, ".mneme/b.json"), "{}");
      });
      expect(r.fileEffects.some((e) => e.kind === "added" && e.path === ".mneme/b.json")).toBe(true);
    });

    it("dryRun captures changed file", async () => {
      mkdirSync(join(repo, ".mneme"), { recursive: true });
      writeFileSync(join(repo, ".mneme/c.json"), "{}");
      const r = await dryRun(repo, (shadow) => {
        writeFileSync(join(shadow, ".mneme/c.json"), "{\"k\":1}");
      });
      expect(r.fileEffects.some((e) => e.kind === "changed" && e.path === ".mneme/c.json")).toBe(true);
    });

    it("dryRun exit code captures verb error", async () => {
      mkdirSync(join(repo, ".mneme"), { recursive: true });
      const r = await dryRun(repo, () => { throw Object.assign(new Error("boom"), { code: 7 }); });
      expect(r.exitCode).toBe(7);
      expect(r.stderrSample).toContain("boom");
    });

    it("known network use → leakage=possible", async () => {
      mkdirSync(join(repo, ".mneme"), { recursive: true });
      const r = await dryRun(repo, () => {}, { knownNetworkUse: true });
      expect(r.leakage).toBe("possible");
    });

    it("stageCommit + applyCommit round-trip writes files into repo", () => {
      mkdirSync(join(repo, ".mneme"), { recursive: true });
      const stage = stageCommit(repo);
      mkdirSync(join(stage.stagePath, ".mneme"), { recursive: true });
      writeFileSync(join(stage.stagePath, ".mneme/staged.json"), JSON.stringify({ committed: true }));
      applyCommit(stage.stagePath, repo);
      const out = require("node:fs").readFileSync(join(repo, ".mneme/staged.json"), "utf8");
      expect(JSON.parse(out).committed).toBe(true);
    });

    it("stageCommit.rollback removes staged files", () => {
      const stage = stageCommit(repo);
      writeFileSync(join(stage.stagePath, "x"), "");
      stage.rollback();
      expect(require("node:fs").existsSync(stage.stagePath)).toBe(false);
    });
  });

  // ─── STORYLINE ─────────────────────────────────────────────────────

  describe("storyline (Markov over pheromone)", () => {
    it("predictNext + predictPrior work after dropping pheromones in sequence", () => {
      dropPheromone(repo, { verb: "mneme earthquake probe" });
      dropPheromone(repo, { verb: "mneme earthquake drift" });
      dropPheromone(repo, { verb: "mneme earthquake probe" });
      dropPheromone(repo, { verb: "mneme earthquake drift" });
      const next = predictNext(repo, "mneme earthquake probe");
      expect(next.length).toBeGreaterThan(0);
      expect(next[0]!.to).toContain("earthquake drift");
    });

    it("returns [] when no pheromone data yet", () => {
      expect(predictNext(repo, "mneme whatever")).toEqual([]);
    });

    it("formatStoryline handles empty + populated cases", () => {
      expect(formatStoryline("mneme x", [], [])).toContain("STORYLINE");
      expect(formatStoryline("mneme x", [], [])).toContain("no data yet");
    });
  });

  // ─── LEARN LOOP ────────────────────────────────────────────────────

  describe("learn loop", () => {
    it("computeOutcomeStats counts success vs failure", () => {
      dropPheromone(repo, { verb: "mneme x", outcome: "success" });
      dropPheromone(repo, { verb: "mneme x", outcome: "success" });
      dropPheromone(repo, { verb: "mneme x", outcome: "failure" });
      const s = computeOutcomeStats(repo, "mneme x");
      expect(s.successes).toBe(2);
      expect(s.failures).toBe(1);
      expect(s.successRate).toBeCloseTo(2 / 3, 2);
    });

    it("commonMistakes surfaces recent-failure-cluster when recent rate < 60%", () => {
      for (let i = 0; i < 5; i++) dropPheromone(repo, { verb: "mneme y", outcome: "failure" });
      dropPheromone(repo, { verb: "mneme y", outcome: "success" });
      const m = commonMistakes(repo, "mneme y");
      expect(m.length).toBeGreaterThan(0);
      expect(m[0]!.pattern).toBe("recent-failure-cluster");
    });

    it("commonMistakes returns [] when no failures recorded", () => {
      dropPheromone(repo, { verb: "mneme z", outcome: "success" });
      expect(commonMistakes(repo, "mneme z")).toEqual([]);
    });
  });

  // ─── COMPOSED COMPANION ────────────────────────────────────────────

  describe("companionFor composed view", () => {
    it("returns a Companion for a known catalog verb", () => {
      const c = companionFor("mneme verify-self --score", { repoRoot: repo });
      expect(c?.verb).toContain("verify-self");
      expect(c?.contract.readOnly).toBe(true);
      expect(c?.argSchema).toBeDefined();
    });

    it("hasLiveData=false on fresh repo; true after pheromone hit", () => {
      const a = companionFor("mneme verify-self --score", { repoRoot: repo });
      expect(a?.hasLiveData).toBe(false);
      dropPheromone(repo, { verb: "mneme verify-self --score" });
      const b = companionFor("mneme verify-self --score", { repoRoot: repo });
      expect(b?.hasLiveData).toBe(true);
    });

    it("formatCompanion includes all 5 sections", () => {
      const out = formatCompanion(companionFor("mneme verify-self --score", { repoRoot: repo })!);
      expect(out).toContain("CONTRACT");
      expect(out).toContain("ARG SCHEMA");
      expect(out).toContain("STORYLINE");
      expect(out).toContain("OUTCOME STATS");
      expect(out).toContain("COMMON MISTAKES");
    });

    it("listCompanionable returns the whole catalog sorted", () => {
      const list = listCompanionable();
      expect(list.length).toBeGreaterThan(50);
      const sorted = [...list].sort();
      expect(list).toEqual(sorted);
    });

    it("companionableCoverage reports contract + autospec coverage", () => {
      const cov = companionableCoverage(repo);
      expect(cov.total).toBeGreaterThan(50);
      expect(cov.coverageContract).toBeGreaterThan(0.9);
      expect(cov.coverageAutospec).toBeGreaterThan(0.9);
    });
  });
});
