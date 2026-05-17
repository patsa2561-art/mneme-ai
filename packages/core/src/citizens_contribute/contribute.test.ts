import { describe, it, expect } from "vitest";
import {
  packContribution, verifyContribution, emitContributionFile, previewContribution,
  deriveDeviceFingerprint, computeContributeStats, formatContributeLine,
  CITIZENS_CONTRIBUTE_TUNABLES,
} from "./index.js";
import { mintProtocolReceipt } from "../mneme_receipt_protocol/index.js";

const SECRET = "contribute-test-77";

describe("v2.19.38 CITIZENS CONTRIBUTE — pack + verify", () => {
  it("packContribution produces signed envelope with anonymised receipts", () => {
    const receipts = [
      mintProtocolReceipt({ vendor: "claude", modelVersion: "opus", tsMs: Date.UTC(2026, 4, 1) }),
      mintProtocolReceipt({ vendor: "gpt", modelVersion: "4o", tsMs: Date.UTC(2026, 4, 15) }),
    ];
    const env = packContribution({ receipts, installId: "abc", secret: SECRET });
    expect(env.quarter).toBe("2026-Q2");
    expect(env.count).toBe(2);
    expect(env.receipts.length).toBe(2);
    expect(env.sig).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyContribution(env, SECRET)).toBe(true);
  });

  it("PII stripped from envelope receipts (anonymised)", () => {
    const r = mintProtocolReceipt({ vendor: "claude", modelVersion: "x", tsMs: Date.UTC(2026, 4, 1), promptText: "secret_password=abc123" });
    const env = packContribution({ receipts: [r], installId: "abc", secret: SECRET });
    // No PII should appear in any anonymised receipt
    for (const ar of env.receipts) {
      expect(ar).not.toHaveProperty("promptSha256");
      expect(ar).not.toHaveProperty("filesTouched");
      expect(JSON.stringify(ar)).not.toContain("secret_password");
    }
  });

  it("DETERMINISTIC: same inputs → same envelope bytes (idempotence)", () => {
    const r = mintProtocolReceipt({ vendor: "x", modelVersion: "y", tsMs: Date.UTC(2026, 4, 1) });
    const env1 = packContribution({ receipts: [r], installId: "abc", packedAtMs: 1_700_000_000_000, secret: SECRET });
    const env2 = packContribution({ receipts: [r], installId: "abc", packedAtMs: 1_700_000_000_000, secret: SECRET });
    expect(env1.sig).toBe(env2.sig);
  });

  it("DEDUPE: identical anonymised receipts collapse to 1", () => {
    const r1 = mintProtocolReceipt({ vendor: "claude", modelVersion: "x", tsMs: Date.UTC(2026, 4, 1, 12, 0, 0) });
    const r2 = mintProtocolReceipt({ vendor: "claude", modelVersion: "x", tsMs: Date.UTC(2026, 4, 1, 14, 0, 0) }); // same day
    // Force identical content: same tokens/cost/outcome/vaccines
    const env = packContribution({ receipts: [r1, r2], installId: "abc", secret: SECRET });
    // Both anonymise to same dayBucket + same content → same anonymizedId → dedupe to 1
    expect(env.count).toBe(1);
  });

  it("WINDOW filter: receipts outside window dropped", () => {
    const r1 = mintProtocolReceipt({ vendor: "x", modelVersion: "y", tsMs: Date.UTC(2026, 4, 1) }); // Q2
    const r2 = mintProtocolReceipt({ vendor: "x", modelVersion: "y", tsMs: Date.UTC(2026, 8, 1) }); // Q3
    const env = packContribution({
      receipts: [r1, r2], installId: "abc",
      windowStartMs: Date.UTC(2026, 3, 1),
      windowEndMs: Date.UTC(2026, 5, 30),
      secret: SECRET,
    });
    expect(env.count).toBe(1);
  });

  it("verifyContribution REJECTS tampered envelopes", () => {
    const r = mintProtocolReceipt({ vendor: "x", modelVersion: "y", tsMs: Date.UTC(2026, 4, 1) });
    const env = packContribution({ receipts: [r], installId: "abc", secret: SECRET });
    const tampered = { ...env, count: 999 };
    expect(verifyContribution(tampered, SECRET)).toBe(false);
  });
});

describe("v2.19.38 CITIZENS CONTRIBUTE — deviceFingerprint", () => {
  it("DETERMINISTIC: same installId + secret → same fingerprint", () => {
    expect(deriveDeviceFingerprint("install-abc", SECRET)).toBe(deriveDeviceFingerprint("install-abc", SECRET));
  });

  it("DIFFERENT installId → DIFFERENT fingerprint", () => {
    expect(deriveDeviceFingerprint("abc", SECRET)).not.toBe(deriveDeviceFingerprint("xyz", SECRET));
  });

  it("DIFFERENT secret → DIFFERENT fingerprint (privacy)", () => {
    expect(deriveDeviceFingerprint("abc", "s1")).not.toBe(deriveDeviceFingerprint("abc", "s2"));
  });

  it("DEFENSIVE: empty installId → safe fallback", () => {
    expect(deriveDeviceFingerprint("", SECRET).length).toBeGreaterThan(0);
  });
});

describe("v2.19.38 CITIZENS CONTRIBUTE — file path + preview", () => {
  it("emitContributionFile produces deterministic path + commit message", () => {
    const r = mintProtocolReceipt({ vendor: "claude", modelVersion: "x", tsMs: Date.UTC(2026, 4, 1) });
    const env = packContribution({ receipts: [r], installId: "abc", secret: SECRET });
    const file = emitContributionFile(env);
    expect(file.path).toMatch(/^2026-Q2\/[a-zA-Z0-9_-]+-\d+\.json$/);
    expect(file.commitMessage).toContain("citizens(2026-Q2)");
    expect(file.branchHint).toContain("citizens/2026-Q2");
  });

  it("path-traversal safety: weird installId stripped", () => {
    const r = mintProtocolReceipt({ vendor: "x", modelVersion: "y", tsMs: Date.UTC(2026, 4, 1) });
    const env = packContribution({ receipts: [r], installId: "../../etc/passwd", secret: SECRET });
    const file = emitContributionFile(env);
    expect(file.path).not.toContain("..");
    expect(file.path).not.toContain("/etc/");
  });

  it("previewContribution shows vendor breakdown + estimated URL", () => {
    const rs = [
      mintProtocolReceipt({ vendor: "claude", modelVersion: "x", tsMs: Date.UTC(2026, 4, 1) }),
      mintProtocolReceipt({ vendor: "gpt", modelVersion: "y", tsMs: Date.UTC(2026, 4, 2) }),
      mintProtocolReceipt({ vendor: "gpt", modelVersion: "z", tsMs: Date.UTC(2026, 4, 3) }),
    ];
    const env = packContribution({ receipts: rs, installId: "abc", secret: SECRET });
    const preview = previewContribution(env);
    expect(preview.count).toBeGreaterThanOrEqual(2);
    expect(preview.quarter).toBe("2026-Q2");
    expect(preview.estimatedRepoUrl).toContain("github.com/mneme-ai/citizens-audit");
  });
});

describe("v2.19.38 CITIZENS CONTRIBUTE — A/B + 1000-iter fuzz", () => {
  it("A/B: pre-v2.19.38 = no contribution pipeline; post = signed envelope ready to push", () => {
    const r = mintProtocolReceipt({ vendor: "x", modelVersion: "y", tsMs: Date.UTC(2026, 4, 1) });
    const env = packContribution({ receipts: [r], installId: "abc", secret: SECRET });
    expect(env.sig).toBeTruthy();
    expect(emitContributionFile(env).path).toBeTruthy();
  });

  it("1000 random pack+verify cycles never crash", () => {
    for (let i = 0; i < 1000; i++) {
      const r = mintProtocolReceipt({
        vendor: `v${i % 7}`, modelVersion: `m${i % 4}`,
        tsMs: Date.UTC(2026, 4, 1) + (i % 60) * 86400000,
        tokensIn: i, tokensOut: i * 2, costUsdMicros: i * 10,
      });
      const env = packContribution({ receipts: [r], installId: `install-${i}`, secret: SECRET });
      expect(verifyContribution(env, SECRET)).toBe(true);
    }
  });

  it("computeContributeStats aggregates envelopes", () => {
    const envs = [];
    for (let i = 0; i < 5; i++) {
      const r = mintProtocolReceipt({ vendor: "x", modelVersion: "y", tsMs: Date.UTC(2026, 4, 1) });
      envs.push(packContribution({ receipts: [r], installId: `i${i}`, secret: SECRET }));
    }
    const s = computeContributeStats(envs);
    expect(s.totalEnvelopes).toBe(5);
    expect(s.uniqueDevices).toBe(5);
    expect(formatContributeLine(s)).toContain("CITIZENS");
  });

  it("DEFAULT_PUBLIC_REPO points to canonical citizens-audit repo", () => {
    expect(CITIZENS_CONTRIBUTE_TUNABLES.DEFAULT_PUBLIC_REPO).toContain("citizens-audit");
  });
});
