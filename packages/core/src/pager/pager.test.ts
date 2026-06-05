import { describe, it, expect } from "vitest";
import { mintApprovalRequest, verifyApproval, emptyTrust, updateTrust, decide, deadmanResolve, buildReceipt, pagerGauntlet, type Pending } from "./index.js";

const now = 1_700_000_000_000;

describe("COSMIC PAGER — approve from your phone; signed authority; self-tuning; dead-man", () => {
  it("authority is bound to the exact command, one-time, TTL'd", () => {
    const req = mintApprovalRequest({ rawCommand: "npm test", summary: "tests", agent: "cursor", session: "s", klass: "npm", blast: "safe", nonce: "N", now });
    expect(verifyApproval(req, { nonce: "N", commandHash: req.commandHash, agent: "cursor", session: "s" }, now + 1000, false).ok).toBe(true);
    expect(verifyApproval(req, { nonce: "N", commandHash: "deadbeef", agent: "cursor", session: "s" }, now + 1000, false).ok).toBe(false); // wrong command
    expect(verifyApproval(req, { nonce: "N", commandHash: req.commandHash, agent: "cursor", session: "s" }, now + 1000, true).ok).toBe(false); // replay
    expect(verifyApproval(req, { nonce: "N", commandHash: req.commandHash, agent: "cursor", session: "s" }, now + 10 * 60_000, false).ok).toBe(false); // expired
  });
  it("Trust-Tide: destructive is capped even when 'trusted'; proven-safe graduates", () => {
    let t = emptyTrust(); for (let k = 0; k < 30; k++) t = updateTrust(t, "rm", "approved");
    const dest = mintApprovalRequest({ rawCommand: "rm -rf x", summary: "", agent: "a", session: "s", klass: "rm", blast: "destructive", nonce: "n", now });
    expect(decide(dest, t).action).toBe("PAGE_THEN_DENY"); // hard ceiling
    let safe = emptyTrust(); for (let k = 0; k < 12; k++) safe = updateTrust(safe, "npm", "approved");
    const sreq = mintApprovalRequest({ rawCommand: "npm test", summary: "", agent: "a", session: "s", klass: "npm", blast: "safe", nonce: "n", now });
    expect(decide(sreq, safe).action).toBe("AUTO_ALLOW");
  });
  it("dead-man: safe auto-allows, destructive auto-denies, moderate waits", () => {
    const p: Pending[] = [
      { req: mintApprovalRequest({ rawCommand: "a", summary: "", agent: "a", session: "s", klass: "k", blast: "safe", nonce: "1", now }), status: "pending", lane: "productive" },
      { req: mintApprovalRequest({ rawCommand: "b", summary: "", agent: "a", session: "s", klass: "k", blast: "destructive", nonce: "2", now }), status: "pending", lane: "failsafe" },
      { req: mintApprovalRequest({ rawCommand: "c", summary: "", agent: "a", session: "s", klass: "k", blast: "moderate", nonce: "3", now }), status: "pending", lane: "conservative" },
    ];
    const r = deadmanResolve(p, now + 10 * 60_000);
    expect(r.resolved.find((x) => x.decision === "allow")).toBeTruthy();
    expect(r.resolved.find((x) => x.decision === "deny")).toBeTruthy();
    expect(r.stillPending.length).toBe(1);
  });
  it("receipt binds the decision (court-admissible)", () => {
    const req = mintApprovalRequest({ rawCommand: "x", summary: "", agent: "a", session: "s", klass: "k", blast: "safe", nonce: "n", now });
    const a = buildReceipt(req, "allow", "human", "telegram", "conservative", now);
    expect(a.commandHash).toBe(req.commandHash);
    expect(buildReceipt(req, "deny", "human", "telegram", "conservative", now).receiptHash).not.toBe(a.receiptHash);
  });
  it("MEASURED: pagerGauntlet = 100", () => {
    const g = pagerGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass));
    expect(g.score).toBe(100);
  });
});
