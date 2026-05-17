import { describe, it, expect } from "vitest";
import {
  sniffMcpToolExact,
  sniffMcpFamilyCount,
  sniffMcpTotalCount,
  sniffVersion,
  sniffFilePath,
  sniffAllAssertions,
  forensicVerify,
  verifyForensicCertificate,
  classifyClaim,
  formatForensicLine,
  type ForensicCertificate,
} from "./index.js";

const SECRET = "truth-test-secret-99221144";

// Live catalog stub used across tests
const CATALOG = [
  "mneme.nexus.subscribe",
  "mneme.nexus.publish_observation",
  "mneme.nexus.drain",
  "mneme.nexus.ack",
  "mneme.confessional.audit",
  "mneme.ghost.distill",
  "mneme.inverse.audit",
];

describe("v2.19.15 TRUTH FORENSIC · sniffMcpToolExact", () => {
  it("extracts every mneme.X.Y mention from claim text, dedup", () => {
    const a = sniffMcpToolExact("ships mneme.nexus.subscribe and mneme.inverse.audit and mneme.nexus.subscribe again");
    expect(a.map((x) => (x.value as { toolName: string }).toolName).sort()).toEqual([
      "mneme.inverse.audit",
      "mneme.nexus.subscribe",
    ]);
  });

  it("ignores partial matches (mneme.X without action)", () => {
    const a = sniffMcpToolExact("mneme is great; mneme.nexus has tools");
    expect(a).toHaveLength(0);
  });

  it("handles snake_case actions", () => {
    const a = sniffMcpToolExact("mneme.nexus.publish_observation is registered");
    expect(a).toHaveLength(1);
    expect((a[0]!.value as { toolName: string }).toolName).toBe("mneme.nexus.publish_observation");
  });
});

describe("v2.19.15 TRUTH FORENSIC · sniffMcpFamilyCount", () => {
  it("extracts 'N mneme.X.* tools' pattern", () => {
    const a = sniffMcpFamilyCount("Mneme v2.19.14 registers 4 mneme.nexus.* MCP tools");
    expect(a).toHaveLength(1);
    expect((a[0]!.value as { family: string; expectedCount: number })).toEqual({ family: "nexus", expectedCount: 4 });
  });

  it("extracts 'registers N mneme.X.*' variant", () => {
    const a = sniffMcpFamilyCount("registers 3 mneme.inverse.* tools");
    expect(a).toHaveLength(1);
  });

  it("handles multiple families in one claim", () => {
    const a = sniffMcpFamilyCount("ships 5 mneme.nexus.* tools and 3 mneme.ghost.* tools");
    expect(a).toHaveLength(2);
    const fams = a.map((x) => (x.value as { family: string }).family).sort();
    expect(fams).toEqual(["ghost", "nexus"]);
  });
});

describe("v2.19.15 TRUTH FORENSIC · sniffMcpTotalCount", () => {
  it("extracts 'ships N MCP tools' pattern", () => {
    const a = sniffMcpTotalCount("Mneme ships 508 MCP tools");
    expect(a).toHaveLength(1);
    expect((a[0]!.value as { expectedCount: number })).toEqual({ expectedCount: 508 });
  });

  it("extracts 'N tools total' pattern", () => {
    const a = sniffMcpTotalCount("we have 100 tools total now");
    expect(a).toHaveLength(1);
  });

  it("returns empty array when no total-count claim present", () => {
    expect(sniffMcpTotalCount("Mneme ships proof and reverse")).toHaveLength(0);
  });
});

describe("v2.19.15 TRUTH FORENSIC · sniffVersion", () => {
  it("extracts versions of form vX.Y.Z and X.Y.Z", () => {
    const a = sniffVersion("Mneme v2.19.14 is the current release; previously 2.19.13 was live");
    const versions = a.map((x) => (x.value as { version: string }).version).sort();
    expect(versions).toContain("2.19.14");
    expect(versions).toContain("2.19.13");
  });
});

describe("v2.19.15 TRUTH FORENSIC · sniffFilePath", () => {
  it("extracts repo paths ending in .ts/.tsx/.js/.json/.md", () => {
    const a = sniffFilePath("see packages/core/src/foo.ts and tests/integration.test.ts plus scripts/build.mjs");
    const paths = a.map((x) => (x.value as { path: string }).path).sort();
    expect(paths).toContain("packages/core/src/foo.ts");
    expect(paths).toContain("tests/integration.test.ts");
    expect(paths).toContain("scripts/build.mjs");
  });
});

describe("v2.19.15 TRUTH FORENSIC · forensicVerify ACCEPTED path", () => {
  it("ACCEPTED when every sniff grounds: claim 'registers 4 mneme.nexus.* tools' on a catalog with 4", () => {
    const r = forensicVerify({
      claim: "Mneme v2.19.15 registers 4 mneme.nexus.* MCP tools",
      groundTruth: { mcpCatalog: CATALOG, installedVersion: "2.19.15" },
      secret: SECRET,
    });
    expect(r.verdict).toBe("ACCEPTED");
    expect(r.certificate.verdict).toBe("ACCEPTED");
    expect(r.assertions.some((a) => a.sub_verdict === "supported")).toBe(true);
    expect(verifyForensicCertificate(r.certificate, SECRET).ok).toBe(true);
  });

  it("ACCEPTED also includes the exact mneme.X.Y mentions in the claim (sniffMcpToolExact)", () => {
    const r = forensicVerify({
      claim: "Uses mneme.inverse.audit then mneme.confessional.audit; v2.19.15",
      groundTruth: { mcpCatalog: CATALOG, installedVersion: "2.19.15" },
      secret: SECRET,
    });
    expect(r.verdict).toBe("ACCEPTED");
    const toolKinds = r.assertions.filter((a) => a.kind === "mcp_tool_exact");
    expect(toolKinds.length).toBe(2);
    expect(toolKinds.every((a) => a.sub_verdict === "supported")).toBe(true);
  });
});

describe("v2.19.15 TRUTH FORENSIC · forensicVerify REJECTED path (the W2 kill)", () => {
  it("REJECTED when claim states wrong nexus count: 7 vs actual 4", () => {
    const r = forensicVerify({
      claim: "Mneme registers 7 mneme.nexus.* MCP tools",
      groundTruth: { mcpCatalog: CATALOG },
      secret: SECRET,
    });
    expect(r.verdict).toBe("REJECTED");
    expect(r.refutedAssertions.length).toBe(1);
    expect(r.refutedAssertions[0]!.evidence).toContain("not 7");
    // The killer: explanation surfaces the actual count
    expect(r.explanation).toContain("REJECTED");
  });

  it("REJECTED when claim mentions a tool that doesn't exist in the catalog", () => {
    const r = forensicVerify({
      claim: "ships mneme.nexus.subscribe and mneme.fictional.lie",
      groundTruth: { mcpCatalog: CATALOG },
      secret: SECRET,
    });
    expect(r.verdict).toBe("REJECTED");
    const refuted = r.refutedAssertions[0]!;
    expect(refuted.asserted).toContain("mneme.fictional.lie");
  });

  it("REJECTED when version claim mismatches installed version", () => {
    const r = forensicVerify({
      claim: "installed at v2.19.99",
      groundTruth: { installedVersion: "2.19.15" },
      secret: SECRET,
    });
    expect(r.verdict).toBe("REJECTED");
    expect(r.refutedAssertions[0]!.evidence).toContain("not 2.19.99");
  });

  it("REJECTED when file claim points at non-existent path", () => {
    const r = forensicVerify({
      claim: "see packages/core/src/imaginary.ts",
      groundTruth: { fileExists: (_p) => false },
      secret: SECRET,
    });
    expect(r.verdict).toBe("REJECTED");
  });

  it("REJECTED wins over supported assertions (any refutation is fatal)", () => {
    const r = forensicVerify({
      claim: "ships mneme.nexus.subscribe and registers 99 mneme.nexus.* tools",
      groundTruth: { mcpCatalog: CATALOG },
      secret: SECRET,
    });
    expect(r.verdict).toBe("REJECTED");
    // tool-exact assertion is supported, count assertion is refuted → still REJECTED
    expect(r.assertions.some((a) => a.sub_verdict === "supported")).toBe(true);
    expect(r.refutedAssertions.length).toBeGreaterThan(0);
  });
});

describe("v2.19.15 TRUTH FORENSIC · forensicVerify UNKNOWN path", () => {
  it("UNKNOWN when claim has no sniffable assertions", () => {
    const r = forensicVerify({
      claim: "the codebase is healthy and developer morale is high",
      groundTruth: { mcpCatalog: CATALOG },
      secret: SECRET,
    });
    expect(r.verdict).toBe("UNKNOWN");
    expect(r.untested).toBe(true);
    expect(r.explanation).toContain("UNKNOWN");
  });

  it("UNKNOWN when sniffed assertions can't be checked (missing ground truth)", () => {
    const r = forensicVerify({
      claim: "ships mneme.nexus.subscribe",
      groundTruth: {}, // no catalog
      secret: SECRET,
    });
    expect(r.verdict).toBe("UNKNOWN");
    expect(r.assertions[0]!.sub_verdict).toBe("untested");
  });

  it("externalRefutationsFound > 0 forces REJECTED even with no sniff", () => {
    const r = forensicVerify({
      claim: "the codebase is healthy",
      groundTruth: {},
      externalRefutationsFound: 3,
      secret: SECRET,
    });
    expect(r.verdict).toBe("REJECTED");
  });
});

describe("v2.19.15 TRUTH FORENSIC · certificate integrity", () => {
  it("certificate verifies against the same secret", () => {
    const r = forensicVerify({
      claim: "ships mneme.nexus.subscribe",
      groundTruth: { mcpCatalog: CATALOG },
      secret: SECRET,
    });
    expect(verifyForensicCertificate(r.certificate, SECRET).ok).toBe(true);
  });

  it("forged certificate (tampered claim) is rejected", () => {
    const r = forensicVerify({
      claim: "ships mneme.nexus.subscribe",
      groundTruth: { mcpCatalog: CATALOG },
      secret: SECRET,
    });
    const forged: ForensicCertificate = { ...r.certificate, claim: "evil-claim" };
    expect(verifyForensicCertificate(forged, SECRET).ok).toBe(false);
  });

  it("certificate fails to verify with a different secret", () => {
    const r = forensicVerify({
      claim: "ships mneme.nexus.subscribe",
      groundTruth: { mcpCatalog: CATALOG },
      secret: SECRET,
    });
    expect(verifyForensicCertificate(r.certificate, "wrong-secret").ok).toBe(false);
  });
});

describe("v2.19.15 TRUTH FORENSIC · classifyClaim + formatter + sniffAll", () => {
  it("classifyClaim reports number + classes of sniffed assertions", () => {
    const c = classifyClaim("v2.19.15 ships 4 mneme.nexus.* tools using mneme.inverse.audit");
    expect(c.assertionsExpected).toBeGreaterThan(0);
    expect(c.classes).toContain("mcp_tool_exact");
    expect(c.classes).toContain("mcp_family_count");
    expect(c.classes).toContain("version_exact");
  });

  it("sniffAllAssertions returns the union of all sniffers", () => {
    const all = sniffAllAssertions("v2.19.15 ships 4 mneme.nexus.* tools using mneme.inverse.audit in packages/core/src/foo.ts");
    expect(all.length).toBeGreaterThanOrEqual(4);
  });

  it("formatter line includes verdict + counts", () => {
    const r = forensicVerify({
      claim: "ships mneme.nexus.subscribe and mneme.nexus.drain",
      groundTruth: { mcpCatalog: CATALOG },
      secret: SECRET,
    });
    const line = formatForensicLine(r);
    expect(line).toContain("ACCEPTED");
    expect(line).toContain("sniffed=2");
  });
});

describe("v2.19.15 TRUTH FORENSIC · the exact W2 lie kill scenario", () => {
  it("kills the user's W2 example claim: 'Mneme v2.19.14 registers 4 mneme.nexus.* MCP tools' against ACTUAL catalog", () => {
    // Simulate the exact user complaint: at the time of the test in v2.19.6 the
    // catalog had 0 nexus tools (the bug). With current state we have 4 — claim
    // accurate now. But if anyone restates an outdated count, the pipeline catches it.
    const trueWith4 = forensicVerify({
      claim: "Mneme v2.19.14 registers 4 mneme.nexus.* MCP tools",
      groundTruth: { mcpCatalog: CATALOG, installedVersion: "2.19.14" },
      secret: SECRET,
    });
    expect(trueWith4.verdict).toBe("ACCEPTED");
    const lieWith7 = forensicVerify({
      claim: "Mneme v2.19.14 registers 7 mneme.nexus.* MCP tools",
      groundTruth: { mcpCatalog: CATALOG, installedVersion: "2.19.14" },
      secret: SECRET,
    });
    expect(lieWith7.verdict).toBe("REJECTED");
    expect(lieWith7.refutedAssertions[0]!.evidence).toMatch(/has 4 tools matching .* not 7/);
  });
});

// ─── v2.19.31 BUG #2 PARADOX TEST SUITE ────────────────────────────────
//
// PARADOX TESTING METHODOLOGY (innovation):
//   Unit tests with VALID input categories miss contradictions because each
//   input class is "correct" in isolation. PARADOX tests feed SELF-CONTRADICTING
//   input — claims that simultaneously assert X and NOT X — to verify the
//   pipeline REFUSES to issue a TRUSTWORTHY certificate on self-defeating
//   text. CI-permanent regression guard.

import { sniffNegativeAssertions, detectContradictions } from "./index.js";

describe("v2.19.31 BUG #2 PARADOX SUITE -- contradiction + self-refutation rejection", () => {
  it("PARADOX 1: 'file X exists AND file X does not exist' -> REJECTED with contradiction", () => {
    const r = forensicVerify({
      claim: "the file packages/core/src/index.ts exists AND the file packages/core/src/index.ts does not exist",
      groundTruth: { fileExists: () => true },
      secret: SECRET,
    });
    expect(r.verdict).toBe("REJECTED");
    expect(r.explanation).toContain("contradiction");
  });

  it("PARADOX 2: self-refutation 'This claim is REFUTED by mneme.truth.forensic' -> REJECTED", () => {
    const r = forensicVerify({
      claim: "This claim is REFUTED by mneme.truth.forensic",
      groundTruth: { mcpCatalog: ["mneme.truth.forensic"] },
      secret: SECRET,
    });
    expect(r.verdict).toBe("REJECTED");
    expect(r.explanation).toContain("contradiction");
  });

  it("PARADOX 3: tool exists AND not registered -> REJECTED", () => {
    const r = forensicVerify({
      claim: "mneme.ask.test is registered and mneme.ask.test is not registered",
      groundTruth: { mcpCatalog: ["mneme.ask.test"] },
      secret: SECRET,
    });
    expect(r.verdict).toBe("REJECTED");
  });

  it("PARADOX 4: 'no mneme.X.Y' phrase produces negative assertion", () => {
    const negs = sniffNegativeAssertions("no mneme.fake.tool in the catalog");
    expect(negs.length).toBeGreaterThan(0);
    expect(negs[0]!.direction).toBe("negative");
  });

  it("PARADOX 5: positive file_path coexisting with negative same path -> contradiction", () => {
    const all = sniffAllAssertions("packages/core/src/index.ts exists; file packages/core/src/index.ts does not exist either");
    const contradictions = detectContradictions(all);
    expect(contradictions.length).toBeGreaterThanOrEqual(1);
    expect(contradictions[0]!.kind).toBe("file_path");
  });

  it("PARADOX 6: 'no such file ...' detected as negative assertion", () => {
    const negs = sniffNegativeAssertions("no such file packages/imaginary/path.ts");
    expect(negs.length).toBeGreaterThan(0);
  });

  it("PARADOX 7: only positive assertions (no contradiction) -> ACCEPTED unaffected", () => {
    const r = forensicVerify({
      claim: "mneme.ask.cmd exists",
      groundTruth: { mcpCatalog: ["mneme.ask.cmd"] },
      secret: SECRET,
    });
    expect(r.verdict).toBe("ACCEPTED");
  });

  it("PARADOX 8: contradiction wins over ground-truth ACCEPT", () => {
    // Even if both halves of contradiction are individually grounded,
    // the contradiction guard rejects.
    const r = forensicVerify({
      claim: "mneme.ask.cmd is registered and mneme.ask.cmd is not registered",
      groundTruth: { mcpCatalog: ["mneme.ask.cmd"] },
      secret: SECRET,
    });
    expect(r.verdict).toBe("REJECTED");
  });

  it("PARADOX 9: detectContradictions returns empty on consistent claim", () => {
    const all = sniffAllAssertions("mneme.ask registered; mneme.why registered");
    const contradictions = detectContradictions(all);
    expect(contradictions.length).toBe(0);
  });

  it("PARADOX 10: 'tool is missing' / 'does not exist' both flagged negative", () => {
    const a = sniffNegativeAssertions("mneme.x.y is missing");
    const b = sniffNegativeAssertions("mneme.x.y does not exist");
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(a[0]!.direction).toBe("negative");
    expect(b[0]!.direction).toBe("negative");
  });
});
