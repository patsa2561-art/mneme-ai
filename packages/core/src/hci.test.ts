import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeHci, renderHciLine } from "./hci.js";

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "mneme-hci-"));
});
afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

function writeJson(path: string, body: unknown): void {
  const full = join(repo, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, JSON.stringify(body), "utf8");
}

describe("hci.computeHci", () => {
  it("returns sane defaults on a fresh repo (no .mneme/ files)", () => {
    const r = computeHci(repo);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.axes).toHaveLength(6);
    expect(r.band).toMatch(/^(Robust|Healthy|Wobbly|Sick|Critical)$/);
    expect(r.computedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("scores 100 for selfcheck axis when every verdict passes", () => {
    writeJson(".mneme/selfcheck/last.json", {
      verdicts: [
        { status: "pass" }, { status: "pass" }, { status: "pass" },
      ],
    });
    const r = computeHci(repo);
    const sc = r.axes.find((a) => a.name === "selfcheck")!;
    expect(sc.score).toBe(100);
  });

  it("scores below 50 for selfcheck when any verdict fails", () => {
    writeJson(".mneme/selfcheck/last.json", {
      verdicts: [{ status: "pass" }, { status: "fail" }],
    });
    const r = computeHci(repo);
    const sc = r.axes.find((a) => a.name === "selfcheck")!;
    expect(sc.score).toBeLessThan(60);
  });

  it("daemon axis = 100 when heartbeat is fresh (< 1 min)", () => {
    writeJson(".mneme/nucleus.heartbeat.json", { lastTick: new Date().toISOString(), tickCount: 100 });
    const r = computeHci(repo);
    const d = r.axes.find((a) => a.name === "daemon")!;
    expect(d.score).toBe(100);
  });

  it("daemon axis low when heartbeat is hours old", () => {
    writeJson(".mneme/nucleus.heartbeat.json", { lastTick: new Date(Date.now() - 3 * 3600_000).toISOString() });
    const r = computeHci(repo);
    const d = r.axes.find((a) => a.name === "daemon")!;
    expect(d.score).toBeLessThan(50);
  });

  it("inbox axis penalises CRITICAL unsent", () => {
    mkdirSync(join(repo, ".mneme"), { recursive: true });
    writeFileSync(join(repo, ".mneme/inbox.jsonl"),
      JSON.stringify({ id: "1", createdAt: new Date().toISOString(), priority: "critical", source: "manual", title: "URGENT", sent: false }) + "\n",
      "utf8");
    const r = computeHci(repo);
    const inbox = r.axes.find((a) => a.name === "inbox")!;
    expect(inbox.score).toBeLessThanOrEqual(40);
  });

  it("antivirus axis rewards certified vaccines", () => {
    writeJson(".mneme/antivirus/pharmacopoeia.json", {
      vaccines: [
        { efficacy: { f1: 0.9 } },
        { efficacy: { f1: 0.85 } },
        { efficacy: null },
      ],
    });
    const r = computeHci(repo);
    const av = r.axes.find((a) => a.name === "antivirus")!;
    expect(av.score).toBeGreaterThanOrEqual(50);
  });

  it("retrieval axis scales with trial count", () => {
    writeJson(".mneme/retrieval/leaderboard.json", { totalTrials: 25 });
    const r = computeHci(repo);
    const rt = r.axes.find((a) => a.name === "retrieval")!;
    expect(rt.score).toBeGreaterThanOrEqual(90);
  });

  it("composite stays bounded [0, 100]", () => {
    // Pathological: every file present + corrupt
    mkdirSync(join(repo, ".mneme/selfcheck"), { recursive: true });
    writeFileSync(join(repo, ".mneme/selfcheck/last.json"), "not json", "utf8");
    const r = computeHci(repo);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it("renderHciLine produces a one-line summary", () => {
    const r = computeHci(repo);
    const line = renderHciLine(r);
    expect(line).toContain("[HCI]");
    expect(line).toContain("/100");
    expect(line).toMatch(/selfcheck=\d+/);
  });

  it("axis weights sum to 1.0", () => {
    const r = computeHci(repo);
    const sum = r.axes.reduce((acc, a) => acc + a.weight, 0);
    expect(sum).toBeCloseTo(1.0, 3);
  });

  it("band reflects score range", () => {
    // Force a near-perfect setup -> Robust band
    writeJson(".mneme/selfcheck/last.json", { verdicts: Array(12).fill({ status: "pass" }) });
    writeJson(".mneme/nucleus.heartbeat.json", { lastTick: new Date().toISOString(), tickCount: 100 });
    writeJson(".mneme/antivirus/pharmacopoeia.json", { vaccines: [{ efficacy: { f1: 0.9 } }] });
    writeJson(".mneme/retrieval/leaderboard.json", { totalTrials: 50 });
    const r = computeHci(repo);
    expect(r.score).toBeGreaterThan(60);
    expect(["Wobbly", "Healthy", "Robust"]).toContain(r.band);
  });
});
