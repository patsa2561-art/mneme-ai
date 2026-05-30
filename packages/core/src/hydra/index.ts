/**
 * v2.96.0 — HYDRA · public surface. Signed, deterministic, provably-
 * lossless, vendor-neutral context codebook that Mneme forges from its own
 * corpus. The 9 facets of the gem:
 *
 *   L1 semantic mining ········· mine.ts        (mineCandidates)
 *   L2 MDL-optimal selection ··· mine.ts        (gain scoring)
 *   L3 deterministic expansion · engine.ts      (compress/expand)
 *   L4 lossless proof ·········· engine.ts      (proveLossless — boolean)
 *   L5 signed codebook ········· attest.ts      (signCodebook — NOTARY)
 *   L6 vendor-neutral ·········· this file       (portableArtifact)
 *   L7 axiom-lattice binding ··· analytic.ts+here(collisions + bindAxioms)
 *   L8 energy certificate ······ attest.ts      (mintEnergyCert)
 *   L9 self-refining forge ····· analytic.ts    (forgeCodebook — converges)
 *
 * The super-bot analytic engine (forgeCodebook) keeps improving until it
 * cannot add a byte of value, gating every step on lossless ∧ no-collision
 * so it can never ship a lie.
 */

export * from "./engine.js";
export * from "./mine.js";
export * from "./analytic.js";
export * from "./attest.js";
export * from "./guard.js";

import type { Codebook } from "./engine.js";
import { sha256Hex } from "./engine.js";
import { forgeCodebook, gauntlet, type ForgeOpts, type ForgeResult, type Gauntlet } from "./analytic.js";
import { signCodebook, mintEnergyCert, canonicalizeCodebook, type EnergyCert } from "./attest.js";
import type { NotaryReceipt } from "../notary/receipt.js";

/**
 * L6 — the VENDOR-NEUTRAL portable artifact. Because a deterministic engine
 * expands this BEFORE any LLM sees it, the artifact is tokenizer-independent
 * BY CONSTRUCTION — it works identically for Claude / GPT / Gemini / open
 * models. The bundle carries everything a third party needs to expand +
 * verify offline: the codebook, its signature, and the expansion grammar
 * (which is simply "replace sym → phrase"; no model required).
 */
export interface PortableArtifact {
  kind: "hydra/portable-codebook";
  v: 1;
  codebook: Codebook;
  /** NOTARY receipt binding the codebook (L5). */
  receipt: NotaryReceipt;
  /** Self-describing expansion grammar so ANY engine can rehydrate. */
  grammar: { rule: string; markerOpen: string; markerClose: string };
  codebookHash: string;
}

export function portableArtifact(cb: Codebook, receipt: NotaryReceipt): PortableArtifact {
  return {
    kind: "hydra/portable-codebook",
    v: 1,
    codebook: cb,
    receipt,
    grammar: {
      rule: "for each entry, replace every occurrence of `sym` with `phrase` (single deterministic pass; phrases never contain markers)",
      markerOpen: cb.open,
      markerClose: cb.close,
    },
    codebookHash: sha256Hex(canonicalizeCodebook(cb)),
  };
}

/**
 * L7 — bind each codebook entry as a signed "axiom": `sym ⇒ phrase`. These
 * compose with Mneme's truth-kernel lattice (each is a deterministic,
 * collision-checked fact). Returned as a list ready for assertClaim/lattice
 * recording; emitted here so HYDRA stays decoupled from lattice I/O.
 */
export interface CodebookAxiom {
  claim: string;
  sym: string;
  phrase: string;
}
export function bindAxioms(cb: Codebook): CodebookAxiom[] {
  return cb.entries.map((e) => ({
    claim: `hydra-symbol ${JSON.stringify(e.sym)} expands to ${JSON.stringify(e.phrase)}`,
    sym: e.sym,
    phrase: e.phrase,
  }));
}

export interface HydraForgeResult {
  forge: ForgeResult;
  gauntlet: Gauntlet;
  receipt: NotaryReceipt;
  energy: EnergyCert;
  portable: PortableArtifact;
  axioms: CodebookAxiom[];
}

/**
 * THE FULL PIPELINE — L1→L9 in one deterministic call. `at` is the issue
 * timestamp (CLI passes Date.now(); tests pass a fixed value).
 */
export function hydraForge(repoRoot: string, corpus: string, at: number, opts: ForgeOpts = {}): HydraForgeResult {
  const forge = forgeCodebook(corpus, opts);
  const g = gauntlet(corpus, forge.codebook);
  const receipt = signCodebook(repoRoot, forge.codebook, g, at);
  const energy = mintEnergyCert(repoRoot, forge.codebook, g, at);
  const portable = portableArtifact(forge.codebook, receipt);
  const axioms = bindAxioms(forge.codebook);
  return { forge, gauntlet: g, receipt, energy, portable, axioms };
}
