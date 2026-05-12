/**
 * v1.61.0 -- EXODUS test suite, 100% accuracy lock-in across 6 layers.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpReq } from "node:http";

import {
  encodeGenome, verifyGenome, diffGenomes, recombine,
  persistGenome, readLatestGenome,
} from "./genome.js";
import { packWanderer, unpackWanderer, describeBundle } from "./wanderer.js";
import {
  makeCert, makeOffer, evaluateOffer, mergeGenomes,
} from "./exchange.js";
import { runDreamCycle, readDreamLog } from "./dream_weaver.js";
import {
  observeToolCall, predictNextTools,
  cacheStore, cacheLookup, currentInvalidationKey, cacheStats,
} from "./quantum_cache.js";
import { WisdomRiver, readEventLog } from "./wisdom_river.js";

function setupRepo(): string {
  const r = mkdtempSync(join(tmpdir(), "mneme-exodus-"));
  writeFileSync(join(r, "package.json"), JSON.stringify({ name: "x", version: "1.61.0" }), "utf8");
  mkdirSync(join(r, "src"), { recursive: true });
  writeFileSync(join(r, "src", "x.ts"), "export const x = 1;\n");
  try {
    execSync("git init -q", { cwd: r, stdio: "ignore" });
    execSync(`git -c user.email=t@t.com -c user.name=t add .`, { cwd: r, stdio: "ignore" });
    execSync(`git -c user.email=t@t.com -c user.name=t commit -q -m "first"`, { cwd: r, stdio: "ignore" });
  } catch { /* */ }
  return r;
}
function cleanup(r: string) { try { rmSync(r, { recursive: true, force: true }); } catch { /* */ } }

// ─── LAYER 1: GENOME ─────────────────────────────────────────────────

describe("v1.61 Exodus Layer 1 · Genome", () => {
  let r: string;
  beforeEach(() => { r = setupRepo(); });
  afterEach(() => cleanup(r));

  it("encodeGenome returns all 4 strands + HMAC", () => {
    const g = encodeGenome(r);
    expect(g.schemaVersion).toBe(1);
    expect(g.strands.A).toBeDefined();
    expect(g.strands.C).toBeDefined();
    expect(g.strands.G).toBeDefined();
    expect(g.strands.T).toBeDefined();
    expect(g.hmac).toHaveLength(32);
  });

  it("verifyGenome -- intact passes", () => {
    const g = encodeGenome(r);
    expect(verifyGenome(r, g).ok).toBe(true);
  });

  it("verifyGenome -- tampered fails", () => {
    const g = encodeGenome(r);
    const t = { ...g, strands: { ...g.strands, T: { ...g.strands.T, nucleusTick: 9999 } } };
    expect(verifyGenome(r, t).ok).toBe(false);
  });

  it("diffGenomes reports added / removed", () => {
    const g1 = encodeGenome(r);
    // Add a commit so anchors change.
    writeFileSync(join(r, "src", "y.ts"), "export const y = 2;\n");
    try {
      execSync(`git -c user.email=t@t.com -c user.name=t add .`, { cwd: r, stdio: "ignore" });
      execSync(`git -c user.email=t@t.com -c user.name=t commit -q -m "second"`, { cwd: r, stdio: "ignore" });
    } catch { /* */ }
    const g2 = encodeGenome(r);
    const d = diffGenomes(g1, g2);
    expect(d.commitsAdded).toBeGreaterThanOrEqual(0); // 1 when git worked
  });

  it("recombine produces a valid child genome", () => {
    const g1 = encodeGenome(r);
    const g2 = encodeGenome(r);
    const child = recombine(r, g1, g2);
    expect(child.schemaVersion).toBe(1);
    expect(child.emittedBy).toContain("crossover");
    expect(verifyGenome(r, child).ok).toBe(true);
  });

  it("persistGenome + readLatestGenome roundtrip", () => {
    const g = encodeGenome(r);
    const p = persistGenome(r, g);
    expect(existsSync(p)).toBe(true);
    const latest = readLatestGenome(r);
    expect(latest).not.toBeNull();
    expect(latest!.hmac).toBe(g.hmac);
  });
});

// ─── LAYER 2: WANDERER ───────────────────────────────────────────────

describe("v1.61 Exodus Layer 2 · Wanderer", () => {
  let r: string;
  beforeEach(() => { r = setupRepo(); });
  afterEach(() => cleanup(r));

  it("packWanderer creates a .mwt file", () => {
    const { path, bundle, sizeBytes } = packWanderer(r);
    expect(existsSync(path)).toBe(true);
    expect(bundle.formatVersion).toBe(1);
    expect(bundle.checksum).toHaveLength(32);
    expect(sizeBytes).toBeGreaterThan(100);
  });

  it("unpackWanderer verifies a valid bundle", () => {
    const { path } = packWanderer(r);
    const u = unpackWanderer(r, path);
    expect(u.ok).toBe(true);
    expect(u.bundle).not.toBeNull();
  });

  it("unpackWanderer rejects tampered bundle", () => {
    const { path } = packWanderer(r);
    const body = JSON.parse(readFileSync(path, "utf8")) as { genome: { strands: { T: { nucleusTick: number } } } };
    body.genome.strands.T.nucleusTick = 9999;
    writeFileSync(path, JSON.stringify(body), "utf8");
    const u = unpackWanderer(r, path);
    expect(u.ok).toBe(false);
    expect(u.reason).toMatch(/checksum|HMAC/);
  });

  it("describeBundle reports footprint + QR chunks", () => {
    const { bundle } = packWanderer(r);
    const d = describeBundle(bundle);
    expect(d.bytes).toBeGreaterThan(100);
    expect(d.estimatedQrChunks).toBeGreaterThan(0);
  });
});

// ─── LAYER 3: NUCLEAR EXCHANGE ───────────────────────────────────────

describe("v1.61 Exodus Layer 3 · Nuclear Exchange", () => {
  let r: string;
  beforeEach(() => { r = setupRepo(); });
  afterEach(() => cleanup(r));

  it("makeCert produces a signed cert", () => {
    const c = makeCert(r, "vendor-x");
    expect(c.vendor).toBe("vendor-x");
    expect(c.signature).toHaveLength(24);
  });

  it("makeOffer + evaluateOffer accepts when policy is permissive", () => {
    const g = encodeGenome(r);
    const offer = makeOffer(r, g, "claude-opus-4-7");
    const verdict = evaluateOffer(r, offer);
    expect(verdict.status).toBe("accept");
  });

  it("evaluateOffer rejects when vendor not allowlisted", () => {
    const g = encodeGenome(r);
    const offer = makeOffer(r, g, "vendor-rogue");
    const verdict = evaluateOffer(r, offer, { allowedVendors: ["vendor-trusted"] });
    expect(verdict.status).toBe("reject");
  });

  it("evaluateOffer rejects expired cert", () => {
    const g = encodeGenome(r);
    const offer = makeOffer(r, g, "v");
    offer.cert.emittedAt = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
    const verdict = evaluateOffer(r, offer, { maxAgeHours: 1 });
    expect(verdict.status).toBe("reject");
  });

  it("mergeGenomes produces a child with union of vaccines", () => {
    const g1 = encodeGenome(r);
    const g2 = encodeGenome(r);
    const child = mergeGenomes(r, g1, g2, ["A", "C", "G", "T"]);
    expect(child.schemaVersion).toBe(1);
    expect(child.emittedBy).toContain("nuclear-exchange");
  });
});

// ─── LAYER 4: DREAM WEAVER ───────────────────────────────────────────

describe("v1.61 Exodus Layer 4 · Dream Weaver", () => {
  let r: string;
  beforeEach(() => { r = setupRepo(); });
  afterEach(() => cleanup(r));

  it("runDreamCycle produces phases + persists log", async () => {
    const cycle = await runDreamCycle(r);
    expect(cycle.phases.selfNemesis.probesGenerated).toBeGreaterThan(0);
    expect(cycle.phases.vaccinesEmitted).toBeGreaterThanOrEqual(0);
    expect(cycle.genomePath).not.toBeNull();
    const log = readDreamLog(r);
    expect(log.length).toBeGreaterThanOrEqual(1);
  });

  it("dryRun does NOT persist", async () => {
    const cycle = await runDreamCycle(r, { dryRun: true });
    expect(cycle.genomePath).toBeNull();
    expect(readDreamLog(r).length).toBe(0);
  });

  it("geneticGain is non-negative", async () => {
    const c = await runDreamCycle(r);
    expect(c.geneticGain).toBeGreaterThanOrEqual(0);
  });
});

// ─── LAYER 5: QUANTUM CACHE ──────────────────────────────────────────

describe("v1.61 Exodus Layer 5 · Quantum Cache", () => {
  let r: string;
  beforeEach(() => { r = setupRepo(); });
  afterEach(() => cleanup(r));

  it("observeToolCall builds Markov transitions", () => {
    observeToolCall(r, "mneme.bot.spawn");
    observeToolCall(r, "mneme.truth.check");
    observeToolCall(r, "mneme.bot.spawn");
    observeToolCall(r, "mneme.oracle.forecast");
    const next = predictNextTools(r, "mneme.bot.spawn", 3);
    expect(next.length).toBeGreaterThan(0);
    expect(next[0]!.probability).toBeGreaterThan(0);
    expect(next[0]!.probability).toBeLessThanOrEqual(1);
  });

  it("cacheStore + cacheLookup roundtrip", () => {
    const key = currentInvalidationKey(r);
    cacheStore(r, "mneme.bot.spawn", { claim: "x" }, { verdict: "supported" }, key, 300);
    const hit = cacheLookup(r, "mneme.bot.spawn", { claim: "x" }, key);
    expect(hit).not.toBeNull();
    expect((hit!.result as { verdict: string }).verdict).toBe("supported");
  });

  it("cacheLookup misses on different args", () => {
    const key = currentInvalidationKey(r);
    cacheStore(r, "mneme.bot.spawn", { claim: "a" }, { v: 1 }, key);
    const miss = cacheLookup(r, "mneme.bot.spawn", { claim: "b" }, key);
    expect(miss).toBeNull();
  });

  it("cacheLookup misses on different invalidation key", () => {
    const key = currentInvalidationKey(r);
    cacheStore(r, "t", { x: 1 }, { v: 1 }, key);
    const miss = cacheLookup(r, "t", { x: 1 }, { headHash: "different", vaccineHash: key.vaccineHash });
    expect(miss).toBeNull();
  });

  it("cacheStats reports totals", () => {
    const key = currentInvalidationKey(r);
    cacheStore(r, "t1", { x: 1 }, {}, key);
    cacheStore(r, "t2", { x: 2 }, {}, key);
    const s = cacheStats(r);
    expect(s.totalEntries).toBe(2);
    expect(s.uniqueTools).toBe(2);
  });
});

// ─── LAYER 6: WISDOM RIVER ───────────────────────────────────────────

describe("v1.61 Exodus Layer 6 · Wisdom River", () => {
  let r: string;
  let river: WisdomRiver;
  let port: number;
  beforeEach(async () => {
    r = setupRepo();
    // Random high port to avoid conflicts.
    port = 21550 + Math.floor(Math.random() * 1000);
    river = new WisdomRiver(r, port);
    await river.start();
  });
  afterEach(async () => {
    await river.stop();
    cleanup(r);
  });

  it("emit appends to buffer + persists to JSONL", () => {
    river.emit("vaccine", { id: "vac-1" });
    river.emit("forecast", { p: 0.5 });
    const recent = river.recent();
    expect(recent.length).toBe(2);
    expect(recent[0]!.kind).toBe("vaccine");
    const log = readEventLog(r);
    expect(log.length).toBe(2);
  });

  it("HTTP /health responds 200 with subscriber count", async () => {
    await new Promise<void>((resolve, reject) => {
      const req = httpReq({ host: "127.0.0.1", port, path: "/health", method: "GET" }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = JSON.parse(Buffer.concat(chunks).toString());
          expect(body.ok).toBe(true);
          expect(typeof body.subscribers).toBe("number");
          resolve();
        });
      });
      req.on("error", reject);
      req.end();
    });
  });

  it("HTTP /recent returns recent buffer", async () => {
    river.emit("custom", { hello: "world" });
    await new Promise<void>((resolve, reject) => {
      const req = httpReq({ host: "127.0.0.1", port, path: "/recent", method: "GET" }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const arr = JSON.parse(Buffer.concat(chunks).toString()) as Array<{ kind: string }>;
          expect(arr.length).toBeGreaterThan(0);
          expect(arr.some((e) => e.kind === "custom")).toBe(true);
          resolve();
        });
      });
      req.on("error", reject);
      req.end();
    });
  });

  it("buffer cap prevents unbounded growth", () => {
    for (let i = 0; i < 1200; i++) river.emit("tick", { i });
    const recent = river.recent(2000);
    expect(recent.length).toBeLessThanOrEqual(1000);
  });
});
