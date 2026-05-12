/**
 * v1.71.0 -- PRECOG +C2: ADVERSARIAL MUTATION TEST.
 *
 * Wild idea: a claim that's GENUINELY grounded should fail when you
 * subtly mutate it. If the firewall still CERTIFIES the mutated form,
 * the original certification was structurally too lax.
 *
 * Mutations (each preserves grammar but flips facts):
 *   - swap a real package -> fake package shape
 *   - swap a real version -> future version
 *   - swap a real SHA -> random hex
 *   - swap "uses" -> "deletes"  / "added" -> "removed"
 *
 * If the mutated claim ALSO gets CERTIFIED, the original verdict
 * was fragile -- demote to HEDGED with explanation.
 *
 * This catches "structurally indistinguishable from truth" lies that
 * the regex-based firewall can't see.
 */

import { intercept, type FirewallReport } from "./firewall.js";

const MUTATIONS: Array<{ from: RegExp; to: string; kind: string }> = [
  { from: /\b(typescript)\b/gi, to: "typescript-fake-2099", kind: "package-swap" },
  { from: /\b(react)\b/gi, to: "react-phantom-99", kind: "package-swap" },
  { from: /\b(v?\d+\.\d+\.\d+)\b/g, to: "v99.42.7", kind: "version-future-swap" },
  { from: /\b([0-9a-f]{40})\b/gi, to: "deadbeefcafefade1234567890abcdef12345678", kind: "sha-fake-swap" },
  { from: /\b(uses)\b/gi, to: "deletes", kind: "verb-flip" },
  { from: /\b(added)\b/gi, to: "removed", kind: "verb-flip" },
  { from: /\b(yesterday)\b/gi, to: "100 years ago", kind: "temporal-far" },
];

export interface MutationProbe {
  mutationKind: string;
  mutatedClaim: string;
  mutatedReport: FirewallReport;
}

export interface MutationTestReport {
  original: string;
  originalVerdict: FirewallReport["verdict"];
  probes: MutationProbe[];
  /** Number of mutations that ALSO returned CERTIFIED. */
  fragileMutations: number;
  /** Final decision: PASS / DEMOTE-TO-HEDGED. */
  decision: "PASS" | "DEMOTE-TO-HEDGED";
  headline: string;
}

/** Run mutation test on a CERTIFIED claim. Returns whether the
 *  certification holds up. */
export function mutationTest(repoRoot: string, claim: string, originalReport: FirewallReport): MutationTestReport {
  // Only meaningful on CERTIFIED claims.
  if (originalReport.verdict !== "CERTIFIED") {
    return {
      original: claim,
      originalVerdict: originalReport.verdict,
      probes: [],
      fragileMutations: 0,
      decision: "PASS",
      headline: `Mutation test skipped: original verdict was ${originalReport.verdict}.`,
    };
  }

  const probes: MutationProbe[] = [];
  let fragile = 0;
  for (const mut of MUTATIONS) {
    if (!mut.from.test(claim)) continue;
    // Apply mutation (just FIRST match -- one swap is enough).
    const mutated = claim.replace(mut.from, mut.to);
    if (mutated === claim) continue;
    const mutReport = intercept(repoRoot, mutated, { recordOnReject: false, issueCert: false });
    if (mutReport.verdict === "CERTIFIED") fragile += 1;
    probes.push({ mutationKind: mut.kind, mutatedClaim: mutated, mutatedReport: mutReport });
  }

  // Decision: if any mutation also certified, the original cert was fragile.
  const decision: MutationTestReport["decision"] = fragile > 0 ? "DEMOTE-TO-HEDGED" : "PASS";

  return {
    original: claim,
    originalVerdict: originalReport.verdict,
    probes,
    fragileMutations: fragile,
    decision,
    headline: decision === "PASS"
      ? `Mutation test PASS: ${probes.length} mutations all flagged.`
      : `Mutation test DEMOTE: ${fragile}/${probes.length} mutations also CERTIFIED -> original certification too lax.`,
  };
}
