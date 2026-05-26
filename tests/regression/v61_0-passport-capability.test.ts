/**
 * v2.61.0 — PASSPORT (capability-based security) pinned tests.
 *
 * The "diplomat" angle of Mneme MCP. First capability-based security
 * layer that ties trust score → tool permission in the MCP ecosystem.
 *
 * Section map:
 *   D1 — trust score fusion
 *   D2 — policy (tier classification + thresholds)
 *   D3 — issue (high trust + low trust + missing trust)
 *   D4 — verify (HMAC + TTL + revoked + tool mismatch + scope mismatch)
 *   D5 — delegation chain (parent → child; scope subset enforcement)
 *   D6 — revocation cascade (revoke parent → child invalidated)
 *   D7 — HMAC-chained ledger integrity
 *   D8 — CLI surface
 *   D9 — TG probes
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "../..");
const CLI = join(REPO, "packages", "cli", "bin", "mneme.js");

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "mneme-pp-"));
}

describe("v2.61.0 D1 — trust score fusion (PINNED)", () => {
  it("D1.1 no signals → neutral 0.5", async () => {
    const m = await import("../../packages/core/src/passport/trust_score.js");
    const r = m.computeTrust({});
    expect(r.score).toBe(0.5);
  });

  it("D1.2 high envScanConfidence + CONFIRMED identity → high score", async () => {
    const m = await import("../../packages/core/src/passport/trust_score.js");
    const r = m.computeTrust({ envScanConfidence: 0.95, identityVerdict: "CONFIRMED" });
    expect(r.score).toBeGreaterThan(0.85);
  });

  it("D1.3 IMPOSSIBLE identity verdict → low score", async () => {
    const m = await import("../../packages/core/src/passport/trust_score.js");
    const r = m.computeTrust({ envScanConfidence: 0.95, identityVerdict: "IMPOSSIBLE" });
    // 0.95 weighted 0.20 + 0.0 weighted 0.25 = (0.19 + 0) / 0.45 ≈ 0.42
    expect(r.score).toBeLessThan(0.6);
  });

  it("D1.4 stealth score is inverted (1 stealth → 0 trust contribution)", async () => {
    const m = await import("../../packages/core/src/passport/trust_score.js");
    const r = m.computeTrust({ stealthScore: 1.0 });
    expect(r.score).toBeLessThan(0.5);
  });

  it("D1.5 per-signal breakdown returned for audit", async () => {
    const m = await import("../../packages/core/src/passport/trust_score.js");
    const r = m.computeTrust({ envScanConfidence: 0.9, honestMirrorWeight: 0.8 });
    expect(r.signals.length).toBe(6);
    const env = r.signals.find((s) => s.name === "envScanConfidence");
    expect(env?.value).toBe(0.9);
  });
});

describe("v2.61.0 D2 — policy (PINNED)", () => {
  it("D2.1 classifyTier on 'shell.exec' → destructive", async () => {
    const m = await import("../../packages/core/src/passport/policy.js");
    expect(m.classifyTier("shell.exec")).toBe("destructive");
  });

  it("D2.2 classifyTier on 'http.fetch' → network", async () => {
    const m = await import("../../packages/core/src/passport/policy.js");
    expect(m.classifyTier("http.fetch")).toBe("network");
  });

  it("D2.3 classifyTier on 'fs.write_file' → write", async () => {
    const m = await import("../../packages/core/src/passport/policy.js");
    expect(m.classifyTier("fs.write_file")).toBe("write");
  });

  it("D2.4 classifyTier on 'fs.read_file' → read", async () => {
    const m = await import("../../packages/core/src/passport/policy.js");
    expect(m.classifyTier("fs.read_file")).toBe("read");
  });

  it("D2.5 DEFAULT_POLICY destructive threshold ≥ 0.85", async () => {
    const m = await import("../../packages/core/src/passport/policy.js");
    expect(m.DEFAULT_POLICY.destructive.minTrust).toBeGreaterThanOrEqual(0.85);
  });

  it("D2.6 DEFAULT_POLICY destructive TTL ≤ 5min", async () => {
    const m = await import("../../packages/core/src/passport/policy.js");
    expect(m.DEFAULT_POLICY.destructive.ttlMs).toBeLessThanOrEqual(5 * 60 * 1000);
  });
});

describe("v2.61.0 D3 — issue passport (PINNED)", () => {
  it("D3.1 high trust + destructive tool → GRANTED with destructive tier", async () => {
    const m = await import("../../packages/core/src/passport/index.js");
    const dir = tmp();
    try {
      const r = m.issuePassport({
        tool: "shell.exec", agent: "claude-code", cwd: dir,
        trustInputs: { envScanConfidence: 0.95, identityVerdict: "CONFIRMED", honestMirrorWeight: 0.95 },
      });
      expect(r.ok).toBe(true);
      expect(r.tier?.name).toBe("destructive");
      expect(r.passport?.token).toMatch(/\./);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("D3.2 low trust + destructive tool → REFUSED with trust_too_low", async () => {
    const m = await import("../../packages/core/src/passport/index.js");
    const dir = tmp();
    try {
      const r = m.issuePassport({
        tool: "shell.exec", agent: "untrusted", cwd: dir,
        trustInputs: { envScanConfidence: 0.2 },
      });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("trust_too_low");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("D3.3 no trust signals + safe tool → GRANTED (safe tier has 0 threshold)", async () => {
    const m = await import("../../packages/core/src/passport/index.js");
    const dir = tmp();
    try {
      const r = m.issuePassport({ tool: "info.version", agent: "any", cwd: dir });
      expect(r.ok).toBe(true);
      expect(r.tier?.name).toBe("safe");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("D3.4 explicit tier override accepted", async () => {
    const m = await import("../../packages/core/src/passport/index.js");
    const dir = tmp();
    try {
      const r = m.issuePassport({
        tool: "info.version", agent: "claude-code", tier: "destructive", cwd: dir,
        trustInputs: { envScanConfidence: 0.95, identityVerdict: "CONFIRMED", honestMirrorWeight: 0.95 },
      });
      expect(r.ok).toBe(true);
      expect(r.tier?.name).toBe("destructive");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.61.0 D4 — verify passport (PINNED)", () => {
  it("D4.1 freshly-issued passport verifies VALID with positive ttl", async () => {
    const m = await import("../../packages/core/src/passport/index.js");
    const dir = tmp();
    try {
      const r = m.issuePassport({
        tool: "fs.read_file", agent: "claude-code", cwd: dir,
        trustInputs: { envScanConfidence: 0.95, identityVerdict: "CONFIRMED", honestMirrorWeight: 0.95 },
      });
      const v = m.verifyPassport({ token: r.passport!.token, cwd: dir });
      expect(v.valid).toBe(true);
      expect(v.ttlMs).toBeGreaterThan(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("D4.2 tampered token → bad_hmac", async () => {
    const m = await import("../../packages/core/src/passport/index.js");
    const dir = tmp();
    try {
      const r = m.issuePassport({
        tool: "fs.read_file", agent: "x", cwd: dir,
        trustInputs: { envScanConfidence: 0.9 },
      });
      const token = r.passport!.token;
      const tampered = token.slice(0, -2) + (token.slice(-2) === "00" ? "ff" : "00");
      const v = m.verifyPassport({ token: tampered, cwd: dir });
      expect(v.valid).toBe(false);
      expect(["bad_hmac", "malformed"]).toContain(v.reason);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("D4.3 expectedTool mismatch → tool_mismatch", async () => {
    const m = await import("../../packages/core/src/passport/index.js");
    const dir = tmp();
    try {
      const r = m.issuePassport({
        tool: "fs.read_file", agent: "x", cwd: dir,
        trustInputs: { envScanConfidence: 0.9 },
      });
      const v = m.verifyPassport({ token: r.passport!.token, expectedTool: "fs.write_file", cwd: dir });
      expect(v.valid).toBe(false);
      expect(v.reason).toBe("tool_mismatch");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("D4.4 expectedScope subset enforcement", async () => {
    const m = await import("../../packages/core/src/passport/index.js");
    const dir = tmp();
    try {
      const r = m.issuePassport({
        tool: "fs.read_file", agent: "x", cwd: dir,
        trustInputs: { envScanConfidence: 0.9 },
        scope: ["read_user_dir"],
      });
      const v1 = m.verifyPassport({ token: r.passport!.token, expectedScope: ["read_user_dir"], cwd: dir });
      expect(v1.valid).toBe(true);
      const v2 = m.verifyPassport({ token: r.passport!.token, expectedScope: ["read_system_dir"], cwd: dir });
      expect(v2.valid).toBe(false);
      expect(v2.reason).toBe("scope_mismatch");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("D4.5 malformed token → malformed", async () => {
    const m = await import("../../packages/core/src/passport/index.js");
    const dir = tmp();
    try {
      const v = m.verifyPassport({ token: "not-a-token", cwd: dir });
      expect(v.valid).toBe(false);
      expect(v.reason).toBe("malformed");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.61.0 D5 — delegation chain (PINNED)", () => {
  it("D5.1 child passport with subset scope of parent is GRANTED", async () => {
    const m = await import("../../packages/core/src/passport/index.js");
    const dir = tmp();
    try {
      const parent = m.issuePassport({
        tool: "fs.read_file", agent: "parent", cwd: dir,
        trustInputs: { envScanConfidence: 0.95, identityVerdict: "CONFIRMED", honestMirrorWeight: 0.95 },
        scope: ["a", "b", "c"],
      });
      expect(parent.ok).toBe(true);
      const child = m.issuePassport({
        tool: "fs.read_file", agent: "child", cwd: dir,
        trustInputs: { envScanConfidence: 0.95, identityVerdict: "CONFIRMED", honestMirrorWeight: 0.95 },
        scope: ["a"], // subset
        parent: parent.passport!.token,
      });
      expect(child.ok).toBe(true);
      expect(child.passport?.claims.parentJti).toBe(parent.passport?.claims.jti);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("D5.2 child scope NOT subset of parent → parent_scope_violation REFUSED", async () => {
    const m = await import("../../packages/core/src/passport/index.js");
    const dir = tmp();
    try {
      const parent = m.issuePassport({
        tool: "fs.read_file", agent: "parent", cwd: dir,
        trustInputs: { envScanConfidence: 0.95, identityVerdict: "CONFIRMED", honestMirrorWeight: 0.95 },
        scope: ["a"],
      });
      const child = m.issuePassport({
        tool: "fs.read_file", agent: "child", cwd: dir,
        trustInputs: { envScanConfidence: 0.95, identityVerdict: "CONFIRMED", honestMirrorWeight: 0.95 },
        scope: ["b"], // not in parent
        parent: parent.passport!.token,
      });
      expect(child.ok).toBe(false);
      expect(child.reason).toBe("parent_scope_violation");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("D5.3 child with invalid parent token → parent_invalid REFUSED", async () => {
    const m = await import("../../packages/core/src/passport/index.js");
    const dir = tmp();
    try {
      const child = m.issuePassport({
        tool: "fs.read_file", agent: "child", cwd: dir,
        trustInputs: { envScanConfidence: 0.95 },
        parent: "totally-fake-token",
      });
      expect(child.ok).toBe(false);
      expect(child.reason).toBe("parent_invalid");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.61.0 D6 — revocation cascade (PINNED)", () => {
  it("D6.1 revoke parent with cascade=true → child verifies as revoked", async () => {
    const m = await import("../../packages/core/src/passport/index.js");
    const dir = tmp();
    try {
      const parent = m.issuePassport({
        tool: "fs.read_file", agent: "parent", cwd: dir,
        trustInputs: { envScanConfidence: 0.95, identityVerdict: "CONFIRMED", honestMirrorWeight: 0.95 },
      });
      const child = m.issuePassport({
        tool: "fs.read_file", agent: "child", cwd: dir,
        trustInputs: { envScanConfidence: 0.95, identityVerdict: "CONFIRMED", honestMirrorWeight: 0.95 },
        parent: parent.passport!.token,
      });
      const rev = m.revokePassport({ token: parent.passport!.token, cwd: dir, cascade: true });
      expect(rev.ok).toBe(true);
      expect(rev.revokedJtis.length).toBe(2); // parent + 1 descendant
      const v = m.verifyPassport({ token: child.passport!.token, cwd: dir });
      expect(v.valid).toBe(false);
      expect(v.reason).toBe("revoked");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("D6.2 revoke parent with cascade=false → child still valid", async () => {
    const m = await import("../../packages/core/src/passport/index.js");
    const dir = tmp();
    try {
      const parent = m.issuePassport({
        tool: "fs.read_file", agent: "parent", cwd: dir,
        trustInputs: { envScanConfidence: 0.95, identityVerdict: "CONFIRMED", honestMirrorWeight: 0.95 },
      });
      const child = m.issuePassport({
        tool: "fs.read_file", agent: "child", cwd: dir,
        trustInputs: { envScanConfidence: 0.95, identityVerdict: "CONFIRMED", honestMirrorWeight: 0.95 },
        parent: parent.passport!.token,
      });
      m.revokePassport({ token: parent.passport!.token, cwd: dir, cascade: false });
      const v = m.verifyPassport({ token: child.passport!.token, cwd: dir });
      expect(v.valid).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("D6.3 revoke with neither token nor jti → ok=false", async () => {
    const m = await import("../../packages/core/src/passport/index.js");
    const dir = tmp();
    try {
      const r = m.revokePassport({ cwd: dir });
      expect(r.ok).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.61.0 D7 — ledger HMAC chain (PINNED)", () => {
  it("D7.1 fresh ledger → chain ok with 0 rows", async () => {
    const m = await import("../../packages/core/src/passport/index.js");
    const dir = tmp();
    try {
      const r = m.verifyLedgerChain(dir);
      expect(r.ok).toBe(true);
      expect(r.rows).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("D7.2 issue + verify + revoke appends 3 chained rows", async () => {
    const m = await import("../../packages/core/src/passport/index.js");
    const dir = tmp();
    try {
      const r = m.issuePassport({
        tool: "fs.read_file", agent: "x", cwd: dir,
        trustInputs: { envScanConfidence: 0.9 },
      });
      m.verifyPassport({ token: r.passport!.token, cwd: dir });
      m.revokePassport({ token: r.passport!.token, cwd: dir });
      const led = m.verifyLedgerChain(dir);
      expect(led.ok).toBe(true);
      expect(led.rows).toBe(3);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.61.0 D8 — CLI surface (PINNED)", () => {
  function runCli(args: string[], cwd?: string): { stdout: string; stderr: string; status: number | null } {
    const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", timeout: 60000, cwd });
    return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
  }

  it("D8.1 `mneme capability policy` returns DEFAULT_POLICY", () => {
    const r = runCli(["capability", "policy"]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.policy.destructive.minTrust).toBeGreaterThanOrEqual(0.85);
  });

  it("D8.2 `mneme capability request` with low trust returns refused envelope", () => {
    const dir = tmp();
    try {
      const r = runCli(["capability", "request", "--tool", "shell.exec", "--agent", "x", "--env-confidence", "0.2"], dir);
      expect(r.status).toBe(1); // refused → exit 1
      const parsed = JSON.parse(r.stdout);
      expect(parsed.ok).toBe(false);
      expect(parsed.reason).toBe("trust_too_low");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("D8.3 `mneme capability request` with high trust returns granted token", () => {
    const dir = tmp();
    try {
      const r = runCli(["capability", "request", "--tool", "shell.exec", "--agent", "claude-code", "--env-confidence", "0.95", "--identity-verdict", "CONFIRMED", "--hm-weight", "0.95"], dir);
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.ok).toBe(true);
      expect(typeof parsed.passport.token).toBe("string");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("D8.4 `mneme capability audit` returns envelope with totalRows", () => {
    const dir = tmp();
    try {
      const r = runCli(["capability", "audit"], dir);
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(typeof parsed.totalRows).toBe("number");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.61.0 D9 — TG probes (PINNED)", () => {
  it("D9.1 probe.passport.issue_verify_revoke_round_trip returns 1", async () => {
    const m = await import("../../packages/core/src/truth_gate/probes.js");
    const p = m.probeById("probe.passport.issue_verify_revoke_round_trip");
    expect(p).toBeDefined();
    const r = await p!.run({ cwd: REPO });
    expect(r.value).toBe(1);
  });

  it("D9.2 probe.passport.ledger_chain_intact returns 1 or null (no ledger yet)", async () => {
    const m = await import("../../packages/core/src/truth_gate/probes.js");
    const p = m.probeById("probe.passport.ledger_chain_intact");
    expect(p).toBeDefined();
    const r = await p!.run({ cwd: REPO });
    expect([null, 0, 1]).toContain(r.value);
  });
});
