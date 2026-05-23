/**
 * v2.39.0 — Cross-OS polygraph classifier.
 *
 * Identifies which interception strategy is available on the host OS
 * + probes whether Mneme's HTTP bridge (:17741) is reachable. The
 * REAL interception per-OS is shipped by other primitives:
 *   - Windows: DLL chrysalis (v2.19.64) + .cmd shim handling
 *   - POSIX: signal-based stdout tap (proposed; not yet shipped)
 *   - All:    HTTP bridge polygraph (mneme polygraph autosetup)
 *
 * This module is the CLASSIFIER — it tells callers what's available,
 * doesn't itself intercept anything. Defensive: never throws.
 */

import type { OSPolygraphFinding } from "./types.js";
import { probeBridge } from "../bridge_phoenix/index.js";

export async function classifyOS(): Promise<OSPolygraphFinding> {
  const platform = process.platform;
  const arch = process.arch;
  const notes: string[] = [];
  let interceptionStrategy: OSPolygraphFinding["interceptionStrategy"] = "polygraph-bridge";

  if (platform === "win32") {
    interceptionStrategy = "windows-dll-chrysalis";
    notes.push("v2.19.64 WASM CHRYSALIS extracts DLLs to per-PID tmpdir; EBUSY structurally impossible at install.");
  } else if (platform === "darwin" || platform === "linux") {
    interceptionStrategy = "posix-signals";
    notes.push("POSIX stdout tap not yet shipped as a runtime hook; polygraph bridge is the cross-platform fallback.");
  }

  let bridgeReachable: boolean | null = null;
  try {
    const probe = await probeBridge(17741, 1500);
    bridgeReachable = probe.ok;
    if (!probe.ok) notes.push(`bridge probe :17741 → not reachable (${probe.reason ?? "no reason"}); run \`mneme bridge --detach\` or \`mneme polygraph autosetup\``);
    else notes.push("bridge :17741 reachable (polygraph route armed).");
  } catch {
    bridgeReachable = null;
    notes.push("bridge probe threw (treating as unknown).");
  }

  return { platform, arch, interceptionStrategy, bridgeReachable, notes };
}
