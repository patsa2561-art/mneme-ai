/**
 * v1.86.0 -- CHAMELEON: transport selector.
 *
 * Given the environment probe + the user's destination intent, returns
 * the safest transport. Mutates with the environment: in a corporate
 * office repo with CI + CODEOWNERS, it refuses to recommend Spore.
 * In a personal repo, Spore is fine. On a phone target, RELAY wins.
 */

import type { EnvProbe } from "./env_probe.js";

export type Destination =
  | "same-pc-other-ai"
  | "same-wifi-other-device"
  | "phone-or-mobile-app"
  | "different-network-personal"
  | "offline-usb"
  | "continuous-sync";

export type TransportId =
  | "clipboard"
  | "nexus-local"
  | "aura-lan"
  | "relay-paste"
  | "gist"
  | "wanderer-mwt"
  | "time-capsule"
  | "spore-git";

export interface Recommendation {
  primary: TransportId;
  fallbacks: TransportId[];
  reasons: string[];
  warnings: string[];
}

export function selectTransport(dest: Destination, env: EnvProbe): Recommendation {
  const r: Recommendation = { primary: "clipboard", fallbacks: [], reasons: [], warnings: [] };
  switch (dest) {
    case "same-pc-other-ai":
      r.primary = "clipboard";
      r.reasons.push("destination is the same machine -- clipboard is zero-friction");
      r.fallbacks = ["nexus-local"];
      break;
    case "same-wifi-other-device":
      r.primary = "aura-lan";
      r.reasons.push("same WiFi: AURA bridge is fastest + owner-only (no broadcast)");
      r.fallbacks = ["nexus-local", "relay-paste"];
      break;
    case "phone-or-mobile-app":
      r.primary = "relay-paste";
      r.reasons.push("mobile AI apps do not have Mneme -- RELAY uploads encrypted soul to anonymous paste; AI fetches + decrypts");
      r.fallbacks = ["gist", "nexus-local"];
      break;
    case "different-network-personal":
      // Default to RELAY because it never touches user's git.
      r.primary = "relay-paste";
      r.reasons.push("anonymous paste relay works without git + without GitHub account");
      r.fallbacks = ["gist", "wanderer-mwt"];
      break;
    case "offline-usb":
      r.primary = "wanderer-mwt";
      r.reasons.push("offline: portable .mwt with portableSig verifies cross-machine without HMAC sharing");
      r.fallbacks = ["time-capsule"];
      break;
    case "continuous-sync":
      // Spore is only safe when user-owned + no CI + no codeowners.
      if (env.hasGit && env.isUserOwned === true && !env.hasCi && !env.hasCodeowners) {
        r.primary = "spore-git";
        r.reasons.push("personal repo with no CI/CODEOWNERS -- spore git push is safe");
        r.fallbacks = ["relay-paste"];
      } else {
        r.primary = "relay-paste";
        r.reasons.push("environment is NOT safe for spore push -- using RELAY instead");
        for (const reason of env.riskReasons) r.warnings.push(reason);
        r.fallbacks = ["gist", "wanderer-mwt"];
      }
      break;
  }
  // Add a global warning if git is unavailable -- pruning git-based fallbacks.
  if (!env.hasGit) {
    r.warnings.push("git is not installed -- removing git-dependent fallbacks (gist, spore-git)");
    r.fallbacks = r.fallbacks.filter((t) => t !== "gist" && t !== "spore-git");
  }
  return r;
}
