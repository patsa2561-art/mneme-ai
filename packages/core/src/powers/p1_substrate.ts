/**
 * POWER 1 — SUBSTRATE INDEPENDENCE (v1.48.0)
 *
 * Mneme PROTOCOL is the abstract spec. Mneme IMPLEMENTATION is one
 * concrete realization (TypeScript + Node today). The protocol must
 * outlive any implementation -- the moment quantum / neuromorphic /
 * AGI / BCI computing stops being science fiction, the impl needs to
 * port without breaking the network. This module formalizes the spec
 * as data so any future reference implementation can self-validate
 * against the same contract today's TS/Node impl satisfies.
 *
 * IDEA-CHEST FOUND ALONG THE WAY:
 *   - PROTOCOL_VERSION + capability bits are wire-format-agnostic.
 *     A Q# port could declare its capability bitmap and we'd know
 *     instantly which features it covers.
 *   - validateImplementation() returns a deterministic conformance
 *     report any auditor can re-derive offline.
 */

export const MNEME_PROTOCOL_VERSION = "1.0.0";

/**
 * The CAPABILITY surface Mneme implementations declare. The spec is a
 * bitmap of capabilities -- every conforming impl declares which it
 * provides; clients can negotiate the intersection.
 */
export const PROTOCOL_CAPABILITIES = [
  "chromosome.read",
  "chromosome.write",
  "chromosome.encrypt",
  "pulse.render",
  "pulse.preexecutor",
  "nucleus.tick",
  "nucleus.daemon",
  "aletheia.score",
  "aletheia.badge",
  "vaccine.deposit",
  "vaccine.scan",
  "soul.session",
  "soul.handshake",
  "consent.grant",
  "consent.revoke",
  "replay.append",
  "replay.verify",
  "lineage.spore",
  "lineage.mendel",
  "genome.publish",
  "genome.vote",
  "wisdompack.create",
  "wisdompack.inherit",
  "mesh.gossip",
  "lingua.stream",
] as const;

export type ProtocolCapability = (typeof PROTOCOL_CAPABILITIES)[number];

/** What a conforming implementation must declare. */
export interface ImplementationManifest {
  name: string;                    // e.g. "mneme-ai" / "mneme-q#" / "mneme-rust"
  version: string;
  protocolVersion: string;         // must match MNEME_PROTOCOL_VERSION
  substrate: "ts-node" | "rust" | "go" | "python" | "csharp" | "qsharp" | "neural" | "wasm" | "other";
  capabilities: ProtocolCapability[];
  optional?: ProtocolCapability[];
  homepage?: string;
}

export interface ConformanceReport {
  implementation: string;
  protocolVersion: string;
  conforming: boolean;
  reason: string;
  declared: ProtocolCapability[];
  missing: ProtocolCapability[];
  extra: string[];                 // capabilities declared but not in the spec
}

/**
 * The reference implementation (this TS/Node package) declares its
 * own manifest here. Future ports paste-and-edit this constant.
 */
export const REFERENCE_IMPL_MANIFEST: ImplementationManifest = {
  name: "@mneme-ai/core",
  version: "1.48.0",
  protocolVersion: MNEME_PROTOCOL_VERSION,
  substrate: "ts-node",
  capabilities: [...PROTOCOL_CAPABILITIES],   // reference impl provides ALL
  homepage: "https://github.com/patsa2561-art/mneme-ai",
};

/**
 * Validate any implementation manifest against the spec. A non-conforming
 * impl can still INTEROPERATE on the capabilities it does provide -- the
 * report just makes the gap explicit.
 */
export function validateImplementation(impl: ImplementationManifest): ConformanceReport {
  const declared = new Set(impl.capabilities);
  const required = new Set(PROTOCOL_CAPABILITIES);
  const missing: ProtocolCapability[] = PROTOCOL_CAPABILITIES.filter((c) => !declared.has(c));
  const extra: string[] = impl.capabilities.filter((c) => !required.has(c as ProtocolCapability));

  let conforming = true;
  let reason = "all capabilities present + protocol versions match";
  if (impl.protocolVersion !== MNEME_PROTOCOL_VERSION) {
    conforming = false;
    reason = `protocol version mismatch (impl=${impl.protocolVersion}, spec=${MNEME_PROTOCOL_VERSION})`;
  } else if (missing.length > 0) {
    conforming = false;
    reason = `${missing.length} required capabilities missing: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "..." : ""}`;
  }

  return {
    implementation: impl.name,
    protocolVersion: impl.protocolVersion,
    conforming,
    reason,
    declared: Array.from(declared) as ProtocolCapability[],
    missing,
    extra,
  };
}

/**
 * The spec itself, as a portable JSON document. Future ports import
 * this at build time to know exactly what they must implement.
 */
export interface ExportedSpec {
  protocolVersion: string;
  capabilities: string[];
  manifestSchema: Record<string, string>;
}

export function exportSpec(): ExportedSpec {
  return {
    protocolVersion: MNEME_PROTOCOL_VERSION,
    capabilities: [...PROTOCOL_CAPABILITIES],
    manifestSchema: {
      name: "string -- impl id (e.g. mneme-q#)",
      version: "string -- impl semver",
      protocolVersion: `string -- must equal ${MNEME_PROTOCOL_VERSION}`,
      substrate: "ts-node|rust|go|python|csharp|qsharp|neural|wasm|other",
      capabilities: "string[] -- subset of PROTOCOL_CAPABILITIES",
      optional: "string[]? -- non-required extras the impl provides",
      homepage: "string? -- where to learn more",
    },
  };
}
