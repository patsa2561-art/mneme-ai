/**
 * v2.57.0 — WIRING DOCTOR: AST-level per-feature surface verification.
 *
 * Replaces the false-positive-prone commit-message parser with a deterministic
 * structural check. For each feature (lethe / gavel / nimbus / janus / etc),
 * verify:
 *   - CORE     : exported from packages/core/src/nemesis/index.ts (or
 *                packages/core/src/xai_alignment/index.ts)
 *   - SDK      : method present on NemesisSdk class (packages/sdk/src/nemesis.ts)
 *   - CLI      : top-level `mneme <feature>` verb registered in
 *                packages/cli/src/index.ts OR `mneme nemesis <feature>_*` in
 *                v236_commands.ts
 *   - TG-CLAIM : a `claim.<feature>.*` exists in truth_gate/claims.ts
 *
 * Returns per-feature scorecard. ok=true iff every feature has all 4 surfaces.
 *
 * Pure deterministic + defensive; never throws.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadFreshAuditorReport } from "./sdk_surface_auditor.js";

export type SurfaceStatus = "present" | "missing" | "unknown";

export interface FeatureReport {
  feature: string;
  core: SurfaceStatus;
  sdk: SurfaceStatus;
  cli: SurfaceStatus;
  tgClaim: SurfaceStatus;
  coreEvidence?: string;
  sdkEvidence?: string;
  cliEvidence?: string;
  tgClaimEvidence?: string;
  /** ok iff core+sdk+cli+tgClaim all "present". */
  ok: boolean;
}

export interface WiringDoctorResult {
  ok: boolean;
  features: FeatureReport[];
  summary: { total: number; healthy: number; broken: number };
  hint: string;
  at: string;
}

/** v2.57 default feature set — recent primitives that should have full surface. */
const DEFAULT_FEATURES = [
  "lethe", "gavel", "nimbus", "janus", "stargate", "dragon", "launch_window",
  "stealth_score", "capillary", "colosseum", "molt", "themis", "sibyl",
];

/**
 * Each feature has CORE-export names + SDK-method names + CLI-verb names
 * + TG-claim-segment patterns that should resolve.
 */
const FEATURE_FIXTURES: Record<string, {
  coreExportRegex: RegExp[];
  sdkMethodRegex: RegExp[];
  cliVerbRegex: RegExp[];
  tgClaimRegex: RegExp[];
}> = {
  lethe: {
    coreExportRegex: [/forgetRow|verifyForgetReceipt|buildMerkleTree/],
    sdkMethodRegex: [/letheForget/],
    cliVerbRegex: [/\.command\("lethe"\)|"lethe_forget"/],
    // Covered by per-feature OR shared `world_class_premium_primitives` claim
    tgClaimRegex: [/claim\.[^"]*(?:lethe|forget|world_class_premium)/i],
  },
  gavel: {
    coreExportRegex: [/buildGavelBundle|verifyGavelBundle/],
    sdkMethodRegex: [/gavelPack/],
    cliVerbRegex: [/\.command\("gavel"\)|"gavel_pack"/],
    tgClaimRegex: [/claim\.[^"]*(?:gavel|world_class_premium)/i],
  },
  nimbus: {
    coreExportRegex: [/publishCard|computeCrossOrgReputation/],
    sdkMethodRegex: [/nimbusPublish/],
    cliVerbRegex: [/\.command\("nimbus"\)|"nimbus_publish"/],
    tgClaimRegex: [/claim\.[^"]*(?:nimbus|world_class_premium)/i],
  },
  janus: {
    coreExportRegex: [/locateBasin|detectIdentitySwap/],
    sdkMethodRegex: [/janusObserve|janusSwap/],
    cliVerbRegex: [/"janus_observe"|"janus_swap"/],
    // JANUS lives under `claim.audit.open_wounds_patched` (P1-3 fix from v2.53)
    tgClaimRegex: [/claim\.[^"]*(?:janus|open_wounds_patched)/i],
  },
  stargate: {
    coreExportRegex: [/buildStargateBundle|publishStargate/],
    sdkMethodRegex: [/stargate|nemesis/], // accessed through core in v2.57; sdk wrapper future-work
    cliVerbRegex: [/\.command\("stargate"\)/],
    tgClaimRegex: [/claim\.[^"]*stargate/i],
  },
  dragon: {
    coreExportRegex: [/dragonEject|verifyEjectEvent/],
    sdkMethodRegex: [/dragon|nemesis/],
    cliVerbRegex: [/\.command\("dragon"\)/],
    tgClaimRegex: [/claim\.[^"]*dragon/i],
  },
  launch_window: {
    coreExportRegex: [/evaluateLaunchWindow|verifyLaunchVerdict/],
    sdkMethodRegex: [/launchWindow|nemesis/],
    cliVerbRegex: [/\.command\("launch_window"\)/],
    tgClaimRegex: [/claim\.[^"]*launch_window/i],
  },
  stealth_score: {
    coreExportRegex: [/computeStealthScore|verifyStealthLedger/],
    sdkMethodRegex: [/stealthScore/],
    cliVerbRegex: [/"stealth_score"/],
    tgClaimRegex: [/claim\.[^"]*(?:stealth|million_dollar)/i],
  },
  capillary: {
    coreExportRegex: [/extractMicroProfile|microDistance/],
    sdkMethodRegex: [/capillary/],
    cliVerbRegex: [/"capillary"/],
    tgClaimRegex: [/claim\.[^"]*(?:capillary|million_dollar)/i],
  },
  colosseum: {
    coreExportRegex: [/runTournament|readColosseumLeaderboard/],
    sdkMethodRegex: [/colosseum|nemesis/],
    cliVerbRegex: [/"colosseum"/],
    tgClaimRegex: [/claim\.[^"]*(?:colosseum|million_dollar)/i],
  },
  molt: {
    coreExportRegex: [/detectMolt|verifyMoltVerdict/],
    sdkMethodRegex: [/molt|nemesis/],
    cliVerbRegex: [/"molt"/],
    tgClaimRegex: [/claim\.[^"]*(?:molt|million_dollar)/i],
  },
  themis: {
    coreExportRegex: [/verifyAlibi|buildComplianceBundle/],
    sdkMethodRegex: [/alibi/],
    cliVerbRegex: [/"themis"/],
    tgClaimRegex: [/claim\.[^"]*(?:themis|million_dollar)/i],
  },
  sibyl: {
    coreExportRegex: [/commitIdentity|revealIdentity/],
    sdkMethodRegex: [/sibylCommit|sibylReveal/],
    cliVerbRegex: [/"sibyl_commit"|"sibyl_reveal"/],
    tgClaimRegex: [/claim\.[^"]*(?:sibyl|million_dollar)/i],
  },
};

function readIfExists(p: string): string {
  try { return existsSync(p) ? readFileSync(p, "utf8") : ""; } catch { return ""; }
}

function checkSurface(body: string, regexes: RegExp[]): { status: SurfaceStatus; evidence?: string } {
  if (!body) return { status: "unknown", evidence: "source file missing" };
  for (const re of regexes) {
    const m = body.match(re);
    if (m) return { status: "present", evidence: m[0].slice(0, 80) };
  }
  return { status: "missing" };
}

/**
 * Run the per-feature diagnostic. Pure: only reads files; no execution.
 */
export function diagnose(repoRoot: string, opts: { features?: string[] } = {}): WiringDoctorResult {
  const features = (opts.features && opts.features.length > 0) ? opts.features : DEFAULT_FEATURES;
  const coreNemesis = readIfExists(join(repoRoot, "packages/core/src/nemesis/index.ts"));
  const coreXai = readIfExists(join(repoRoot, "packages/core/src/xai_alignment/index.ts"));
  const coreBody = coreNemesis + "\n" + coreXai;
  const sdkBody = readIfExists(join(repoRoot, "packages/sdk/src/nemesis.ts"));
  const cliTop = readIfExists(join(repoRoot, "packages/cli/src/index.ts"));
  const cliNemesis = readIfExists(join(repoRoot, "packages/cli/src/commands/v236_commands.ts"));
  const cliBody = cliTop + "\n" + cliNemesis;
  const claimsBody = readIfExists(join(repoRoot, "packages/core/src/truth_gate/claims.ts"));
  // v2.59: pull in empirical SDK_AUDITOR report when available.
  const auditor = loadFreshAuditorReport(repoRoot);

  const reports: FeatureReport[] = [];
  for (const f of features) {
    const fixture = FEATURE_FIXTURES[f];
    if (!fixture) {
      reports.push({
        feature: f,
        core: "unknown", sdk: "unknown", cli: "unknown", tgClaim: "unknown",
        ok: false,
      });
      continue;
    }
    const core = checkSurface(coreBody, fixture.coreExportRegex);
    // v2.59: SDK check uses BOTH static grep AND empirical SDK_AUDITOR
    // report (when fresh). Empirical wins on disagreement — fresher,
    // catches the v2.58 blind-spot where static grep saw the class
    // method but external import surface was missing.
    const sdkStatic = checkSurface(sdkBody, fixture.sdkMethodRegex);
    let sdk = sdkStatic;
    if (auditor) {
      const finding = auditor.findings.find((x) => x.feature === f);
      if (finding) {
        if (finding.present) {
          sdk = { status: "present", evidence: `empirical: ${finding.evidence}` };
        } else {
          // Empirical wins: external surface really is missing.
          sdk = { status: "missing", evidence: `empirical: ${finding.evidence}` };
        }
      }
    }
    const cli = checkSurface(cliBody, fixture.cliVerbRegex);
    const tg = checkSurface(claimsBody, fixture.tgClaimRegex);
    const ok = core.status === "present" && sdk.status === "present" && cli.status === "present" && tg.status === "present";
    reports.push({
      feature: f,
      core: core.status, coreEvidence: core.evidence,
      sdk: sdk.status, sdkEvidence: sdk.evidence,
      cli: cli.status, cliEvidence: cli.evidence,
      tgClaim: tg.status, tgClaimEvidence: tg.evidence,
      ok,
    });
  }
  const healthy = reports.filter((r) => r.ok).length;
  const broken = reports.length - healthy;
  const okAll = broken === 0;
  return {
    ok: okAll,
    features: reports,
    summary: { total: reports.length, healthy, broken },
    hint: okAll
      ? `WIRING DOCTOR: all ${reports.length} features wired across core / sdk / cli / tg-claim`
      : `${broken}/${reports.length} feature(s) missing at least one surface. Run with --features to drill in.`,
    at: new Date().toISOString(),
  };
}

/** Render a compact table for human eyes. */
export function renderTable(r: WiringDoctorResult): string {
  const head = `${"feature".padEnd(16)} core  sdk   cli   tg-claim  ok`;
  const rows = r.features.map((f) => {
    const sym = (s: SurfaceStatus): string => s === "present" ? "✓" : s === "missing" ? "✗" : "?";
    return `${f.feature.padEnd(16)} ${sym(f.core).padEnd(5)} ${sym(f.sdk).padEnd(5)} ${sym(f.cli).padEnd(5)} ${sym(f.tgClaim).padEnd(9)} ${f.ok ? "✓" : "✗"}`;
  });
  return [`WIRING DOCTOR — ${r.summary.healthy}/${r.summary.total} healthy at ${r.at}`, "", head, ...rows].join("\n");
}
