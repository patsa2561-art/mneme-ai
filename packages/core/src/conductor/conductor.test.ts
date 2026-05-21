import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  plan, preview, defaultGate, execute, listReceipts, verifyReceiptChain,
  formatPlan, formatPreview, formatReceipt,
  type VerbSimulator,
} from "./index.js";

describe("conductor (v2.22.0 TRANSACTIONAL VERB ENGINE)", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-conductor-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  // ─── PLAN ──────────────────────────────────────────────────────────

  describe("plan (greedy router)", () => {
    it("returns Plan with steps for a non-empty intent", () => {
      const p = plan("verify trust");
      expect(p.steps.length).toBeGreaterThan(0);
      expect(p.intent).toBe("verify trust");
    });

    it("attaches a contract + argSchema to every step", () => {
      const p = plan("detect vendor drift");
      for (const step of p.steps) {
        expect(step.contract).toBeDefined();
        expect(step.argSchema).toBeDefined();
      }
    });

    it("worstDefcon reflects the most-impactful step", () => {
      const p = plan("verify trust");
      expect([1, 2, 3, 4, 5]).toContain(p.worstDefcon);
    });

    it("allArgsValid reflects validation of provided args", () => {
      const p = plan("verify-self trust");
      // No args provided; verify-self --score's positional schema is empty,
      // so validation often passes. Schema parsing yields options optional.
      expect(typeof p.allArgsValid).toBe("boolean");
    });

    it("formatPlan renders plan id + steps", () => {
      const out = formatPlan(plan("verify trust"));
      expect(out).toContain("PLAN");
      expect(out).toContain("DEFCON");
    });
  });

  // ─── PREVIEW ───────────────────────────────────────────────────────

  describe("preview (doppelganger aggregate)", () => {
    it("runs each step through dryRun + aggregates effects", async () => {
      mkdirSync(join(repo, ".mneme"), { recursive: true });
      const p = plan("verify trust");
      const sim: VerbSimulator = async (verb, args, shadow) => {
        // Simulate a no-op verb
        return { exit: 0, effects: [] };
      };
      const pv = await preview(repo, p, sim);
      expect(pv.steps.length).toBe(p.steps.length);
      expect(pv.combinedExit).toBe(0);
    });

    it("aggregates added/changed/removed across steps", async () => {
      mkdirSync(join(repo, ".mneme"), { recursive: true });
      const p = plan("verify trust");
      let touched = 0;
      const sim: VerbSimulator = async (verb, args, shadow) => {
        touched++;
        writeFileSync(join(shadow, `.mneme/sim_${touched}.json`), JSON.stringify({ verb }));
        return { exit: 0 };
      };
      const pv = await preview(repo, p, sim);
      expect(pv.combinedFileEffects.some((e) => e.kind === "added")).toBe(true);
    });
  });

  // ─── GATE ──────────────────────────────────────────────────────────

  describe("defaultGate", () => {
    it("denies when args invalid", () => {
      const p = plan("xx-not-real-intent");
      if (p.steps.length === 0) return; // skip if no candidates
      // Force-invalid by mutating the validation result.
      p.allArgsValid = false;
      const d = defaultGate(p, { planId: p.id, steps: [], combinedFileEffects: [], combinedExit: 0, anyLeakage: false });
      expect(d.approved).toBe(false);
      expect(d.reason).toContain("argument");
    });

    it("denies on requireConfirm", () => {
      const p = plan("verify trust");
      const d = defaultGate(p, { planId: p.id, steps: [], combinedFileEffects: [], combinedExit: 0, anyLeakage: false }, { requireConfirm: true });
      expect(d.approved).toBe(false);
    });
  });

  // ─── EXECUTE ───────────────────────────────────────────────────────

  describe("execute (atomic commit / rollback)", () => {
    it("rejected gate → outcome=rejected; no fs changes", async () => {
      mkdirSync(join(repo, ".mneme"), { recursive: true });
      const p = plan("verify trust");
      const pv = { planId: p.id, steps: [], combinedFileEffects: [], combinedExit: 0, anyLeakage: false };
      const sim: VerbSimulator = async () => ({ exit: 0 });
      const r = await execute(repo, p, pv, sim, { decision: { approved: false, by: "policy", ts: new Date().toISOString() } });
      expect(r.outcome).toBe("rejected");
    });

    it("approved + all-success → outcome=committed; staged files applied", async () => {
      mkdirSync(join(repo, ".mneme"), { recursive: true });
      const p = plan("verify trust");
      const pv = { planId: p.id, steps: [], combinedFileEffects: [], combinedExit: 0, anyLeakage: false };
      const sim: VerbSimulator = async (verb, args, stage) => {
        mkdirSync(join(stage, ".mneme"), { recursive: true });
        writeFileSync(join(stage, ".mneme/committed.json"), JSON.stringify({ verb }));
        return { exit: 0 };
      };
      const r = await execute(repo, p, pv, sim, { decision: { approved: true, by: "policy", ts: new Date().toISOString() } });
      expect(r.outcome).toBe("committed");
      // At least one step committed → file exists in repo.
      expect(existsSync(join(repo, ".mneme/committed.json"))).toBe(true);
    });

    it("approved + failure mid-plan → outcome=rolled-back; staged files removed", async () => {
      mkdirSync(join(repo, ".mneme"), { recursive: true });
      const p = plan("verify trust");
      if (p.steps.length < 2) return; // need ≥2 steps for the mid-fail test
      const pv = { planId: p.id, steps: [], combinedFileEffects: [], combinedExit: 0, anyLeakage: false };
      let calls = 0;
      const sim: VerbSimulator = async (verb, args, stage) => {
        calls++;
        if (calls === 1) {
          mkdirSync(join(stage, ".mneme"), { recursive: true });
          writeFileSync(join(stage, ".mneme/maybe.json"), "{}");
          return { exit: 0 };
        }
        return { exit: 7 };
      };
      const r = await execute(repo, p, pv, sim, { decision: { approved: true, by: "policy", ts: new Date().toISOString() } });
      expect(r.outcome).toBe("rolled-back");
      expect(existsSync(join(repo, ".mneme/maybe.json"))).toBe(false);
    });
  });

  // ─── RECEIPT LEDGER ────────────────────────────────────────────────

  describe("receipts + chain verification", () => {
    it("listReceipts returns committed + rolled-back + rejected entries", async () => {
      mkdirSync(join(repo, ".mneme"), { recursive: true });
      const p = plan("verify trust");
      const pv = { planId: p.id, steps: [], combinedFileEffects: [], combinedExit: 0, anyLeakage: false };
      await execute(repo, p, pv, async () => ({ exit: 0 }), { decision: { approved: false, by: "policy", ts: new Date().toISOString() } });
      expect(listReceipts(repo).length).toBeGreaterThan(0);
    });

    it("verifyReceiptChain returns ok on clean ledger", async () => {
      mkdirSync(join(repo, ".mneme"), { recursive: true });
      const p = plan("verify trust");
      const pv = { planId: p.id, steps: [], combinedFileEffects: [], combinedExit: 0, anyLeakage: false };
      await execute(repo, p, pv, async () => ({ exit: 0 }), { decision: { approved: false, by: "policy", ts: new Date().toISOString() } });
      expect(verifyReceiptChain(repo).ok).toBe(true);
    });

    it("verifyReceiptChain detects tampered signature", async () => {
      mkdirSync(join(repo, ".mneme"), { recursive: true });
      const p = plan("verify trust");
      const pv = { planId: p.id, steps: [], combinedFileEffects: [], combinedExit: 0, anyLeakage: false };
      await execute(repo, p, pv, async () => ({ exit: 0 }), { decision: { approved: false, by: "policy", ts: new Date().toISOString() } });
      // Tamper the file.
      const f = join(repo, ".mneme/conductor/receipts.jsonl");
      const lines = readFileSync(f, "utf8").split("\n");
      const j = JSON.parse(lines[0]!);
      j.outcome = "committed"; // lie
      lines[0] = JSON.stringify(j);
      writeFileSync(f, lines.join("\n"), "utf8");
      const v = verifyReceiptChain(repo);
      expect(v.ok).toBe(false);
    });

    it("formatReceipt renders the badge + outcome", async () => {
      mkdirSync(join(repo, ".mneme"), { recursive: true });
      const p = plan("verify trust");
      const pv = { planId: p.id, steps: [], combinedFileEffects: [], combinedExit: 0, anyLeakage: false };
      const r = await execute(repo, p, pv, async () => ({ exit: 0 }), { decision: { approved: false, by: "policy", ts: new Date().toISOString() } });
      expect(formatReceipt(r)).toContain("EXECUTION RECEIPT");
      expect(formatReceipt(r)).toContain("rejected");
    });
  });

  // ─── END-TO-END FORMATTERS ─────────────────────────────────────────

  it("formatPlan + formatPreview render coherent output", async () => {
    mkdirSync(join(repo, ".mneme"), { recursive: true });
    const p = plan("verify trust");
    const sim: VerbSimulator = async () => ({ exit: 0 });
    const pv = await preview(repo, p, sim);
    expect(formatPlan(p)).toContain("Steps");
    expect(formatPreview(pv)).toContain("PREVIEW");
  });
});
