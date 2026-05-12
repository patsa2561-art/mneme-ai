/**
 * v1.66.0 -- AUTARCHY PROTOCOL test suite.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { meshCloudReport } from "./mesh_as_cloud.js";
import { observeEmbedders, readEmbedderStatus } from "./schroedinger_embedder.js";
import { installBakedBundle, pharmacopoeiaStatus, ensurePharmacopoeia, getBakedBundle, BAKED_BUNDLE_VERSION } from "./baked_pharmacopoeia.js";
import { pinIfUnpinned, reverifyAgainstPin, readChecksumPin } from "./eager_pin.js";
import { autarchy } from "./index.js";

function setup(): string { return mkdtempSync(join(tmpdir(), "mneme-autarchy-")); }
function cleanup(r: string) { try { rmSync(r, { recursive: true, force: true }); } catch { /* */ } }

// ─── A1 MESH-AS-CLOUD ───────────────────────────────────────────────

describe("v1.66 Autarchy A1 · Mesh-as-Cloud", () => {
  let r: string;
  beforeEach(() => { r = setup(); });
  afterEach(() => cleanup(r));

  it("isolated when no mesh artifacts", () => {
    const r1 = meshCloudReport(r);
    expect(r1.state).toBe("isolated");
    expect(r1.uniquePeers).toBe(0);
  });

  it("mesh-only when mesh-seen has recent peers", () => {
    mkdirSync(join(r, ".mneme"), { recursive: true });
    writeFileSync(join(r, ".mneme/mesh-seen.jsonl"),
      JSON.stringify({ peer: "peer-a", ts: new Date().toISOString() }) + "\n" +
      JSON.stringify({ peer: "peer-b", ts: new Date().toISOString() }) + "\n",
      "utf8");
    const r1 = meshCloudReport(r);
    expect(r1.state).toBe("mesh-only");
    expect(r1.uniquePeers).toBe(2);
    expect(r1.sources.meshGossip).toBe(2);
  });

  it("excludes peers outside the lookback window", () => {
    mkdirSync(join(r, ".mneme"), { recursive: true });
    const old = new Date(Date.now() - 48 * 3600 * 1000).toISOString(); // 48h ago
    writeFileSync(join(r, ".mneme/mesh-seen.jsonl"),
      JSON.stringify({ peer: "peer-old", ts: old }) + "\n",
      "utf8");
    const r1 = meshCloudReport(r, { lookbackHours: 24 });
    expect(r1.state).toBe("isolated");
  });

  it("reports central-online when flagged", () => {
    const r1 = meshCloudReport(r, { centralOnline: true });
    expect(r1.state).toBe("central-online");
  });

  it("dedups peers across sources", () => {
    mkdirSync(join(r, ".mneme"), { recursive: true });
    writeFileSync(join(r, ".mneme/mesh-seen.jsonl"),
      JSON.stringify({ peer: "peer-x", ts: new Date().toISOString() }) + "\n",
      "utf8");
    writeFileSync(join(r, ".mneme/wisdom-inheritance.jsonl"),
      JSON.stringify({ from: "peer-x", ts: new Date().toISOString() }) + "\n",
      "utf8");
    const r1 = meshCloudReport(r);
    expect(r1.uniquePeers).toBe(1);
  });
});

// ─── A2 SCHROEDINGER EMBEDDER ──────────────────────────────────────

describe("v1.66 Autarchy A2 · Schroedinger Embedder", () => {
  let r: string;
  beforeEach(() => { r = setup(); });
  afterEach(() => cleanup(r));

  it("races probes + writes authoritative status file", async () => {
    const status = await observeEmbedders(r, { skipOllama: true, skipBundled: true });
    expect(status.allTiers.length).toBeGreaterThanOrEqual(2);
    expect(status.winner).toBeDefined();
    expect(existsSync(join(r, ".mneme/embedder-status.json"))).toBe(true);
  });

  it("respects cooldown -- reuses cached status when fresh", async () => {
    await observeEmbedders(r, { skipOllama: true, skipBundled: true, cooldownMs: 60_000 });
    const first = JSON.parse(readFileSync(join(r, ".mneme/embedder-status.json"), "utf8")) as { ts: string };
    await new Promise((res) => setTimeout(res, 50));
    await observeEmbedders(r, { skipOllama: true, skipBundled: true, cooldownMs: 60_000 });
    const second = JSON.parse(readFileSync(join(r, ".mneme/embedder-status.json"), "utf8")) as { ts: string };
    expect(second.ts).toBe(first.ts); // not reprobed
  });

  it("force=true reprobes even within cooldown", async () => {
    await observeEmbedders(r, { skipOllama: true, skipBundled: true, cooldownMs: 60_000 });
    const first = JSON.parse(readFileSync(join(r, ".mneme/embedder-status.json"), "utf8")) as { ts: string };
    await new Promise((res) => setTimeout(res, 30));
    await observeEmbedders(r, { skipOllama: true, skipBundled: true, cooldownMs: 60_000, force: true });
    const second = JSON.parse(readFileSync(join(r, ".mneme/embedder-status.json"), "utf8")) as { ts: string };
    expect(second.ts).not.toBe(first.ts);
  });

  it("readEmbedderStatus returns null when not probed", () => {
    expect(readEmbedderStatus(r)).toBeNull();
  });

  it("winnerChangedAt tracks transition", async () => {
    // First probe -- winner is hash (everything skipped)
    await observeEmbedders(r, { skipOllama: true, skipBundled: true });
    const first = readEmbedderStatus(r)!;
    expect(first.winnerChangedAt).toBeNull(); // first probe ever
    // Second probe immediately -- same winner -> stableSince unchanged
    await observeEmbedders(r, { skipOllama: true, skipBundled: true, force: true });
    const second = readEmbedderStatus(r)!;
    expect(second.stableSince).toBe(first.stableSince);
  });
});

// ─── A3 TIMECRYSTAL PHARMACOPOEIA ──────────────────────────────────

describe("v1.66 Autarchy A3 · Timecrystal Pharmacopoeia", () => {
  let r: string;
  beforeEach(() => { r = setup(); });
  afterEach(() => cleanup(r));

  it("baked bundle has stable version + non-empty entries", () => {
    expect(BAKED_BUNDLE_VERSION).toMatch(/^v1\.66/);
    expect(getBakedBundle().length).toBeGreaterThanOrEqual(5);
  });

  it("status reports zero installed on cold repo", () => {
    const s = pharmacopoeiaStatus(r);
    expect(s.localCount).toBe(0);
    expect(s.bakedAlreadyInstalled).toBe(false);
  });

  it("installBakedBundle is idempotent", () => {
    const a = installBakedBundle(r);
    expect(a).toBeGreaterThan(0);
    const b = installBakedBundle(r);
    expect(b).toBe(0); // already installed
    const s = pharmacopoeiaStatus(r);
    expect(s.bakedAlreadyInstalled).toBe(true);
  });

  it("ensurePharmacopoeia auto-installs on cold repo", () => {
    const { installed, status } = ensurePharmacopoeia(r);
    expect(installed).toBeGreaterThan(0);
    expect(status.bakedAlreadyInstalled).toBe(true);
  });

  it("ensurePharmacopoeia skips when CDN override set", () => {
    const prev = process.env["MNEME_PHARMACOPOEIA_CDN"];
    process.env["MNEME_PHARMACOPOEIA_CDN"] = "https://example.com/cdn";
    try {
      const { installed } = ensurePharmacopoeia(r);
      expect(installed).toBe(0);
    } finally {
      if (prev === undefined) delete process.env["MNEME_PHARMACOPOEIA_CDN"];
      else process.env["MNEME_PHARMACOPOEIA_CDN"] = prev;
    }
  });

  it("does not duplicate vaccines already in bank", () => {
    installBakedBundle(r);
    const before = readFileSync(join(r, ".mneme/squadron/lie-vaccines.jsonl"), "utf8").split("\n").filter(Boolean).length;
    installBakedBundle(r);
    const after = readFileSync(join(r, ".mneme/squadron/lie-vaccines.jsonl"), "utf8").split("\n").filter(Boolean).length;
    expect(after).toBe(before);
  });
});

// ─── A4 QUANTUM CHECKSUM ──────────────────────────────────────────

describe("v1.66 Autarchy A4 · Quantum Checksum (triple-witness pin)", () => {
  let r: string;
  let cacheDir: string;
  beforeEach(() => {
    r = setup();
    cacheDir = join(r, "model-cache");
    mkdirSync(cacheDir, { recursive: true });
  });
  afterEach(() => cleanup(r));

  it("no pin when cache empty", () => {
    const out = pinIfUnpinned(r, cacheDir);
    expect(out.pinned).toBe(false);
    expect(out.pin).toBeNull();
  });

  it("pins on first call with non-empty cache", () => {
    writeFileSync(join(cacheDir, "model.onnx"), "FAKE-MODEL-BINARY-DATA", "utf8");
    writeFileSync(join(cacheDir, "config.json"), '{"x":1}', "utf8");
    const out = pinIfUnpinned(r, cacheDir);
    expect(out.pinned).toBe(true);
    expect(out.pin?.fileHashes["model.onnx"]).toBeDefined();
    expect(out.pin?.bundleHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("pinIfUnpinned is idempotent", () => {
    writeFileSync(join(cacheDir, "model.onnx"), "DATA", "utf8");
    const a = pinIfUnpinned(r, cacheDir);
    expect(a.pinned).toBe(true);
    const b = pinIfUnpinned(r, cacheDir);
    expect(b.pinned).toBe(false);
    expect(b.pin?.pinnedAt).toBe(a.pin?.pinnedAt);
  });

  it("reverify detects drift", () => {
    writeFileSync(join(cacheDir, "model.onnx"), "ORIGINAL", "utf8");
    pinIfUnpinned(r, cacheDir);
    writeFileSync(join(cacheDir, "model.onnx"), "TAMPERED", "utf8");
    const rv = reverifyAgainstPin(r, cacheDir);
    expect(rv.status).toBe("drift");
    expect(rv.driftedFiles.length).toBeGreaterThan(0);
  });

  it("reverify matches when unchanged", () => {
    writeFileSync(join(cacheDir, "model.onnx"), "DATA", "utf8");
    pinIfUnpinned(r, cacheDir);
    const rv = reverifyAgainstPin(r, cacheDir);
    expect(rv.status).toBe("match");
  });

  it("reverify returns no-pin when none recorded", () => {
    const rv = reverifyAgainstPin(r, cacheDir);
    expect(rv.status).toBe("no-pin");
  });
});

// ─── Aggregate ─────────────────────────────────────────────────────

describe("v1.66 Autarchy · aggregate score", () => {
  let r: string;
  beforeEach(() => { r = setup(); });
  afterEach(() => cleanup(r));

  it("cold repo scores low + recommends actions", async () => {
    const rep = await autarchy(r, { skipOllama: true, skipBundled: true });
    expect(rep.score).toBeGreaterThanOrEqual(0);
    expect(rep.score).toBeLessThan(60);
    expect(rep.recommendations.length).toBeGreaterThan(0);
    expect(rep.headline).toContain("Autarchy score");
  });

  it("install=true installs baked bundle + probes embedder", async () => {
    const rep = await autarchy(r, { install: true, skipOllama: true, skipBundled: true });
    expect(rep.axes.A3_pharmacopoeia.bakedAlreadyInstalled).toBe(true);
    expect(rep.axes.A2_embedder).not.toBeNull();
  });

  it("score increases after install", async () => {
    const before = await autarchy(r, { skipOllama: true, skipBundled: true });
    const after = await autarchy(r, { install: true, skipOllama: true, skipBundled: true });
    expect(after.score).toBeGreaterThanOrEqual(before.score);
  });
});
