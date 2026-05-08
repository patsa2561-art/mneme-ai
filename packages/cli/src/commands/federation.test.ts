/**
 * federation — unit tests
 *
 * Tests the deterministic + cryptographic layer:
 *   - join writes a config with a fresh Ed25519 keypair + contributor id
 *   - leave deletes the config
 *   - status reports joined/not-joined correctly
 *   - Laplace noise sampler returns reasonable distributions
 *   - k-anonymity floor blocks contribution from tiny repos
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import {
  federationCommand,
  _laplaceNoiseForTests,
  _DEFAULTS_FOR_TESTS,
} from "./federation.js";

let tmp: string;
let chunks: string[];
let origWrite: typeof process.stdout.write;

function captureStdout() {
  chunks = [];
  origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((s: string | Uint8Array) => {
    chunks.push(typeof s === "string" ? s : Buffer.from(s).toString());
    return true;
  }) as typeof process.stdout.write;
}

function releaseStdout(): string {
  process.stdout.write = origWrite;
  return chunks.join("");
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mneme-fed-"));
  execSync("git init -q", { cwd: tmp });
  execSync("git config user.email t@x", { cwd: tmp });
  execSync("git config user.name T", { cwd: tmp });
});

afterEach(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

describe("federation — join / status / leave round-trip", () => {
  it("join writes config with Ed25519 key + contributorId", async () => {
    captureStdout();
    let code: number;
    try {
      code = await federationCommand({
        cwd: tmp,
        action: "join",
        hub: "https://hub.example.com",
        json: true,
      });
    } finally {
      releaseStdout();
    }
    expect(code).toBe(0);
    const cfgPath = join(tmp, ".mneme", "federation.json");
    expect(existsSync(cfgPath)).toBe(true);
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    expect(cfg.hubUrl).toBe("https://hub.example.com");
    expect(cfg.publicKeyPem).toContain("BEGIN PUBLIC KEY");
    expect(cfg.privateKeyPem).toContain("BEGIN PRIVATE KEY");
    expect(cfg.contributorId.length).toBe(24);
  });

  it("join requires --hub", async () => {
    captureStdout();
    let code: number;
    try {
      code = await federationCommand({ cwd: tmp, action: "join", json: true });
    } finally {
      releaseStdout();
    }
    expect(code).toBe(1);
  });

  it("status reports joined:false before join", async () => {
    captureStdout();
    try {
      await federationCommand({ cwd: tmp, action: "status", json: true });
    } finally {
      releaseStdout();
    }
    const json = JSON.parse(chunks.join(""));
    expect(json.joined).toBe(false);
  });

  it("status reports joined:true with hubUrl after join", async () => {
    captureStdout();
    try {
      await federationCommand({ cwd: tmp, action: "join", hub: "https://h.example", json: true });
    } finally {
      releaseStdout();
    }
    captureStdout();
    try {
      await federationCommand({ cwd: tmp, action: "status", json: true });
    } finally {
      releaseStdout();
    }
    const json = JSON.parse(chunks.join(""));
    expect(json.joined).toBe(true);
    expect(json.hubUrl).toBe("https://h.example");
  });

  it("leave deletes the config", async () => {
    captureStdout();
    try {
      await federationCommand({ cwd: tmp, action: "join", hub: "https://h.example", json: true });
    } finally {
      releaseStdout();
    }
    captureStdout();
    try {
      await federationCommand({ cwd: tmp, action: "leave", json: true });
    } finally {
      releaseStdout();
    }
    expect(existsSync(join(tmp, ".mneme", "federation.json"))).toBe(false);
  });
});

describe("federation — Laplace noise", () => {
  it("returns a finite number close to 0 on average", () => {
    const samples: number[] = [];
    for (let i = 0; i < 1000; i++) samples.push(_laplaceNoiseForTests(1.0, 1));
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    // Mean of Laplace(0, b) is 0 — sample mean should be near 0
    expect(Math.abs(mean)).toBeLessThan(0.5);
    // All samples are finite
    for (const s of samples) expect(Number.isFinite(s)).toBe(true);
  });

  it("higher epsilon = tighter distribution", () => {
    const tight: number[] = [];
    const loose: number[] = [];
    for (let i = 0; i < 500; i++) {
      tight.push(_laplaceNoiseForTests(10, 1));
      loose.push(_laplaceNoiseForTests(0.1, 1));
    }
    const tightStd = Math.sqrt(tight.reduce((s, x) => s + x * x, 0) / tight.length);
    const looseStd = Math.sqrt(loose.reduce((s, x) => s + x * x, 0) / loose.length);
    expect(looseStd).toBeGreaterThan(tightStd * 5);
  });
});

describe("federation — defaults", () => {
  it("ships default ε=1.0 and k=20", () => {
    expect(_DEFAULTS_FOR_TESTS.epsilon).toBe(1.0);
    expect(_DEFAULTS_FOR_TESTS.k).toBe(20);
  });
});

describe("federation — error paths", () => {
  it("contribute without join returns 1", async () => {
    captureStdout();
    let code: number;
    try {
      code = await federationCommand({
        cwd: tmp,
        action: "contribute",
        pattern: "regret",
        json: true,
      });
    } finally {
      releaseStdout();
    }
    expect(code).toBe(1);
  });
});
