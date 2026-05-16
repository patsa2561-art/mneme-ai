/**
 * v2.19.16 FEDERATED TRUTH GRAVITY — 5 MCP tools (the network-effect moat).
 *
 *   mneme.federated.identity      — derive stable pseudonymous instance id
 *   mneme.federated.attest        — sign a public-fact attestation
 *   mneme.federated.verify        — HMAC-verify an external attestation
 *   mneme.federated.quorum        — cross-instance quorum verdict
 *   mneme.federated.gravity       — truth-gravity score for an observation
 *
 * Network transport is intentionally OUT OF SCOPE — the protocol is
 * transport-agnostic so existing v2.13 MESH / v2.18 NEXUS layers can
 * carry the JSON envelopes.
 */

import type { MnemeTool } from "./_types.js";

export const federatedIdentityTool: MnemeTool = {
  name: "mneme.federated.identity",
  category: "audit",
  description:
    "🌌 FEDERATED — derive a stable PSEUDONYMOUS instance identity from (vendor, sessionId, repoPath, seed). Same inputs → same id; no PII; safe to publish.",
  whenToUse: "First-time setup, or when an AI agent needs to sign attestations on behalf of this Mneme instance.",
  triggers: ["federated identity", "instance id"],
  inputSchema: {
    type: "object",
    properties: {
      vendor: { type: "string" },
      sessionId: { type: "string" },
      repoPath: { type: "string" },
      seed: { type: "string" },
    },
    required: ["vendor"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Get my Mneme instance id", args: { vendor: "claude-opus-4-7", sessionId: "s1", repoPath: "/repo/x" }, expectedOutput: "{ id, shortHash, vendor }" }],
  pitfalls: ["Identity is deterministic — same inputs always yield same id. Changing any input changes the id."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const id = core.federatedTruth.createInstanceIdentity({
      vendor: String(args["vendor"]),
      sessionId: args["sessionId"] as string | undefined,
      repoPath: args["repoPath"] as string | undefined,
      seed: args["seed"] as string | undefined,
    });
    return { data: id, wisdom: `🌌 ${id.shortHash} (vendor=${id.vendor})`, confidence: { level: "high" } };
  },
};

export const federatedAttestTool: MnemeTool = {
  name: "mneme.federated.attest",
  category: "audit",
  description:
    "🌌 FEDERATED — sign an HMAC attestation about a PUBLIC fact (npm package shasum, git commit hash, version string, etc.). Throws if claimType is not in the discoverable allow-list (the safety boundary preventing private code leaks).",
  whenToUse: "After observing a public artifact's identity (npm shasum, git sha). Share the envelope on the mesh so other instances can cross-attest.",
  triggers: ["federated attest", "sign attestation"],
  inputSchema: {
    type: "object",
    properties: {
      identity: { type: "object" },
      claimType: { type: "string", enum: ["npm_package_shasum", "npm_package_latest_version", "git_commit_exists", "github_release_tag", "mneme_self_catalog_count", "ecosystem_advisory"] },
      subject: { type: "string" },
      observation: { type: "string" },
    },
    required: ["identity", "claimType", "subject", "observation"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Attest that mneme-ai@2.19.16 has shasum=abc", args: { identity: {}, claimType: "npm_package_shasum", subject: "mneme-ai@2.19.16", observation: "shasum:abc" }, expectedOutput: "{ attestationId, signer, hmac, ... }" }],
  pitfalls: ["Only 6 discoverable claim types are allowed; anything else throws. This prevents accidental private-code leaks through federation."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const att = core.federatedTruth.attestPublicClaim({
      identity: args["identity"] as Parameters<typeof core.federatedTruth.attestPublicClaim>[0]["identity"],
      claimType: args["claimType"] as Parameters<typeof core.federatedTruth.attestPublicClaim>[0]["claimType"],
      subject: String(args["subject"]),
      observation: String(args["observation"]),
    });
    return { data: att, wisdom: `🌌 attested ${att.subject} → ${att.observation.slice(0, 40)} (id=${att.attestationId})`, confidence: { level: "high" } };
  },
};

export const federatedVerifyTool: MnemeTool = {
  name: "mneme.federated.verify",
  category: "audit",
  description:
    "🌌 FEDERATED — HMAC-verify an external attestation. Catches forged attestations + claimType-allow-list violations.",
  whenToUse: "Before trusting an attestation received from the mesh.",
  triggers: ["federated verify", "verify attestation"],
  inputSchema: { type: "object", properties: { attestation: { type: "object" } }, required: ["attestation"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is this attestation real?", args: { attestation: {} }, expectedOutput: "{ ok, reason? }" }],
  pitfalls: ["Verifies signature + claimType allow-list. Does NOT confirm the OBSERVATION is true — that's what quorum is for."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.federatedTruth.verifyAttestation(
      args["attestation"] as Parameters<typeof core.federatedTruth.verifyAttestation>[0],
    );
    return { data: r, wisdom: r.ok ? "🌌 attestation VALID" : `❌ ${r.reason}`, confidence: { level: "high" } };
  },
};

export const federatedQuorumTool: MnemeTool = {
  name: "mneme.federated.quorum",
  category: "audit",
  description:
    "🌌 FEDERATED — cross-instance quorum verdict. Aggregates verified attestations from N peers for the same (claimType, subject) tuple. Bands: unanimous / supermajority / majority / minority / conflict / orphan. Forged peers auto-dropped; one-vote-per-signer (last-write-wins).",
  whenToUse: "When the verify pipeline needs to upgrade local truth to cross-instance shared truth.",
  triggers: ["federated quorum", "cross-instance verify"],
  inputSchema: {
    type: "object",
    properties: {
      mine: { type: "object" },
      peers: { type: "array", items: { type: "object" } },
      threshold: { type: "number" },
    },
    required: ["mine", "peers"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Quorum on this attestation", args: { mine: {}, peers: [], threshold: 3 }, expectedOutput: "{ verdict, observedValues, supportingCount, conflictingCount }" }],
  pitfalls: ["Verdict is correlation across observers, NOT causation. Quorum 'unanimous' on a wrong observation is still wrong — pair with mneme.truth.forensic for ground truth where possible."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.federatedTruth.crossAttestQuorum({
      mine: args["mine"] as Parameters<typeof core.federatedTruth.crossAttestQuorum>[0]["mine"],
      peers: (args["peers"] as Parameters<typeof core.federatedTruth.crossAttestQuorum>[0]["peers"]) ?? [],
      threshold: args["threshold"] as number | undefined,
    });
    return { data: r, wisdom: core.federatedTruth.formatQuorumLine(r), confidence: { level: "high" } };
  },
};

export const federatedGravityTool: MnemeTool = {
  name: "mneme.federated.gravity",
  category: "audit",
  description:
    "🌌 FEDERATED — truth-gravity score (0..100) for a (claimType, subject, observation) tuple across N attestations. Grows with peer count, decays with age via 90-day half-life so dead instances don't keep weight forever.",
  whenToUse: "Rank competing observations by their cross-instance support; surface the gravitationally-heaviest answer to the user.",
  triggers: ["federated gravity", "truth gravity"],
  inputSchema: {
    type: "object",
    properties: {
      claimType: { type: "string" },
      subject: { type: "string" },
      observation: { type: "string" },
      attestations: { type: "array" },
      saturationCount: { type: "number" },
    },
    required: ["claimType", "subject", "observation", "attestations"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What's the gravity on this observation?", args: { claimType: "npm_package_shasum", subject: "mneme-ai@2.19.16", observation: "shasum:abc", attestations: [] }, expectedOutput: "{ score, effectiveWeight, contributingSigners }" }],
  pitfalls: ["Score is correlation, not truth — 100 peers agreeing on a wrong observation is still wrong. Pair with mneme.truth.forensic for ground-truth checking."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.federatedTruth.truthGravityScore({
      claimType: args["claimType"] as Parameters<typeof core.federatedTruth.truthGravityScore>[0]["claimType"],
      subject: String(args["subject"]),
      observation: String(args["observation"]),
      attestations: (args["attestations"] as Parameters<typeof core.federatedTruth.truthGravityScore>[0]["attestations"]) ?? [],
      saturationCount: args["saturationCount"] as number | undefined,
    });
    return { data: r, wisdom: core.federatedTruth.formatGravityLine(r), confidence: { level: "high" } };
  },
};

export const V1916_FEDERATED_TRUTH_TOOLS: MnemeTool[] = [
  federatedIdentityTool, federatedAttestTool, federatedVerifyTool,
  federatedQuorumTool, federatedGravityTool,
];
