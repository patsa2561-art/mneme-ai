import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordEvent, listEvents, findEvent, traceCausalChain, verifyChain, replayFrom, formatChain } from "./index.js";

describe("mission recorder (v2.22.2)", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-mr-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  describe("recordEvent + chain integrity", () => {
    it("first event has prev=genesis and lamport=1", () => {
      const e = recordEvent(repo, { kind: "test" });
      expect(e.prev).toBe("genesis");
      expect(e.lamport).toBe(1);
    });

    it("subsequent events chain by prev sig + advance lamport", () => {
      const e1 = recordEvent(repo, { kind: "a" });
      const e2 = recordEvent(repo, { kind: "b" });
      expect(e2.prev).toBe(e1.sig);
      expect(e2.lamport).toBeGreaterThan(e1.lamport);
    });

    it("verifyChain returns ok on untouched ledger", () => {
      recordEvent(repo, { kind: "a" });
      recordEvent(repo, { kind: "b" });
      recordEvent(repo, { kind: "c" });
      expect(verifyChain(repo).ok).toBe(true);
    });

    it("verifyChain detects tamper at correct index", () => {
      recordEvent(repo, { kind: "a" });
      recordEvent(repo, { kind: "b" });
      recordEvent(repo, { kind: "c" });
      const p = join(repo, ".mneme/mission_recorder/events.jsonl");
      const lines = readFileSync(p, "utf8").split("\n");
      const j = JSON.parse(lines[1]!);
      j.kind = "TAMPERED";
      lines[1] = JSON.stringify(j);
      writeFileSync(p, lines.join("\n"), "utf8");
      const v = verifyChain(repo);
      expect(v.ok).toBe(false);
      expect(v.brokenAt).toBe(1);
    });
  });

  describe("causal DAG", () => {
    it("causedBy + traceCausalChain walks forward through DAG", () => {
      const root = recordEvent(repo, { kind: "root" });
      const a = recordEvent(repo, { kind: "a", causedBy: [root.id] });
      const b = recordEvent(repo, { kind: "b", causedBy: [a.id] });
      const c = recordEvent(repo, { kind: "c", causedBy: [a.id] });
      const chain = traceCausalChain(repo, root.id);
      const ids = chain.map((e) => e.id);
      expect(ids).toContain(root.id);
      expect(ids).toContain(a.id);
      expect(ids).toContain(b.id);
      expect(ids).toContain(c.id);
    });

    it("traceCausalChain doesn't double-visit on diamond-shape DAG", () => {
      const root = recordEvent(repo, { kind: "root" });
      const a = recordEvent(repo, { kind: "a", causedBy: [root.id] });
      const b = recordEvent(repo, { kind: "b", causedBy: [root.id] });
      const join_ = recordEvent(repo, { kind: "join", causedBy: [a.id, b.id] });
      const chain = traceCausalChain(repo, root.id);
      // join should appear once even though it has two parents.
      const joins = chain.filter((e) => e.id === join_.id);
      expect(joins.length).toBe(1);
    });
  });

  describe("findEvent + formatters", () => {
    it("findEvent returns the event by id", () => {
      const e = recordEvent(repo, { kind: "a" });
      expect(findEvent(repo, e.id)?.kind).toBe("a");
      expect(findEvent(repo, "nope")).toBeNull();
    });

    it("listEvents returns all + formatChain renders Lamport + verb + causes", () => {
      const a = recordEvent(repo, { kind: "a", verb: "verify-self" });
      const b = recordEvent(repo, { kind: "b", verb: "earthquake", causedBy: [a.id] });
      const out = formatChain(listEvents(repo));
      expect(out).toContain("MISSION RECORDER");
      expect(out).toContain("verify-self");
      expect(out).toContain("earthquake");
      void b;
    });
  });

  describe("replay", () => {
    it("replayFrom invokes executor for each event in chain", async () => {
      const root = recordEvent(repo, { kind: "root" });
      const a = recordEvent(repo, { kind: "a", causedBy: [root.id] });
      const b = recordEvent(repo, { kind: "b", causedBy: [a.id] });
      let seen = 0;
      const out = await replayFrom(repo, root.id, async () => { seen++; return { ok: true }; });
      expect(out.length).toBe(3);
      expect(seen).toBe(3);
      void b;
    });

    it("replayFrom stops on first executor failure", async () => {
      const root = recordEvent(repo, { kind: "root" });
      const a = recordEvent(repo, { kind: "a", causedBy: [root.id] });
      const b = recordEvent(repo, { kind: "b", causedBy: [a.id] });
      const out = await replayFrom(repo, root.id, async (ev) => ev.kind === "a" ? { ok: false, detail: "boom" } : { ok: true });
      expect(out[out.length - 1]?.ok).toBe(false);
      // Should not have visited the third event.
      expect(out.length).toBeLessThanOrEqual(2);
      void b;
    });
  });
});
