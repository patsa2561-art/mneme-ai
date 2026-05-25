/**
 * v2.56.0 — STARGATE: open-source the augmented calibration corpus.
 *
 * Inspired by SpaceX's open-source philosophy ("the patents are stolen
 * anyway; better to share") + xAI's Grok open-weight commitments.
 *
 * Premise: NEMESIS's calibration corpus (seed + augmenter) is the most
 * valuable training-data artifact Mneme owns for AI agent identity
 * verification. By publishing it MIT-licensed, Mneme becomes the
 * "Switzerland of AI vendor fingerprinting" — every vendor (Anthropic /
 * OpenAI / xAI / Google) can train classifiers against the same
 * public ground truth. Result: cross-vendor accountability becomes a
 * commodity that compounds Mneme's protocol position.
 *
 * `mneme stargate publish [--out path] [--format json|jsonl|md]`
 *   - Builds the full augmented corpus (15 fixtures × 6 vendors × 6
 *     augmentations = 540 fixtures via v2.53 augmenter)
 *   - Emits a single bundle file with provenance + license + HMAC seal
 *
 * Pure deterministic + defensive; never throws.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHmac, createHash } from "node:crypto";
import { buildAugmentedCorpus, type AugmentedEntry } from "../nemesis/corpus_augmenter.js";

const KEY_ENV = "MNEME_STARGATE_KEY";
const DEFAULT_KEY = "mneme-stargate-v1";

function keyOf(): string { return process.env[KEY_ENV] ?? DEFAULT_KEY; }

export interface StargateBundle {
  /** Bundle identifier: stable per (mneme version, corpus shape). */
  bundleId: string;
  /** Mneme version that built the bundle. */
  mnemeVersion: string;
  /** Total fixtures (originals + augmentations). */
  fixtureCount: number;
  /** Vendors covered. */
  vendors: string[];
  /** Augmentation kinds present. */
  augmentationKinds: string[];
  /** ISO timestamp. */
  at: string;
  /** License (always MIT). */
  license: "MIT";
  /** Per-fixture data. */
  fixtures: AugmentedEntry[];
  /** SHA-256 over the canonical fixtures body (for cross-machine integrity). */
  contentSha256: string;
  /** HMAC over { bundleId, contentSha256, at, mnemeVersion } — Mneme attestation. */
  hmac: string;
  /** Plain-English provenance + usage statement (for downstream re-publishers). */
  citation: string;
}

export interface PublishInput {
  /** Where to write the bundle (caller supplies). When absent → returned in-memory only. */
  outPath?: string;
  /** Output format. */
  format?: "json" | "jsonl" | "md";
  /** Mneme version (for the bundle metadata). */
  mnemeVersion?: string;
}

export interface PublishResult {
  ok: boolean;
  bundle?: StargateBundle;
  path?: string;
  bytes?: number;
  reason: string;
}

export function buildStargateBundle(mnemeVersion: string): StargateBundle {
  const corpus = buildAugmentedCorpus();
  const vendors = Array.from(new Set(corpus.map((c) => c.vendor)));
  const augmentationKinds = Array.from(new Set(corpus.map((c) => c.augmentationKind)));
  const at = new Date().toISOString();
  const bundleId = `STARGATE-${mnemeVersion}-${corpus.length}`;
  const contentSha256 = createHash("sha256").update(JSON.stringify(corpus)).digest("hex");
  const bodyForHmac = { bundleId, contentSha256, at, mnemeVersion };
  const hmac = createHmac("sha256", keyOf()).update(JSON.stringify(bodyForHmac)).digest("hex");
  const citation = `Mneme STARGATE corpus v${mnemeVersion} — ${corpus.length} fixtures across ${vendors.length} vendors and ${augmentationKinds.length} augmentation kinds (ORIGINAL + STRIP_DIFF_HEADER + NATURALISE_PR + SPARSE_COMMITS + DENSE_COMMITS + WHITESPACE_NOISE). MIT-licensed for unrestricted training + verification. SHA-256: ${contentSha256.slice(0, 16)}... HMAC seal: ${hmac.slice(0, 16)}...`;
  return {
    bundleId,
    mnemeVersion,
    fixtureCount: corpus.length,
    vendors,
    augmentationKinds,
    at,
    license: "MIT",
    fixtures: corpus,
    contentSha256,
    hmac,
    citation,
  };
}

/** Verify a STARGATE bundle's integrity (offline). */
export function verifyStargateBundle(bundle: StargateBundle): { ok: boolean; reason: string } {
  if (!bundle || typeof bundle.hmac !== "string") return { ok: false, reason: "missing bundle or hmac" };
  // Re-derive contentSha256 from fixtures + compare
  const expectedSha = createHash("sha256").update(JSON.stringify(bundle.fixtures)).digest("hex");
  if (expectedSha !== bundle.contentSha256) {
    return { ok: false, reason: "content SHA mismatch (fixtures edited after bundling)" };
  }
  const bodyForHmac = {
    bundleId: bundle.bundleId,
    contentSha256: bundle.contentSha256,
    at: bundle.at,
    mnemeVersion: bundle.mnemeVersion,
  };
  const expected = createHmac("sha256", keyOf()).update(JSON.stringify(bodyForHmac)).digest("hex");
  if (expected !== bundle.hmac) return { ok: false, reason: "hmac mismatch" };
  return { ok: true, reason: "STARGATE bundle verified — content + seal intact" };
}

function renderMarkdown(bundle: StargateBundle): string {
  const lines: string[] = [];
  lines.push(`# Mneme STARGATE Corpus v${bundle.mnemeVersion}`);
  lines.push("");
  lines.push(`**License:** MIT — unrestricted training + verification use.`);
  lines.push(`**Bundle ID:** \`${bundle.bundleId}\``);
  lines.push(`**Built at:** ${bundle.at}`);
  lines.push(`**Total fixtures:** ${bundle.fixtureCount}`);
  lines.push(`**Vendors covered:** ${bundle.vendors.join(", ")}`);
  lines.push(`**Augmentation kinds:** ${bundle.augmentationKinds.join(", ")}`);
  lines.push("");
  lines.push("## Provenance");
  lines.push("");
  lines.push(bundle.citation);
  lines.push("");
  lines.push("## Verification");
  lines.push("");
  lines.push("```");
  lines.push(`SHA-256: ${bundle.contentSha256}`);
  lines.push(`HMAC:    ${bundle.hmac}`);
  lines.push("```");
  lines.push("");
  lines.push("## Fixtures");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(bundle.fixtures.slice(0, 3), null, 2));
  lines.push("```");
  lines.push("");
  lines.push(`*(showing first 3 of ${bundle.fixtureCount} — full set in JSON / JSONL format)*`);
  return lines.join("\n");
}

export function publishStargate(input: PublishInput = {}): PublishResult {
  try {
    const mnemeVersion = input.mnemeVersion ?? "2.56.0";
    const bundle = buildStargateBundle(mnemeVersion);
    if (!input.outPath) {
      return { ok: true, bundle, reason: "in-memory bundle built (no outPath supplied)" };
    }
    const format = input.format ?? "json";
    const body =
      format === "md" ? renderMarkdown(bundle) :
      format === "jsonl" ? bundle.fixtures.map((f) => JSON.stringify(f)).join("\n") + "\n" :
      JSON.stringify(bundle, null, 2);
    try {
      const dir = dirname(input.outPath);
      if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(input.outPath, body, "utf8");
    } catch (e) {
      return { ok: false, reason: `write failed: ${(e as Error).message}` };
    }
    return { ok: true, bundle, path: input.outPath, bytes: Buffer.byteLength(body), reason: `STARGATE bundle written to ${input.outPath} (${format}, ${Buffer.byteLength(body)} bytes)` };
  } catch (e) {
    return { ok: false, reason: `STARGATE publish failed: ${(e as Error).message}` };
  }
}

void join;
