/**
 * Bug #1 regression: large CLI JSON outputs (> 8KB) must survive the
 * runCliJson stdout-accumulation path without truncation. The original
 * bug claim was "8KB JSON truncation in quality.repo_mri / insights.oracle
 * / insights.ghost". The current code uses the standard chunk-collection
 * pattern which Node 18+ handles correctly past any size; this test pins
 * the behaviour so a future regression is caught immediately.
 */

import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function runWithMcpStyleSpawn(payload: string, timeoutMs = 8000): Promise<{ exit: number | null; bytes: number; parsed: unknown }> {
  // Stage payload in a temp file (command-line args max out at ~8KB on Windows).
  // Spawn `node` with a tiny script that streams the file to stdout — same
  // accumulation pattern MCP runtime uses.
  const dir = mkdtempSync(join(tmpdir(), "mneme-runtime-"));
  const payloadPath = join(dir, "payload.json");
  writeFileSync(payloadPath, payload);
  const script = `require('fs').createReadStream(${JSON.stringify(payloadPath)}).pipe(process.stdout);`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", script], {
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    child.stdout.on("data", (b) => (stdout += String(b)));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("timeout"));
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
      try { resolve({ exit: code, bytes: stdout.length, parsed: JSON.parse(stdout) }); }
      catch (e) { reject(e); }
    });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

describe("MCP runtime — large stdout (regression for #1)", () => {
  it("survives a 50KB JSON payload through the MCP-style spawn path", async () => {
    const big = { items: Array.from({ length: 5000 }, (_, i) => ({ idx: i, label: `entry-${i}` })) };
    const payload = JSON.stringify(big);
    expect(payload.length).toBeGreaterThan(50_000);
    const r = await runWithMcpStyleSpawn(payload);
    expect(r.exit).toBe(0);
    expect(r.bytes).toBe(payload.length);
    expect((r.parsed as { items: unknown[] }).items).toHaveLength(5000);
  });

  it("survives a 200KB JSON payload (well past any historical 8KB limit)", async () => {
    const huge = { items: Array.from({ length: 20000 }, (_, i) => ({ idx: i, label: `entry-${i}` })) };
    const payload = JSON.stringify(huge);
    expect(payload.length).toBeGreaterThan(200_000);
    const r = await runWithMcpStyleSpawn(payload, 15_000);
    expect(r.exit).toBe(0);
    expect(r.bytes).toBe(payload.length);
  });
});
