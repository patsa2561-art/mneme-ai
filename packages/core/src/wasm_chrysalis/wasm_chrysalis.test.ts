/**
 * v2.19.64 — WASM CHRYSALIS deep tests.
 *
 * The invariant we PROVE: handles(WASM file on disk) = ∅ post-instantiation.
 * After loadAsBytes + instantiateFromBytes, we can:
 *   - read the file again with openSync('r+') without EBUSY
 *   - rename the file
 *   - delete the file
 *   - WHILE THE INSTANTIATED MODULE'S EXPORTS REMAIN CALLABLE
 *
 * That last clause is the magic: it works because WebAssembly.instantiate
 * deserializes into V8's heap. There is no kernel section, no symbol-
 * relocation-at-runtime, no disk-page-fault dependency.
 *
 * We synthesize a minimal valid WASM module (a single `add` function)
 * at test time so the tests work cross-platform without checking in
 * binary artifacts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, writeFileSync, renameSync, unlinkSync, openSync, closeSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadAsBytes,
  instantiateFromBytes,
  verifyHandleClosed,
  launchWasmFile,
  recordLaunch,
  readManifest,
  verifyLaunchChain,
  summarizeManifest,
  lastSig,
  manifestPath,
  PROTOCOL_VERSION,
} from "./index.js";

/** Hand-rolled minimal WASM: one exported function `add(i32, i32) -> i32`.
 *  Encoded per the WASM binary spec (module header + type/func/export/code
 *  sections). Sufficient to prove instantiate works without external deps. */
const MINIMAL_WASM_BYTES = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, // \0asm magic
  0x01, 0x00, 0x00, 0x00, // version 1
  // Type section: 1 type, (i32, i32) -> (i32)
  0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f,
  // Function section: 1 function, type index 0
  0x03, 0x02, 0x01, 0x00,
  // Export section: 1 export, "add" → function 0
  0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00,
  // Code section: 1 body, local.get 0, local.get 1, i32.add, end
  0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b,
]);

describe("v2.19.64 wasm_chrysalis PROTOCOL_VERSION", () => {
  it("is 1", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
});

describe("v2.19.64 loadAsBytes — handle closure invariant", () => {
  let sandbox: string;
  let wasmPath: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "wasm-chrysalis-"));
    wasmPath = join(sandbox, "add.wasm");
    writeFileSync(wasmPath, MINIMAL_WASM_BYTES);
  });
  afterEach(() => {
    try { rmSync(sandbox, { recursive: true, force: true }); } catch { /* */ }
  });

  it("returns bytes matching the file content", () => {
    const r = loadAsBytes(wasmPath);
    expect(r.sizeBytes).toBe(MINIMAL_WASM_BYTES.byteLength);
    expect(Array.from(r.bytes)).toEqual(Array.from(MINIMAL_WASM_BYTES));
  });

  it("computes SHA-256 of the bytes", () => {
    const r = loadAsBytes(wasmPath);
    expect(typeof r.sha256).toBe("string");
    expect(r.sha256.length).toBe(64); // 32 bytes hex
  });

  it("closes the file handle BEFORE returning — proven by openSync('r+') succeeding", () => {
    loadAsBytes(wasmPath);
    // If readFileSync had leaked a handle, this would EBUSY on Windows
    const fd = openSync(wasmPath, "r+");
    closeSync(fd);
    // No throw = handle was closed by readFileSync
    expect(true).toBe(true);
  });

  it("loaded bytes survive file deletion (the heart of the invariant)", () => {
    const r = loadAsBytes(wasmPath);
    unlinkSync(wasmPath);
    expect(existsSync(wasmPath)).toBe(false);
    // Bytes still readable from heap — file gone from disk but data survives
    expect(r.bytes.byteLength).toBe(MINIMAL_WASM_BYTES.byteLength);
    expect(r.bytes[0]).toBe(0x00);
    expect(r.bytes[1]).toBe(0x61);
  });
});

describe("v2.19.64 instantiateFromBytes — actually runs WASM", () => {
  it("instantiates the minimal add module + exposes add(2,3)=5", async () => {
    const r = await instantiateFromBytes(MINIMAL_WASM_BYTES);
    expect(r.ok).toBe(true);
    expect(r.instance).not.toBeNull();
    expect(r.exports).not.toBeNull();
    const add = r.exports!["add"] as (a: number, b: number) => number;
    expect(typeof add).toBe("function");
    expect(add(2, 3)).toBe(5);
    expect(add(-10, 7)).toBe(-3);
  });

  it("returns ok=false on invalid bytes (never throws)", async () => {
    const garbage = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff]);
    const r = await instantiateFromBytes(garbage);
    expect(r.ok).toBe(false);
    expect(r.error).toBeDefined();
    expect(r.instance).toBeNull();
  });
});

describe("v2.19.64 — THE FULL INVARIANT: file overwrite during execution", () => {
  let sandbox: string;
  let wasmPath: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "wasm-invariant-"));
    wasmPath = join(sandbox, "add.wasm");
    writeFileSync(wasmPath, MINIMAL_WASM_BYTES);
  });
  afterEach(() => {
    try { rmSync(sandbox, { recursive: true, force: true }); } catch { /* */ }
  });

  it("instance keeps working after the .wasm file is OVERWRITTEN", async () => {
    const { bytes } = loadAsBytes(wasmPath);
    const inst = await instantiateFromBytes(bytes);
    expect(inst.ok).toBe(true);
    const add = inst.exports!["add"] as (a: number, b: number) => number;
    expect(add(1, 1)).toBe(2);
    // Simulate npm install overwriting the file with totally different content
    writeFileSync(wasmPath, new Uint8Array([0x00, 0x00, 0x00, 0x00]));
    // Instance still callable — proves no kernel-level disk dependency
    expect(add(7, 8)).toBe(15);
    expect(add(-5, 9)).toBe(4);
  });

  it("instance keeps working after the .wasm file is DELETED", async () => {
    const { bytes } = loadAsBytes(wasmPath);
    const inst = await instantiateFromBytes(bytes);
    expect(inst.ok).toBe(true);
    const add = inst.exports!["add"] as (a: number, b: number) => number;
    unlinkSync(wasmPath);
    expect(existsSync(wasmPath)).toBe(false);
    expect(add(99, 1)).toBe(100); // Still callable
  });

  it("instance keeps working after the .wasm file is RENAMED", async () => {
    const { bytes } = loadAsBytes(wasmPath);
    const inst = await instantiateFromBytes(bytes);
    expect(inst.ok).toBe(true);
    const add = inst.exports!["add"] as (a: number, b: number) => number;
    const newPath = join(sandbox, "renamed.wasm");
    renameSync(wasmPath, newPath);
    expect(existsSync(wasmPath)).toBe(false);
    expect(existsSync(newPath)).toBe(true);
    expect(add(10, 20)).toBe(30);
  });
});

describe("v2.19.64 verifyHandleClosed", () => {
  let sandbox: string;
  let wasmPath: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "wasm-handle-check-"));
    wasmPath = join(sandbox, "add.wasm");
    writeFileSync(wasmPath, MINIMAL_WASM_BYTES);
  });
  afterEach(() => {
    try { rmSync(sandbox, { recursive: true, force: true }); } catch { /* */ }
  });

  it("returns selfRead=true on a file with no holders", () => {
    const r = verifyHandleClosed(wasmPath);
    expect(r.selfRead).toBe(true);
    expect(r.externalHolder).not.toBe("yes");
  });

  it("missing file → method='missing-file'", () => {
    const r = verifyHandleClosed(join(sandbox, "nonexistent.wasm"));
    expect(r.method).toBe("missing-file");
    expect(r.selfRead).toBe(false);
  });

  it("after loadAsBytes, file is still open-able (handle WAS closed)", () => {
    loadAsBytes(wasmPath);
    const r = verifyHandleClosed(wasmPath);
    expect(r.selfRead).toBe(true);
  });

  it("after instantiate, file is still open-able (the killer test)", async () => {
    const { bytes } = loadAsBytes(wasmPath);
    const inst = await instantiateFromBytes(bytes);
    expect(inst.ok).toBe(true);
    // V8 holds the compiled module in its heap, but the FILE has no handle
    const r = verifyHandleClosed(wasmPath);
    expect(r.selfRead).toBe(true);
    expect(r.externalHolder).not.toBe("yes");
  });
});

describe("v2.19.64 launch manifest (HMAC chain)", () => {
  let savedSecret: string | undefined;
  let savedPath: string | undefined;
  let sandboxManifest: string;

  beforeEach(() => {
    savedSecret = process.env["MNEME_LAUNCH_MANIFEST_SECRET"];
    savedPath = process.env["MNEME_LAUNCH_MANIFEST_PATH"];
    process.env["MNEME_LAUNCH_MANIFEST_SECRET"] = "test-secret-" + Date.now();
    sandboxManifest = join(mkdtempSync(join(tmpdir(), "wasm-manifest-")), "launch.jsonl");
    process.env["MNEME_LAUNCH_MANIFEST_PATH"] = sandboxManifest;
  });
  afterEach(() => {
    try { rmSync(join(sandboxManifest, ".."), { recursive: true, force: true }); } catch { /* */ }
    if (savedSecret !== undefined) process.env["MNEME_LAUNCH_MANIFEST_SECRET"] = savedSecret;
    else delete process.env["MNEME_LAUNCH_MANIFEST_SECRET"];
    if (savedPath !== undefined) process.env["MNEME_LAUNCH_MANIFEST_PATH"] = savedPath;
    else delete process.env["MNEME_LAUNCH_MANIFEST_PATH"];
  });

  it("recordLaunch appends a valid entry with HMAC sig", () => {
    const e = recordLaunch({ phase: "load-as-bytes", path: "/test/a.wasm", sha256: "abc", bytes: 100, durationMs: 5 });
    expect(e).not.toBeNull();
    expect(e!.phase).toBe("load-as-bytes");
    expect(typeof e!.sig).toBe("string");
    expect(e!.sig.length).toBe(64);
  });

  it("manifestPath() honors MNEME_LAUNCH_MANIFEST_PATH override (test isolation)", () => {
    const p = manifestPath();
    expect(p).toBe(sandboxManifest);
  });

  it("readManifest + verifyLaunchChain roundtrip cleanly", () => {
    recordLaunch({ phase: "load-as-bytes", path: "/x.wasm", sha256: "h1", bytes: 100, durationMs: 1 });
    recordLaunch({ phase: "instantiate", path: "/x.wasm", sha256: "h1", bytes: 100, durationMs: 2 });
    recordLaunch({ phase: "launch-complete", path: "/x.wasm", sha256: "h1", bytes: 100, durationMs: 3 });
    const v = verifyLaunchChain();
    expect(v.chainOk).toBe(true);
    expect(v.totalEntries).toBeGreaterThanOrEqual(3);
  });

  it("lastSig matches most-recent entry's sig", () => {
    const e1 = recordLaunch({ phase: "load-as-bytes", path: "/y.wasm", sha256: "h2", bytes: 50, durationMs: 1 });
    expect(lastSig()).toBe(e1!.sig);
  });

  it("summarizeManifest counts phases correctly", () => {
    recordLaunch({ phase: "load-as-bytes", path: "/z.wasm", sha256: "h3", bytes: 100, durationMs: 1 });
    recordLaunch({ phase: "instantiate", path: "/z.wasm", sha256: "h3", bytes: 100, durationMs: 2 });
    recordLaunch({ phase: "handle-verified", path: "/z.wasm", sha256: "h3", bytes: 100, durationMs: 1 });
    recordLaunch({ phase: "launch-complete", path: "/z.wasm", sha256: "h3", bytes: 100, durationMs: 5 });
    const s = summarizeManifest();
    expect(s.totalEntries).toBeGreaterThanOrEqual(4);
    expect(s.phaseCounts["load-as-bytes"]).toBeGreaterThanOrEqual(1);
    expect(s.phaseCounts["launch-complete"]).toBeGreaterThanOrEqual(1);
    expect(s.totalLaunchCompletes).toBeGreaterThanOrEqual(1);
    expect(s.lastLaunch?.path).toBe("/z.wasm");
    expect(s.chainOk).toBe(true);
  });
});

describe("v2.19.64 launchWasmFile — composed pipeline", () => {
  let sandbox: string;
  let wasmPath: string;
  let savedSecret: string | undefined;
  let savedPath: string | undefined;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "wasm-pipeline-"));
    wasmPath = join(sandbox, "pipeline.wasm");
    writeFileSync(wasmPath, MINIMAL_WASM_BYTES);
    savedSecret = process.env["MNEME_LAUNCH_MANIFEST_SECRET"];
    savedPath = process.env["MNEME_LAUNCH_MANIFEST_PATH"];
    process.env["MNEME_LAUNCH_MANIFEST_SECRET"] = "pipeline-test-" + Date.now();
    process.env["MNEME_LAUNCH_MANIFEST_PATH"] = join(sandbox, "launch.jsonl");
  });
  afterEach(() => {
    try { rmSync(sandbox, { recursive: true, force: true }); } catch { /* */ }
    if (savedSecret !== undefined) process.env["MNEME_LAUNCH_MANIFEST_SECRET"] = savedSecret;
    else delete process.env["MNEME_LAUNCH_MANIFEST_SECRET"];
    if (savedPath !== undefined) process.env["MNEME_LAUNCH_MANIFEST_PATH"] = savedPath;
    else delete process.env["MNEME_LAUNCH_MANIFEST_PATH"];
  });

  it("end-to-end: load + instantiate + verify handle + manifest entries", async () => {
    const r = await launchWasmFile(wasmPath);
    expect(r.load).not.toBeNull();
    expect(r.instantiate!.ok).toBe(true);
    expect(r.handleCheck!.selfRead).toBe(true);
    expect(r.invariantHeld).toBe(true);
    expect(r.manifestEntries).toBeGreaterThanOrEqual(3);
  });

  it("opt-out of manifest recording", async () => {
    const r = await launchWasmFile(wasmPath, { recordManifest: false });
    expect(r.manifestEntries).toBe(0);
    expect(r.invariantHeld).toBe(true);
  });

  it("on missing file: invariantHeld=false (graceful, no throw)", async () => {
    const r = await launchWasmFile(join(sandbox, "nope.wasm"));
    expect(r.invariantHeld).toBe(false);
  });

  it("instance from pipeline still callable after file deleted", async () => {
    const r = await launchWasmFile(wasmPath);
    expect(r.invariantHeld).toBe(true);
    const add = r.instantiate!.exports!["add"] as (a: number, b: number) => number;
    expect(add(3, 4)).toBe(7);
    unlinkSync(wasmPath);
    expect(add(100, 1)).toBe(101); // SURVIVED file deletion
  });
});

describe("v2.19.64 chain integrity (tamper detection)", () => {
  let savedSecret: string | undefined;
  let savedPath: string | undefined;
  let sandbox: string;
  beforeEach(() => {
    savedSecret = process.env["MNEME_LAUNCH_MANIFEST_SECRET"];
    savedPath = process.env["MNEME_LAUNCH_MANIFEST_PATH"];
    process.env["MNEME_LAUNCH_MANIFEST_SECRET"] = "tamper-test-" + Date.now();
    sandbox = mkdtempSync(join(tmpdir(), "wasm-tamper-"));
    process.env["MNEME_LAUNCH_MANIFEST_PATH"] = join(sandbox, "launch.jsonl");
  });
  afterEach(() => {
    try { rmSync(sandbox, { recursive: true, force: true }); } catch { /* */ }
    if (savedSecret !== undefined) process.env["MNEME_LAUNCH_MANIFEST_SECRET"] = savedSecret;
    else delete process.env["MNEME_LAUNCH_MANIFEST_SECRET"];
    if (savedPath !== undefined) process.env["MNEME_LAUNCH_MANIFEST_PATH"] = savedPath;
    else delete process.env["MNEME_LAUNCH_MANIFEST_PATH"];
  });

  it("detects tampered phase field", () => {
    recordLaunch({ phase: "load-as-bytes", path: "/t.wasm", sha256: "x", bytes: 1, durationMs: 1 });
    recordLaunch({ phase: "launch-complete", path: "/t.wasm", sha256: "x", bytes: 1, durationMs: 1 });
    const p = manifestPath();
    const lines = readFileSync(p, "utf8").trim().split("\n");
    // Tamper the second-to-last entry
    const targetIdx = lines.length - 2;
    const tampered = JSON.parse(lines[targetIdx]!);
    tampered.phase = "fallback-to-native";
    lines[targetIdx] = JSON.stringify(tampered);
    writeFileSync(p, lines.join("\n") + "\n", "utf8");
    const v = verifyLaunchChain();
    expect(v.chainOk).toBe(false);
    expect(v.brokenAtIndex).toBe(targetIdx);
  });
});
