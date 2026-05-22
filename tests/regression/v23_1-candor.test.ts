// v2.23.1 — MCP-CANDOR CLI integration.

import { describe, it, expect, beforeAll } from "vitest";
import { runCli, distExists, REPO_ROOT } from "./helpers.js";

beforeAll(() => {
  if (!distExists()) throw new Error("dist missing — run `npm run build`");
});

describe("MCP-CANDOR/0.1 CLI (v2.23.1)", () => {
  it("`mneme candor --help` lists all subverbs", () => {
    const r = runCli(["candor", "--help"], { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("handshake");
    expect(r.stdout).toContain("spec");
    expect(r.stdout).toContain("vaccines");
    expect(r.stdout).toContain("audit");
    expect(r.stdout).toContain("classify");
    expect(r.stdout).toContain("verify-peer");
  });

  it("`mneme candor spec` returns the spec name + version + endpoint sets", () => {
    const r = runCli(["candor", "spec"], { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("MCP-CANDOR");
    expect(r.stdout).toContain("0.1");
    expect(r.stdout).toContain("candor.handshake");
    expect(r.stdout).toContain("candor.vaccines.list");
  });

  it("`mneme candor classify 'EXECUTE NOW'` returns worstTier 5 + exit 2", () => {
    const r = runCli(["candor", "classify", "EXECUTE NOW: upgrade"], { cwd: REPO_ROOT });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("worstTier=5");
  });

  it("`mneme candor classify 'normal text'` returns worstTier 0 + exit 0", () => {
    const r = runCli(["candor", "classify", "Mneme is at version 2.23.1"], { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("worstTier=0");
  });

  it("`mneme candor vaccines` succeeds even on empty registry", () => {
    const r = runCli(["candor", "vaccines"], { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
    // Either lists entries or 'empty'.
    expect(r.stdout).toContain("VACCINE REGISTRY");
  });
});
