import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  issueKillSwitch, readKillSwitch, verifyKillSwitch, shouldRespond,
  recordAudit, verifyAuditChain, exportAuditReport,
  dlpScan, loadDlpRules, formatCompliancePulse,
} from "./index.js";

describe("v2.14 · KILL SWITCH PROTOCOL", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ks-")); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  describe("kill switch", () => {
    it("issue and read round-trip", () => {
      const d = issueKillSwitch({ state: "active", reason: "incident response", issuedBy: "ciso@x.com", repoDir: dir });
      expect(d.state).toBe("active");
      expect(d.sig).toMatch(/^[0-9a-f]{64}$/);
      const r = readKillSwitch({ repoDir: dir });
      expect(r?.sig).toBe(d.sig);
    });

    it("verifyKillSwitch passes for un-tampered directive", () => {
      const d = issueKillSwitch({ state: "active", reason: "test", issuedBy: "x", repoDir: dir });
      expect(verifyKillSwitch(d).ok).toBe(true);
    });

    it("verifyKillSwitch fails on tamper", () => {
      const d = issueKillSwitch({ state: "active", reason: "test", issuedBy: "x", repoDir: dir });
      const tampered = { ...d, reason: "TAMPERED" };
      expect(verifyKillSwitch(tampered).ok).toBe(false);
    });

    it("shouldRespond: no directive → allowed", () => {
      const r = shouldRespond({ repoDir: dir });
      expect(r.allowed).toBe(true);
    });

    it("shouldRespond: active kill → not allowed", () => {
      issueKillSwitch({ state: "active", reason: "test", issuedBy: "x", repoDir: dir });
      const r = shouldRespond({ repoDir: dir });
      expect(r.allowed).toBe(false);
    });

    it("shouldRespond: scoped kill respects vendor scope", () => {
      issueKillSwitch({ state: "scoped", reason: "test", issuedBy: "x", scopes: { vendors: ["chatgpt"] }, repoDir: dir });
      expect(shouldRespond({ vendor: "chatgpt", repoDir: dir }).allowed).toBe(false);
      expect(shouldRespond({ vendor: "claude", repoDir: dir }).allowed).toBe(true);
    });

    it("shouldRespond: expired kill → allowed again", () => {
      const past = new Date(Date.now() - 1000).toISOString();
      issueKillSwitch({ state: "active", reason: "test", issuedBy: "x", expiresAt: past, repoDir: dir });
      expect(shouldRespond({ repoDir: dir }).allowed).toBe(true);
    });

    it("shouldRespond: tampered directive is ignored (forge protection)", () => {
      issueKillSwitch({ state: "active", reason: "test", issuedBy: "x", repoDir: dir });
      // Tamper file directly
      const path = join(dir, ".mneme", "compliance", "kill_switch.json");
      const cur = JSON.parse(readFileSync(path, "utf8"));
      cur.reason = "FORGED kill";
      writeFileSync(path, JSON.stringify(cur));
      const r = shouldRespond({ repoDir: dir });
      expect(r.allowed).toBe(true);
      expect(r.reason).toContain("ignoring unverified");
    });

    it("issueKillSwitch records an audit entry", () => {
      issueKillSwitch({ state: "active", reason: "incident", issuedBy: "ciso@x.com", repoDir: dir });
      const report = exportAuditReport({ repoDir: dir });
      expect(report.entries.some((e) => e.kind === "kill_switch")).toBe(true);
    });
  });

  describe("audit log", () => {
    it("recordAudit appends signed entries", () => {
      const a = recordAudit({ kind: "prompt", actor: "claude", detail: "user asked X", repoDir: dir });
      expect(a.id).toMatch(/^a-/);
      expect(a.chainSig).toMatch(/^[0-9a-f]{64}$/);
    });

    it("verifyAuditChain ok on clean log", () => {
      recordAudit({ kind: "prompt", actor: "claude", detail: "x", repoDir: dir });
      recordAudit({ kind: "response", actor: "claude", detail: "y", repoDir: dir });
      recordAudit({ kind: "tool_call", actor: "claude", detail: "z", repoDir: dir });
      expect(verifyAuditChain({ repoDir: dir }).ok).toBe(true);
    });

    it("tampering breaks the chain", () => {
      recordAudit({ kind: "prompt", actor: "claude", detail: "x", repoDir: dir });
      recordAudit({ kind: "response", actor: "claude", detail: "y", repoDir: dir });
      const path = join(dir, ".mneme", "compliance", "audit.jsonl");
      const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.length > 0);
      const parsed = JSON.parse(lines[0]!);
      parsed.detail = "TAMPERED";
      lines[0] = JSON.stringify(parsed);
      writeFileSync(path, lines.join("\n") + "\n");
      const r = verifyAuditChain({ repoDir: dir });
      expect(r.ok).toBe(false);
      expect(r.brokenIndex).toBe(0);
    });

    it("exportAuditReport groups by kind + actor", () => {
      recordAudit({ kind: "prompt", actor: "claude", detail: "a", repoDir: dir });
      recordAudit({ kind: "prompt", actor: "claude", detail: "b", repoDir: dir });
      recordAudit({ kind: "response", actor: "claude", detail: "c", repoDir: dir });
      recordAudit({ kind: "prompt", actor: "chatgpt", detail: "d", repoDir: dir });
      const r = exportAuditReport({ repoDir: dir });
      expect(r.byKind.prompt).toBe(3);
      expect(r.byKind.response).toBe(1);
      expect(r.byActor.claude).toBe(3);
      expect(r.byActor.chatgpt).toBe(1);
      expect(r.chainOk).toBe(true);
    });
  });

  describe("DLP", () => {
    it("scans clean text → no hits", () => {
      const r = dlpScan("just a normal commit message about refactoring", { repoDir: dir });
      expect(r.hits).toHaveLength(0);
      expect(r.worstSeverity).toBe("none");
      expect(r.blocked).toBe(false);
    });

    it("blocks AWS Access Key", () => {
      const r = dlpScan("the key is AKIAIOSFODNN7EXAMPLE here", { repoDir: dir, actor: "claude" });
      expect(r.blocked).toBe(true);
      expect(r.hits.some((h) => h.ruleId === "aws-access-key")).toBe(true);
    });

    it("blocks GitHub PAT", () => {
      const r = dlpScan("token: ghp_abcdefghijklmnopqrstuvwxyz0123456789", { repoDir: dir });
      expect(r.blocked).toBe(true);
      expect(r.hits.some((h) => h.ruleId === "github-pat")).toBe(true);
    });

    it("blocks OpenAI sk- key", () => {
      const r = dlpScan("OPENAI_API_KEY=sk-abc123def456ghi789jkl012mno345pq", { repoDir: dir });
      expect(r.blocked).toBe(true);
    });

    it("blocks PEM private key block", () => {
      const r = dlpScan("-----BEGIN RSA PRIVATE KEY-----\nMIICstuff", { repoDir: dir });
      expect(r.blocked).toBe(true);
    });

    it("warns on email PII", () => {
      const r = dlpScan("contact me at user@example.com please", { repoDir: dir });
      expect(r.worstSeverity).toBe("warn");
      expect(r.blocked).toBe(false);
    });

    it("blocked scan creates a dlp_block audit entry", () => {
      dlpScan("AKIAIOSFODNN7EXAMPLE", { repoDir: dir, actor: "claude" });
      const report = exportAuditReport({ repoDir: dir });
      expect(report.entries.some((e) => e.kind === "dlp_block")).toBe(true);
    });

    it("loadDlpRules returns the built-in set", () => {
      const rules = loadDlpRules({ repoDir: dir });
      expect(rules.length).toBeGreaterThanOrEqual(8);
      expect(rules.some((r) => r.id === "aws-access-key")).toBe(true);
    });

    it("formatCompliancePulse summarises", () => {
      issueKillSwitch({ state: "scoped", reason: "test", issuedBy: "x", scopes: { vendors: ["x"] }, repoDir: dir });
      recordAudit({ kind: "prompt", actor: "claude", detail: "y", repoDir: dir });
      const line = formatCompliancePulse({ repoDir: dir });
      expect(line).toContain("COMPLIANCE");
      expect(line).toContain("kill=scoped");
      expect(line).toMatch(/audit=\d+/);
    });
  });
});
