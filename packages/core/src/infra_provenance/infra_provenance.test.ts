import { describe, it, expect } from "vitest";
import { infraProvenanceGauntlet, captureInfra, infraDrift, dataResidencyCheck } from "./index.js";
describe("INFRA PROVENANCE", () => {
  it("MEASURED: infraProvenanceGauntlet = 100", () => { const g = infraProvenanceGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass)); expect(g.score).toBe(100); });
  it("catches a mid-run migration GCP-eu → AWS-us", () => {
    const a = captureInfra({ env: { K_SERVICE: "s", CLOUD_RUN_REGION: "europe-west1" }, host: "h", platform: "linux", arch: "x64" }, 1);
    const b = captureInfra({ env: { AWS_REGION: "us-east-1" }, host: "h2", platform: "linux", arch: "x64" }, 2);
    expect(infraDrift(a, b).drifted).toBe(true);
    expect(dataResidencyCheck(a, ["eu-", "europe-"]).compliant).toBe(true);
    expect(dataResidencyCheck(b, ["eu-", "europe-"]).compliant).toBe(false);
  });
});
