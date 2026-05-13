import { describe, it, expect } from "vitest";
import { renderManifestMarkdown, renderManifestPlain, renderLiveStateMarkdown } from "../agent_manifest.js";

describe("v2.4 LEXICON writer-routing · agent_manifest", () => {
  it("renderManifestMarkdown auto-tunes risky vocabulary", () => {
    const md = renderManifestMarkdown(undefined, "2.4.0");
    // After tuneForVendorArtifact (anthropic profile), "killswitch"
    // becomes "shutdown-handshake" and "attack-log" becomes "event-log".
    expect(md).not.toMatch(/\bkillswitch\b/);
    expect(md).not.toMatch(/\battack-log\b/);
  });

  it("renderManifestPlain auto-tunes risky vocabulary", () => {
    const plain = renderManifestPlain(undefined, "2.4.0");
    expect(plain).not.toMatch(/\bkillswitch\b/);
    expect(plain).not.toMatch(/\battack-log\b/);
  });

  it("renderLiveStateMarkdown returns a string (smoke)", () => {
    const out = renderLiveStateMarkdown({ mnemeVersion: "2.4.0", daemonRunning: true, vaccines: 8 });
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });
});
