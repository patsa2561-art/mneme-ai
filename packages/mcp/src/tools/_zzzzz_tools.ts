/**
 * v2.39.0 — MCP wrappers for Zzzzz-PROBE (5 tools).
 *
 *   mneme.zzzzz.probe   — analyze text / code / image bytes
 *   mneme.zzzzz.arm     — mark Zzzzz armed (advisory marker)
 *   mneme.zzzzz.status  — armed state + ledger size + last verdict
 *   mneme.zzzzz.verdict — read N most-recent reports
 *   mneme.zzzzz.verify  — offline HMAC verify of a pasted report
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime): string {
  return resolve(rt.meta?.rootPath ?? process.cwd());
}

export const zzzzzProbeTool: MnemeTool = {
  name: "mneme.zzzzz.probe",
  category: "meta",
  description:
    "Zzzzz-PROBE — multi-modal anti-entropy detector. Fires 4 text signals (Shannon entropy / Zipf deviation / repetition / sentence-variance) on text+code, or 5 image signals (pHash / Laplacian variance / color-histogram entropy / JPEG-quant fingerprint / distinct-color count) on image bytes. REFUTED / IMPOSSIBLE_REFUTE auto-emit an HGP-YYYY-NNNNN id.",
  whenToUse: "Probe a suspicious AI-generated artifact (text reply, code snippet, image file) for hallucination/synthetic-origin signal.",
  triggers: ["zzzzz", "sleepwalking oracle", "anti entropy", "image provenance"],
  inputSchema: {
    type: "object",
    properties: {
      modality: { type: "string", description: "text | code | image" },
      text: { type: "string", description: "Raw text/code (modality=text|code)." },
      imagePath: { type: "string", description: "Path to image file (modality=image)." },
      imageBase64: { type: "string", description: "Base64-encoded image bytes (modality=image, alternative to imagePath)." },
      vendor: { type: "string", description: "Vendor id for HGP attribution on refute." },
    },
    required: ["modality"],
  },
  outputSchema: { type: "object" },
  composeWith: ["mneme.hgp.lookup", "mneme.zzzzz.verdict"],
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const repoRoot = repoRootOf(rt);
      const modality = String(args["modality"] ?? "text") as "text" | "code" | "image";
      let imageBytes: Uint8Array | undefined;
      if (modality === "image") {
        if (typeof args["imagePath"] === "string") {
          const p = args["imagePath"] as string;
          if (!existsSync(p)) {
            return { data: { ok: false, error: `imagePath not found: ${p}` }, wisdom: "Pass a valid imagePath OR imageBase64.", followUp: [], confidence: { level: "high" as const } };
          }
          imageBytes = new Uint8Array(readFileSync(p));
        } else if (typeof args["imageBase64"] === "string") {
          imageBytes = new Uint8Array(Buffer.from(args["imageBase64"] as string, "base64"));
        } else {
          return { data: { ok: false, error: "image modality requires imagePath OR imageBase64" }, wisdom: "Pass imagePath or imageBase64.", followUp: [], confidence: { level: "high" as const } };
        }
      }
      const report = await core.zzzzzProbe.probeArtifact({
        modality,
        ...(typeof args["text"] === "string" ? { text: args["text"] as string } : {}),
        ...(imageBytes ? { imageBytes } : {}),
        ...(typeof args["vendor"] === "string" ? { vendor: args["vendor"] as string } : {}),
      }, repoRoot);
      return {
        data: report,
        wisdom: report.headline,
        followUp: report.verdict === "CRYSTAL_CLEAR" ? [] : ["mneme.zzzzz.verdict", "mneme.hgp.lookup"],
        confidence: { level: report.verdict === "CRYSTAL_CLEAR" ? "high" as const : "medium" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: `Zzzzz-PROBE failed: ${(e as Error).message}`, followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const zzzzzArmTool: MnemeTool = {
  name: "mneme.zzzzz.arm",
  category: "meta",
  description: "Zzzzz-PROBE — write an 'armed' marker (advisory; the real interception is shipped by Windows DLL chrysalis + polygraph bridge). Returns the new armed state.",
  whenToUse: "Mark the Zzzzz polygraph as armed for downstream consumers (UI dots, AI-agent banners).",
  triggers: ["zzzzz arm"],
  inputSchema: { type: "object", properties: { reason: { type: "string" } } },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const state = core.zzzzzProbe.arm(repoRootOf(rt), typeof args["reason"] === "string" ? (args["reason"] as string) : undefined);
      return { data: state, wisdom: `Zzzzz-PROBE armed at ${state.at}.`, followUp: ["mneme.zzzzz.status"], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "arm failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const zzzzzStatusTool: MnemeTool = {
  name: "mneme.zzzzz.status",
  category: "meta",
  description: "Zzzzz-PROBE — read armed state + OS polygraph classification + ledger size + last verdict.",
  whenToUse: "Inspect Zzzzz-PROBE current state.",
  triggers: ["zzzzz status"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async (rt) => {
    try {
      const core = await import("@mneme-ai/core");
      const repoRoot = repoRootOf(rt);
      const armed = core.zzzzzProbe.isArmed(repoRoot);
      const ledger = core.zzzzzProbe.readLedger(repoRoot, 1);
      const os = await core.zzzzzProbe.classifyOS();
      return {
        data: { armed, ledgerSize: core.zzzzzProbe.readLedger(repoRoot, 10000).length, last: ledger[0] ?? null, os },
        wisdom: armed ? `🟢 Zzzzz-PROBE armed · ${ledger.length} report(s) in ledger.` : `⚪ Zzzzz-PROBE disarmed.`,
        followUp: armed ? [] : ["mneme.zzzzz.arm"],
        confidence: { level: "high" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "status failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const zzzzzVerdictTool: MnemeTool = {
  name: "mneme.zzzzz.verdict",
  category: "meta",
  description: "Zzzzz-PROBE — read N most-recent reports from the ledger.",
  whenToUse: "Inspect probe history; build a verdict timeline.",
  triggers: ["zzzzz verdict", "zzzzz history"],
  inputSchema: { type: "object", properties: { limit: { type: "integer" } } },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const limit = typeof args["limit"] === "number" ? (args["limit"] as number) : 20;
      const list = core.zzzzzProbe.readLedger(repoRootOf(rt), limit);
      return {
        data: { count: list.length, reports: list },
        wisdom: list.length === 0 ? "No reports yet — run mneme.zzzzz.probe first." : `${list.length} report(s).`,
        followUp: list.length === 0 ? ["mneme.zzzzz.probe"] : [],
        confidence: { level: "high" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "verdict failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const zzzzzVerifyTool: MnemeTool = {
  name: "mneme.zzzzz.verify",
  category: "meta",
  description: "Zzzzz-PROBE — offline HMAC verify of a pasted ZzzzzReport.",
  whenToUse: "Cross-machine attestation.",
  triggers: ["zzzzz verify"],
  inputSchema: { type: "object", properties: { report: { type: "object" } }, required: ["report"] },
  outputSchema: { type: "object" },
  handler: async (_rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const r = args["report"] as Parameters<typeof core.zzzzzProbe.verifyReport>[0];
      if (!r || typeof r !== "object") {
        return { data: { ok: false, reason: "report missing" }, wisdom: "Pass `report`.", followUp: [], confidence: { level: "high" as const } };
      }
      const v = core.zzzzzProbe.verifyReport(r);
      return { data: v, wisdom: v.ok ? "HMAC verified." : `HMAC FAIL: ${v.reason}`, followUp: [], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "verify failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const ZZZZZ_TOOLS: MnemeTool[] = [
  zzzzzProbeTool,
  zzzzzArmTool,
  zzzzzStatusTool,
  zzzzzVerdictTool,
  zzzzzVerifyTool,
];
