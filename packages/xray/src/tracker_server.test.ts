import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TrackerHub, trackId, hubGauntlet, verifyWebhookSig, type SseSink, type BuildFn, type RefFn } from "./tracker_server.js";
import type { XRayReport } from "./types.js";

function rep(grade: string, secrets: number, commit: string): XRayReport {
  return {
    v: 1, subject: { kind: "git-url", ref: "x", repoName: "x", commitHash: commit }, generatedAt: "",
    summary: { headline: "", grade: grade as XRayReport["summary"]["grade"], signalsRun: 8, bullets: [] },
    deps: { total: 0, byBand: { thriving: 0, healthy: 0, watch: 0, moribund: 0, dead: 0 }, atRisk: [], licenses: { permissive: 0, "weak-copyleft": 0, "strong-copyleft": 0, unknown: 0 }, licenseFlags: [], partial: false, note: "" },
    secrets: { filesScanned: 0, totalFindings: secrets, excludedTestHits: 0, byKind: {}, hits: [], worstVerdict: "ALLOW", note: "" },
    busFactor: { authors: 1, singleOwnerFilePct: 0, fragileFiles: [], topContributorShare: 0, busFactor: 1, note: "" },
    age: { bornAt: "", lastCommitAt: "", lifespan: "", lifespanDays: 0, totalCommits: 0, totalAuthors: 0, dormant: false, vitality: "active", note: "" },
    complexity: { filesAnalysed: 0, totalSymbols: 0, hotspots: [], maxDepth: 0, note: "" },
    hotspots: { windowDays: 0, filesConsidered: 0, hotspots: [], trend: [], note: "" },
    coupling: { windowDays: 0, pairs: [], note: "" },
    security: { commandsScanned: 0, writeCount: 0, destructive: [], injectionFindings: 0, injectionWhere: [], note: "" },
    fingerprint: `fp-${grade}-${secrets}-${commit}`,
  };
}

describe("TrackerHub — autonomous real-time monitor", () => {
  it("hubGauntlet scores 100 (create · subscribe · no-change · drift-broadcast · time-machine · stable-id · poll-all)", async () => {
    const g = await hubGauntlet();
    expect(g.score).toBe(100);
    expect(g.checks.every((c) => c.pass)).toBe(true);
  });

  it("a subscribed browser receives a live SSE 'update' when the repo changes (no re-click)", async () => {
    let sha = "c1", grade = "A", secrets = 0;
    const refOf: RefFn = () => sha;
    const build: BuildFn = async () => { const report = rep(grade, secrets, sha); return { report, signed: { report, receipt: { ok: true } } }; };
    const hub = new TrackerHub({ build, refOf, now: () => 1 });
    const { id } = await hub.createTrack("https://github.com/o/r", "main");

    const frames: string[] = [];
    const sink: SseSink = { write: (c) => frames.push(c), end: () => {}, on: () => {} };
    hub.subscribe(id, sink);
    expect(frames.filter((f) => f.includes("event: update")).length).toBe(0);

    // simulate a push: SHA moves + a secret is introduced
    sha = "c2"; grade = "C"; secrets = 2;
    const r = await hub.tick(id);
    expect(r?.changed).toBe(true);
    const update = frames.find((f) => f.includes("event: update"));
    expect(update).toBeTruthy();
    const payload = JSON.parse(update!.split("data: ")[1].trim());
    expect(payload.delta.drift).toBe("degraded");
    expect(payload.delta.newSecretLeaks).toBe(2);
    expect(payload.signed.report.summary.grade).toBe("C");
    hub.stop();
  });

  it("a webhook-style forced tick and a poll converge to the same change result", async () => {
    let sha = "a1";
    const hub = new TrackerHub({ refOf: () => sha, build: async () => { const report = rep("B", 0, sha); return { report, signed: { report, receipt: {} } }; }, now: () => 1 });
    const { id } = await hub.createTrack("https://github.com/o/r");
    sha = "a2";
    const viaWebhook = await hub.tick(id);      // webhook path
    expect(viaWebhook?.changed).toBe(true);
    const viaPoll = await hub.pollAll();         // poll path, now no further change
    expect(viaPoll).toBe(0);
    hub.stop();
  });

  it("trackId is stable + branch-distinct", () => {
    expect(trackId("https://github.com/o/r", "main")).toBe(trackId("https://github.com/o/r", "main"));
    expect(trackId("https://github.com/o/r", "main")).not.toBe(trackId("https://github.com/o/r", "dev"));
  });

  it("DURABLE: tracks survive a restart (file-backed store)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xray-store-"));
    const store = join(dir, "tracks.json");
    try {
      const build: BuildFn = async () => { const report = rep("B", 0, "c1"); return { report, signed: { report, receipt: {} } }; };
      const hub1 = new TrackerHub({ build, refOf: () => "c1", now: () => 1, storePath: store });
      const { id } = await hub1.createTrack("https://github.com/o/r", "main");
      hub1.stop();
      // a brand-new hub (simulating a process restart) reloads the track from disk
      const hub2 = new TrackerHub({ build, refOf: () => "c1", now: () => 2, storePath: store });
      const rec = hub2.tracks.get(id);
      expect(rec).toBeTruthy();
      expect(rec!.gitUrl).toBe("https://github.com/o/r");
      expect(rec!.branch).toBe("main");
      expect(rec!.lastSha).toBe("c1");
      expect(rec!.subscribers.size).toBe(0);     // live-only, never persisted
      hub2.stop();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("WEBHOOK HMAC: a valid GitHub sha256 signature passes, a forged one is rejected, open mode allows", () => {
    const secret = "s3cr3t";
    const body = JSON.stringify({ ref: "refs/heads/main" });
    const goodSig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyWebhookSig(secret, body, goodSig)).toBe(true);
    expect(verifyWebhookSig(secret, body, "sha256=deadbeef")).toBe(false);
    expect(verifyWebhookSig(secret, body, undefined)).toBe(false);
    expect(verifyWebhookSig(undefined, body, undefined)).toBe(true); // no secret configured → open
  });
});
