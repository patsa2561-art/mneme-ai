import { describe, it, expect } from "vitest";
import { createGovernor, GovernanceBlocked } from "./index.js";
import { agentcert, notary } from "@mneme-ai/core";

describe("@mneme-ai/sdk governance — the 5-line drop-in", () => {
  it("end-to-end: wrap → block destructive → sign → verify offline", async () => {
    let t = 1000;
    const gov = createGovernor({ agent: "Grok", task: "refactor auth", run: "sdk1", now: () => t++, onNeedsApproval: async () => "allow" as const });
    const run = gov.guard(async (_tool: string, _args: unknown) => "executed");

    expect(await run("get_weather", { city: "x" })).toBe("executed");        // non-sensitive → allow → runs
    await expect(run("bash", { command: "rm -rf /" })).rejects.toBeInstanceOf(GovernanceBlocked);  // blocked → never runs
    expect(await run("http_request", { url: "https://api.x" })).toBe("executed");  // sensitive → escalated → human allows → runs

    const signed = gov.sign() as { payload?: { cert?: agentcert.AgentRunCertificate; evidence?: agentcert.RunEvidence } };
    // signature is valid + offline-verifiable
    const sig = notary.verifyReceipt(signed);
    expect(sig.valid).toBe(true);
    // the embedded cert re-derives from its evidence (prove-not-claim)
    const v = agentcert.verifyCertificate(signed.payload!.cert!, signed.payload!.evidence!);
    expect(v.valid).toBe(true);
    expect(signed.payload!.cert!.summary.blocked).toBe(1);
    expect(signed.payload!.cert!.summary.humanApprovals).toBe(1);
    expect(gov.selfVerify().valid).toBe(true);
  });
});
