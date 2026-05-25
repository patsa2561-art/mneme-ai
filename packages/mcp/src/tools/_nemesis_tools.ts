/**
 * v2.46.0 — MCP wrappers for NEMESIS (8 tools, all STATELESS).
 *
 *   mneme.nemesis.fingerprint         — extract 41-feature vector
 *   mneme.nemesis.classify            — predict vendor from fingerprint
 *   mneme.nemesis.env_scan            — vendor env-var detection
 *   mneme.nemesis.verify_identity     — claim vs detected (HMAC verdict)
 *   mneme.nemesis.eu_stamp            — EU AI Act Article 50 disclosure
 *   mneme.nemesis.verify_stamp        — verify a pasted stamped message
 *   mneme.nemesis.install_hook        — install git pre-commit hook
 *   mneme.nemesis.drift_check         — variance over recorded fingerprints
 *   mneme.nemesis.replay_check        — stealth upgrade/downgrade detector
 */

import { resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime): string {
  return resolve(rt.meta?.rootPath ?? process.cwd());
}

export const nemesisFingerprintTool: MnemeTool = {
  name: "mneme.nemesis.fingerprint",
  category: "meta",
  description: "NEMESIS ORGAN 1 — extract the 41-feature vendor fingerprint from a diff + PR description + commit messages. Based on arxiv 2601.17406 (Jan 2026) — 97.2% F1 across 33,580 PRs. Pure deterministic.",
  whenToUse: "AI agent wants to know which vendor likely produced a code change.",
  triggers: ["nemesis fingerprint", "agent fingerprint"],
  inputSchema: { type: "object", properties: { diff: { type: "string" }, prDescription: { type: "string" }, commitMessages: { type: "array", items: { type: "string" } } } },
  outputSchema: { type: "object" },
  handler: async (_rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const fp = core.nemesis.extractFingerprint({
        diff: String(args["diff"] ?? ""),
        prDescription: String(args["prDescription"] ?? ""),
        commitMessages: (args["commitMessages"] as string[]) ?? [],
      });
      return { data: { ok: true, fingerprint: fp }, wisdom: `41 features extracted`, followUp: ["mneme.nemesis.classify"], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "fingerprint failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const nemesisClassifyTool: MnemeTool = {
  name: "mneme.nemesis.classify",
  category: "meta",
  description: "NEMESIS ORGAN 2 — given fixture (diff/PR/commits), extract fingerprint + predict vendor (codex/claude-code/copilot/cursor/devin). Returns topVendor + confidence + per-vendor scores.",
  whenToUse: "AI agent or user wants to know who probably wrote the code.",
  triggers: ["nemesis classify", "classify agent"],
  inputSchema: { type: "object", properties: { diff: { type: "string" }, prDescription: { type: "string" }, commitMessages: { type: "array", items: { type: "string" } } } },
  outputSchema: { type: "object" },
  composeWith: ["mneme.nemesis.verify_identity"],
  handler: async (_rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const fp = core.nemesis.extractFingerprint({
        diff: String(args["diff"] ?? ""),
        prDescription: String(args["prDescription"] ?? ""),
        commitMessages: (args["commitMessages"] as string[]) ?? [],
      });
      const v = core.nemesis.classifyAgent(fp);
      return { data: { ok: true, result: v, fingerprint: fp }, wisdom: v.reasoning, followUp: ["mneme.nemesis.verify_identity"], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "classify failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const nemesisEnvScanTool: MnemeTool = {
  name: "mneme.nemesis.env_scan",
  category: "meta",
  description: "NEMESIS ORGAN 1 addon — scan process.env for vendor signature markers (CLAUDECODE / CURSOR_AGENT / COPILOT_AGENT / DEVIN_SESSION / CODEX_AGENT etc). Zero false positives.",
  whenToUse: "Want the cheapest most reliable vendor signal.",
  triggers: ["nemesis env"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async () => {
    try {
      const core = await import("@mneme-ai/core");
      const r = core.nemesis.scanEnv();
      return { data: { ok: true, result: r }, wisdom: `env scan: ${r.vendor} (confidence ${r.confidence.toFixed(2)})`, followUp: [], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "env scan failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const nemesisVerifyIdentityTool: MnemeTool = {
  name: "mneme.nemesis.verify_identity",
  category: "meta",
  description: "NEMESIS ORGAN 2 — given a vendor CLAIM (who the AI agent says it is) + fixture (diff/PR/commits), compare to detected fingerprint + emit HMAC-signed verdict (CONFIRMED / DISPUTED / IMPOSSIBLE / INCONCLUSIVE). The lie detector.",
  whenToUse: "Verify an AI agent's identity claim against what its actual fingerprint says.",
  triggers: ["nemesis verify identity", "identity lie"],
  inputSchema: {
    type: "object",
    properties: {
      claimedVendor: { type: "string" },
      diff: { type: "string" },
      prDescription: { type: "string" },
      commitMessages: { type: "array", items: { type: "string" } },
    },
    required: ["claimedVendor"],
  },
  outputSchema: { type: "object" },
  handler: async (_rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const r = core.nemesis.verifyIdentityClaim({
        claimedVendor: String(args["claimedVendor"] ?? ""),
        fixture: {
          diff: String(args["diff"] ?? ""),
          prDescription: String(args["prDescription"] ?? ""),
          commitMessages: (args["commitMessages"] as string[]) ?? [],
        },
      });
      return { data: { ok: true, result: r }, wisdom: r.reasoning, followUp: [], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "verify identity failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const nemesisEuStampTool: MnemeTool = {
  name: "mneme.nemesis.eu_stamp",
  category: "meta",
  description: "NEMESIS ORGAN 3 — append EU AI Act Article 50 machine-readable disclosure block to a commit message / content text. HMAC-signed; offline-verifiable. Enforceable date: 2 Aug 2026.",
  whenToUse: "Auto-stamp every commit OR text artifact with EU AI Act compliance disclosure.",
  triggers: ["eu stamp", "article 50", "ai disclosure"],
  inputSchema: {
    type: "object",
    properties: {
      message: { type: "string" },
      vendor: { type: "string" },
      confidence: { type: "number" },
      contentType: { type: "string" },
    },
    required: ["message", "vendor"],
  },
  outputSchema: { type: "object" },
  handler: async (_rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const r = core.nemesis.stampArticle50({
        message: String(args["message"] ?? ""),
        vendor: String(args["vendor"] ?? ""),
        confidence: typeof args["confidence"] === "number" ? (args["confidence"] as number) : 0.9,
        ...(typeof args["contentType"] === "string" ? { contentType: args["contentType"] as string } : {}),
      });
      return { data: r, wisdom: r.ok ? "stamped" : `stamp failed: ${r.reason}`, followUp: ["mneme.nemesis.verify_stamp"], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "eu_stamp failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const nemesisVerifyStampTool: MnemeTool = {
  name: "mneme.nemesis.verify_stamp",
  category: "meta",
  description: "NEMESIS ORGAN 3 verify — parse a stamped message + HMAC-verify the Article 50 disclosure block.",
  whenToUse: "Cross-machine audit: confirm a commit's AI-disclosure block is authentic.",
  triggers: ["verify stamp", "eu verify"],
  inputSchema: { type: "object", properties: { stamped: { type: "string" } }, required: ["stamped"] },
  outputSchema: { type: "object" },
  handler: async (_rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const r = core.nemesis.verifyStamp(String(args["stamped"] ?? ""));
      return { data: r, wisdom: r.valid ? "stamp valid" : `stamp invalid: ${r.reason}`, followUp: [], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "verify_stamp failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const nemesisInstallHookTool: MnemeTool = {
  name: "mneme.nemesis.install_hook",
  category: "meta",
  description: "NEMESIS ORGAN 3 surface — install a git prepare-commit-msg hook that auto-stamps every commit with EU AI Act Article 50 disclosure. DRY-RUN default; refuses to overwrite existing non-NEMESIS hook.",
  whenToUse: "User wants every commit auto-disclosed for EU AI Act compliance.",
  triggers: ["install hook", "nemesis hook"],
  inputSchema: { type: "object", properties: { dryRun: { type: "boolean" } } },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const r = core.nemesis.installPreCommitHook({
        repoRoot: repoRootOf(rt),
        dryRun: args["dryRun"] === undefined ? true : Boolean(args["dryRun"]),
      });
      return { data: r, wisdom: r.ok ? (r.installed ? "hook installed" : "dry-run; plan shown") : `install failed: ${r.reason}`, followUp: [], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "install_hook failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const nemesisDriftTool: MnemeTool = {
  name: "mneme.nemesis.drift_check",
  category: "meta",
  description: "NEMESIS ORGAN 4 — record per-vendor fingerprint to ledger; compute σ-variance over history; surface drift when feature shifts ≥3σ (vendor likely swapped model).",
  whenToUse: "Daemon cycle: track each vendor's fingerprint over time to spot stealth model changes.",
  triggers: ["nemesis drift"],
  inputSchema: {
    type: "object",
    properties: {
      mode: { type: "string", description: "record | variance" },
      vendor: { type: "string" },
      feature: { type: "string", description: "feature name to check variance on (for mode=variance)" },
      fingerprint: { type: "object", description: "fingerprint to record (for mode=record)" },
    },
    required: ["mode", "vendor"],
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const repoRoot = repoRootOf(rt);
      const mode = String(args["mode"] ?? "");
      const vendor = String(args["vendor"] ?? "");
      if (mode === "record") {
        const r = core.nemesis.recordFingerprint(repoRoot, vendor, (args["fingerprint"] as Record<string, number>) ?? {});
        return { data: r, wisdom: r.ok ? "fingerprint recorded" : `record failed: ${r.reason}`, followUp: [], confidence: { level: "high" as const } };
      }
      if (mode === "variance") {
        const r = core.nemesis.computeVariance(repoRoot, vendor, String(args["feature"] ?? "conditional_density"));
        return { data: { ok: true, result: r }, wisdom: r.driftDetected ? `🚨 DRIFT: ${vendor} ${r.feature} shifted by ${r.z.toFixed(2)}σ` : `stable (z=${r.z.toFixed(2)})`, followUp: [], confidence: { level: "high" as const } };
      }
      return { data: { ok: false, error: `unknown mode: ${mode}` }, wisdom: "pass mode=record or mode=variance", followUp: [], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "drift_check failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const nemesisReplayTool: MnemeTool = {
  name: "mneme.nemesis.replay_check",
  category: "meta",
  description: "NEMESIS ORGAN 5 — given the same vendor's fingerprint at two different times, detect stealth-upgrade / stealth-downgrade / stealth-swap (Euclidean distance over 8 discriminator features ≥ 1.0).",
  whenToUse: "Periodic check that a vendor hasn't silently swapped models on you.",
  triggers: ["nemesis replay", "stealth swap"],
  inputSchema: {
    type: "object",
    properties: {
      vendor: { type: "string" },
      fingerprintA: { type: "object" },
      fingerprintB: { type: "object" },
      threshold: { type: "number" },
    },
    required: ["vendor", "fingerprintA", "fingerprintB"],
  },
  outputSchema: { type: "object" },
  handler: async (_rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const r = core.nemesis.detectReplayAttack(
        String(args["vendor"] ?? ""),
        (args["fingerprintA"] as Record<string, number>) ?? {},
        (args["fingerprintB"] as Record<string, number>) ?? {},
        { threshold: typeof args["threshold"] === "number" ? (args["threshold"] as number) : 1.0 },
      );
      return { data: { ok: true, result: r }, wisdom: r.reasoning, followUp: [], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "replay_check failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

// v2.47.0 — production-grade additions: calibrated classifier + dev-tooling
// detector + learning loop status + key management.

export const nemesisCalibrationStatusTool: MnemeTool = {
  name: "mneme.nemesis.calibration_status",
  category: "meta",
  description: "v2.47 — NEMESIS calibration status: seed corpus size, ledger size, per-vendor counts, MNEME_NEMESIS_LEARN opt-in state, calibrated-accuracy on seed corpus.",
  whenToUse: "Verify NEMESIS classifier is calibrated + assess corpus health.",
  triggers: ["nemesis calibration", "nemesis stats"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async (rt) => {
    try {
      const core = await import("@mneme-ai/core");
      const status = core.nemesis.calibrationStatus(repoRootOf(rt));
      const acc = core.nemesis.evaluateSeedAccuracy();
      return {
        data: { ok: true, status, accuracy: acc },
        wisdom: `corpus ${status.totalCount} fixtures · accuracy ${(acc.accuracy * 100).toFixed(1)}%`,
        followUp: [], confidence: { level: "high" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "calibration_status failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const nemesisDetectToolingTool: MnemeTool = {
  name: "mneme.nemesis.detect_tooling",
  category: "meta",
  description: "v2.47 — Detect whether the current directory is an AI-dev scratch folder (NOT a customer repo) vs a real git repo. Heuristic: !isGitRepo && ≥3 AI-fingerprint files at root. NEMESIS skips auto-stamping in such folders.",
  whenToUse: "Verify your CWD before installing the git hook OR before running NEMESIS scans.",
  triggers: ["nemesis detect tooling", "dev tooling"],
  inputSchema: { type: "object", properties: { path: { type: "string" } } },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const path = typeof args["path"] === "string" ? (args["path"] as string) : repoRootOf(rt);
      const r = core.autoInit.detectDevTooling(path);
      return {
        data: { ok: true, result: r },
        wisdom: r.isDevTooling ? `⚠ ${path} looks like an AI-dev folder: ${r.reason}` : `✓ ${path} ${r.reason}`,
        followUp: [], confidence: { level: "high" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "detect_tooling failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const NEMESIS_TOOLS: MnemeTool[] = [
  nemesisFingerprintTool,
  nemesisClassifyTool,
  nemesisEnvScanTool,
  nemesisVerifyIdentityTool,
  nemesisEuStampTool,
  nemesisVerifyStampTool,
  nemesisInstallHookTool,
  nemesisDriftTool,
  nemesisReplayTool,
  // v2.47.0 production-grade
  nemesisCalibrationStatusTool,
  nemesisDetectToolingTool,
];
