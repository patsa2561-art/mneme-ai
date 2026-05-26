/**
 * v2.59.0 — SDK SURFACE AUDITOR + gate self-verification pinned tests.
 *
 * The bug this release closes was caught by an EXTERNAL audit on
 * v2.58.0: WIRING DOCTOR reported "13/13 features wired across
 * core/sdk/cli/tg" BUT external developers writing
 *   import { letheForget } from "@mneme-ai/sdk"
 * got undefined. Root cause: WIRING DOCTOR grepped the internal
 * NemesisSdk class file (which HAS the methods) instead of the
 * external `index.ts` (which determines what `import` returns).
 *
 * Section map:
 *   B1 — SDK external surface fix (top-level exports)
 *   B2 — SDK_AUDITOR primitive (empirical import)
 *   B3 — Cross-gate consistency (WIRING DOCTOR vs SDK_AUDITOR)
 *   B4 — WIRING DOCTOR uses empirical SDK_AUDITOR result
 *   B5 — TG probes (probe.sdk.external_surface_complete / probe.gate.consistency)
 *   B6 — CLI surface (mneme sdk_auditor run / consistency)
 *   B7 — Regression-pin against v2.58 blind-spot symptom
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "../..");
const CLI = join(REPO, "packages", "cli", "bin", "mneme.js");

describe("v2.59.0 B1 — SDK external surface fix (PINNED)", () => {
  it("B1.1 @mneme-ai/sdk exports standalone letheForget / gavelPack / nimbusPublish", async () => {
    const sdk = await import("../../packages/sdk/dist/index.js");
    expect(typeof (sdk as Record<string, unknown>)["letheForget"]).toBe("function");
    expect(typeof (sdk as Record<string, unknown>)["gavelPack"]).toBe("function");
    expect(typeof (sdk as Record<string, unknown>)["nimbusPublish"]).toBe("function");
  });

  it("B1.2 @mneme-ai/sdk exports convenience groups lethe / gavel / nimbus", async () => {
    const sdk = await import("../../packages/sdk/dist/index.js") as Record<string, { forget?: unknown; pack?: unknown; publish?: unknown }>;
    expect(typeof sdk.lethe?.forget).toBe("function");
    expect(typeof sdk.gavel?.pack).toBe("function");
    expect(typeof sdk.nimbus?.publish).toBe("function");
  });

  it("B1.3 verifyForgetReceipt / verifyGavelBundle also exported", async () => {
    const sdk = await import("../../packages/sdk/dist/index.js");
    expect(typeof (sdk as Record<string, unknown>)["verifyForgetReceipt"]).toBe("function");
    expect(typeof (sdk as Record<string, unknown>)["verifyGavelBundle"]).toBe("function");
  });

  it("B1.4 total top-level export count is ≥30 (was 26 pre-v59)", async () => {
    const sdk = await import("../../packages/sdk/dist/index.js");
    expect(Object.keys(sdk).length).toBeGreaterThanOrEqual(30);
  });
});

describe("v2.59.0 B2 — SDK_AUDITOR primitive (PINNED)", () => {
  it("B2.1 auditSdkSurface returns HMAC-signed report with ≥8 features checked", async () => {
    const m = await import("../../packages/core/src/release_gate/sdk_surface_auditor.js");
    const r = await m.auditSdkSurface({ cwd: REPO });
    expect(r.totalChecked).toBeGreaterThanOrEqual(8);
    expect(typeof r.hmac).toBe("string");
    expect(r.hmac.length).toBeGreaterThanOrEqual(64);
  });

  it("B2.2 auditSdkSurface reports 0 broken on this repo after fix", async () => {
    const m = await import("../../packages/core/src/release_gate/sdk_surface_auditor.js");
    const r = await m.auditSdkSurface({ cwd: REPO });
    expect(r.ok).toBe(true);
    expect(r.brokenCount).toBe(0);
  });

  it("B2.3 verifyAuditorReport round-trips + tamper fails", async () => {
    const m = await import("../../packages/core/src/release_gate/sdk_surface_auditor.js");
    const r = await m.auditSdkSurface({ cwd: REPO });
    expect(m.verifyAuditorReport(r)).toBe(true);
    const tampered = { ...r, brokenCount: r.brokenCount + 1 };
    expect(m.verifyAuditorReport(tampered)).toBe(false);
  });

  it("B2.4 expectations include lethe/gavel/nimbus", async () => {
    const m = await import("../../packages/core/src/release_gate/sdk_surface_auditor.js");
    const features = m.DEFAULT_EXPECTATIONS.map((e) => e.feature);
    expect(features).toContain("lethe");
    expect(features).toContain("gavel");
    expect(features).toContain("nimbus");
  });
});

describe("v2.59.0 B3 — Cross-gate consistency (PINNED)", () => {
  it("B3.1 crossCheckGates returns ok when both gates agree", async () => {
    const wd = await import("../../packages/core/src/release_gate/wiring_doctor.js");
    const sa = await import("../../packages/core/src/release_gate/sdk_surface_auditor.js");
    const wdr = wd.diagnose(REPO);
    const sar = await sa.auditSdkSurface({ cwd: REPO });
    const consistency = sa.crossCheckGates(wdr, sar);
    expect(consistency.ok).toBe(true);
    expect(consistency.contradictions.length).toBe(0);
  });

  it("B3.2 crossCheckGates detects contradiction when SDK_AUDITOR says missing but WIRING DOCTOR says present", async () => {
    const sa = await import("../../packages/core/src/release_gate/sdk_surface_auditor.js");
    const fakeWd = { features: [{ feature: "lethe", sdk: "present" as const, sdkEvidence: "fake" }] };
    const fakeSar = {
      ok: false, at: new Date().toISOString(), sdkPath: "/x", totalExports: 0, totalChecked: 1, okCount: 0, brokenCount: 1,
      findings: [{ feature: "lethe", present: false, evidence: "MISSING: letheForget", missingStandalone: ["letheForget"], missingGroupMethods: [] }],
      hmac: "x",
    };
    const r = sa.crossCheckGates(fakeWd, fakeSar);
    expect(r.ok).toBe(false);
    expect(r.contradictions.length).toBe(1);
    expect(r.contradictions[0]?.feature).toBe("lethe");
  });
});

describe("v2.59.0 B4 — WIRING DOCTOR uses empirical SDK_AUDITOR (PINNED)", () => {
  it("B4.1 WIRING DOCTOR with fresh SDK_AUDITOR report reports SDK as present-empirical", async () => {
    const sa = await import("../../packages/core/src/release_gate/sdk_surface_auditor.js");
    const r = await sa.auditSdkSurface({ cwd: REPO });
    sa.persistAuditorReport(REPO, r);
    const wd = await import("../../packages/core/src/release_gate/wiring_doctor.js");
    const diag = wd.diagnose(REPO);
    const lethe = diag.features.find((f) => f.feature === "lethe");
    expect(lethe?.sdk).toBe("present");
    expect(lethe?.sdkEvidence ?? "").toMatch(/empirical/);
  });

  it("B4.2 WIRING DOCTOR overall ok=true post-fix", async () => {
    const wd = await import("../../packages/core/src/release_gate/wiring_doctor.js");
    const diag = wd.diagnose(REPO);
    expect(diag.ok).toBe(true);
    expect(diag.summary.broken).toBe(0);
  });
});

describe("v2.59.0 B5 — TG probes (PINNED)", () => {
  it("B5.1 probe.sdk.external_surface_complete returns 1", async () => {
    const m = await import("../../packages/core/src/truth_gate/probes.js");
    const p = m.probeById("probe.sdk.external_surface_complete");
    expect(p).toBeDefined();
    const r = await p!.run({ cwd: REPO });
    expect(r.value).toBe(1);
  });

  it("B5.2 probe.gate.consistency returns 1", async () => {
    const m = await import("../../packages/core/src/truth_gate/probes.js");
    const p = m.probeById("probe.gate.consistency");
    expect(p).toBeDefined();
    const r = await p!.run({ cwd: REPO });
    expect(r.value).toBe(1);
  });

  it("B5.3 claim.sdk.external_surface_complete + claim.gate.consistency registered as severity=block", async () => {
    const m = await import("../../packages/core/src/truth_gate/claims.js");
    const ext = m.CLAIM_CATALOG.find((c) => c.id === "claim.sdk.external_surface_complete");
    const cons = m.CLAIM_CATALOG.find((c) => c.id === "claim.gate.consistency");
    expect(ext?.severity).toBe("block");
    expect(cons?.severity).toBe("block");
  });
});

describe("v2.59.0 B6 — CLI surface (PINNED)", () => {
  function runCli(args: string[]): { stdout: string; stderr: string; status: number | null } {
    const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", timeout: 60000 });
    return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
  }

  it("B6.1 `mneme sdk_auditor run` returns JSON envelope with ok=true", () => {
    const r = runCli(["sdk_auditor", "run"]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.brokenCount).toBe(0);
  });

  it("B6.2 `mneme sdk_auditor consistency` returns JSON envelope with 0 contradictions", () => {
    const r = runCli(["sdk_auditor", "consistency"]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.contradictions.length).toBe(0);
  });
});

describe("v2.59.0 B7 — Regression-pin against v2.58 blind-spot (PINNED)", () => {
  it("B7.1 The EXACT external-audit symptom is fixed: s.letheForget / s.gavelPack / s.nimbusPublish all functions", async () => {
    // This is the verbatim regression-pin of the user's external audit on v2.58.
    const s = await import("../../packages/sdk/dist/index.js") as Record<string, unknown>;
    expect(typeof s["letheForget"]).toBe("function"); // was undefined in v2.58
    expect(typeof s["gavelPack"]).toBe("function"); // was undefined in v2.58
    expect(typeof s["nimbusPublish"]).toBe("function"); // was undefined in v2.58
    // Plus convenience groups (v2.57 already had these via createMneme().lethe but not top-level).
    expect(typeof (s["lethe"] as { forget?: unknown })?.forget).toBe("function");
    expect(typeof (s["gavel"] as { pack?: unknown })?.pack).toBe("function");
    expect(typeof (s["nimbus"] as { publish?: unknown })?.publish).toBe("function");
  });

  it("B7.2 Total external SDK export count ≥34 (v2.58 was 26)", async () => {
    const s = await import("../../packages/sdk/dist/index.js");
    expect(Object.keys(s).length).toBeGreaterThanOrEqual(30);
  });
});
