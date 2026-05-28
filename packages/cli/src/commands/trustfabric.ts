/**
 * v2.82.0 — TRUST FABRIC CLI dispatcher for the 7-diamond batch
 * (💎6 stake · 💎7 mesh · 💎1 route · 💎2 brain · 💎8 factwatch · 💎9 edge · 💎10 compound).
 * Complex structured inputs (hops / capsules / receipts / claims) are passed as JSON.
 */

import { writeSync, readFileSync } from "node:fs";
import * as core from "@mneme-ai/core";
import { parseJsonArg } from "../util/json_arg.js";

function out(s: string): void { try { writeSync(1, s); } catch { process.stdout.write(s); } }
function emit(o: unknown): number { out(JSON.stringify(o, null, 2) + "\n"); return 0; }
function readJson(raw: string | undefined, file: string | undefined): unknown {
  if (file) return JSON.parse(readFileSync(file === "-" ? 0 : file, "utf8"));
  if (raw) return parseJsonArg(raw);
  throw new Error("missing JSON input");
}

export interface TrustFabricOpts {
  cwd: string; family: string; action: string;
  staker?: string; claim?: string; amountMicros?: number; deadlineMs?: number;
  text?: string; requestId?: string; owner?: string; vendor?: string;
  fact?: string; newValue?: string; knownValue?: string; observedBy?: string;
  peer?: string; lanUrl?: string; threshold?: number; refuted?: boolean; at?: number;
  jsonInput?: string; file?: string; json?: boolean;
}

export async function trustFabricCommand(o: TrustFabricOpts): Promise<number> {
  const J = () => readJson(o.jsonInput, o.file);
  try {
    switch (o.family) {
      case "stake": {
        if (o.action === "create") return emit(core.truthStake.createStake(o.cwd, { staker: o.staker ?? "agent", claim: o.claim ?? "", amountMicros: o.amountMicros ?? 0, deadlineMs: o.deadlineMs ?? 0 }));
        if (o.action === "resolve") return emit(core.truthStake.resolveStake(o.cwd, J() as Parameters<typeof core.truthStake.resolveStake>[1], { refuted: !!o.refuted, at: o.at }));
        break;
      }
      case "mesh": {
        if (o.action === "scan") { const s = core.meshImmune.scanMessage(o.text ?? ""); return emit({ disposition: core.meshImmune.quarantineDecision(s), ...s }); }
        if (o.action === "trace") return emit(core.meshImmune.traceContagion(J() as Parameters<typeof core.meshImmune.traceContagion>[0]));
        break;
      }
      case "bgp": {
        if (o.action === "notarize") { const r = core.bgpRouter.routeRequest(o.cwd, { requestId: o.requestId ?? "req", hops: J() as Parameters<typeof core.bgpRouter.routeRequest>[1]["hops"] }); return emit({ routeId: r.routeId, path: core.bgpRouter.renderRoute(r.receipts), receipts: r.receipts }); }
        if (o.action === "verify") return emit(core.bgpRouter.verifyRoute(J() as Parameters<typeof core.bgpRouter.verifyRoute>[0]));
        break;
      }
      case "brain": {
        if (o.action === "pack") { const cap = core.byob.makeCapsule({ owner: o.owner ?? "user", vendor: o.vendor, items: J() as Parameters<typeof core.byob.makeCapsule>[0]["items"] }); return emit({ capsule: cap, receipt: core.byob.packCapsule(o.cwd, cap) }); }
        if (o.action === "merge") { const both = J() as { a: Parameters<typeof core.byob.mergeCapsules>[0]; b: Parameters<typeof core.byob.mergeCapsules>[1] }; return emit(core.byob.mergeCapsules(both.a, both.b)); }
        break;
      }
      case "factwatch": {
        if (o.action === "observe") return emit(core.truthCdn.observe(o.cwd, { fact: o.fact ?? "", newValue: o.newValue ?? "", observedBy: o.observedBy ?? "agent" }, o.knownValue ?? ""));
        if (o.action === "apply") { const x = J() as { sub: Parameters<typeof core.truthCdn.applyInvalidation>[0]; receipt: unknown }; return emit(core.truthCdn.applyInvalidation(x.sub, x.receipt)); }
        break;
      }
      case "edge": {
        if (o.action === "card") return emit(core.edgeMesh.buildPeerCard(o.cwd, { peer: o.peer ?? "node", lanUrl: o.lanUrl ?? "" }));
        if (o.action === "merge") return emit(core.edgeMesh.mergeMesh(J() as unknown[]));
        break;
      }
      case "compound": {
        if (o.action === "consolidate") return emit(core.idleCompound.consolidate(J() as Parameters<typeof core.idleCompound.consolidate>[0], o.threshold));
        break;
      }
    }
  } catch (e) { out(`✗ ${(e as Error).message}\n`); return 2; }
  out(`✗ unknown ${o.family} action "${o.action}"\n`); return 2;
}
