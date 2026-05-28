/**
 * v2.82.0 — MESH IMMUNE SYSTEM · cross-agent injection/collusion firewall (TRUST FABRIC 💎7).
 *
 * When agents call agents (A2A), a prompt injection becomes a CONTAGION: one
 * poisoned agent infects everything downstream — a new supply-chain attack class.
 * MESH IMMUNE puts every cross-agent message through a firewall: detect injection
 * + collusion + self-replication signatures, decide ALLOW / FLAG / QUARANTINE, and
 * track propagation so a downstream agent inherits its upstream's infection.
 *
 * Composes the v2.78 WORM-CANARY (self-replication + AI-imperative signatures) and
 * adds injection-specific + collusion detectors. Pure functions — no I/O, total,
 * deterministic, never throws.
 */

import { scanForWormSignatures, type WormFinding } from "../immune/worm_canary.js";

export type ThreatKind =
  | "prompt-override"     // "ignore previous instructions", "you are now…"
  | "system-prompt-leak"  // "reveal your system prompt", "print your instructions"
  | "exfiltration"        // "send the API key / .env / credentials to…"
  | "tool-coercion"       // self-replication / auto-exec (from WORM-CANARY)
  | "collusion";          // "don't tell the user", "skip verification", "agree with me"

export interface MeshThreat {
  kind: ThreatKind;
  reason: string;
  match: string;
  severity: "low" | "high";
}

export interface MeshScan {
  clean: boolean;
  threats: MeshThreat[];
  /** Highest severity present. */
  maxSeverity: "none" | "low" | "high";
}

export type Disposition = "ALLOW" | "FLAG" | "QUARANTINE";

const PATTERNS: Array<{ kind: ThreatKind; re: RegExp; severity: "low" | "high"; reason: string }> = [
  { kind: "prompt-override", severity: "high", reason: "attempts to override prior instructions", re: /\b(ignore|disregard|forget)\s+(all\s+|the\s+|your\s+|any\s+)?(previous|prior|earlier|above|preceding)\s+(instructions?|prompts?|context|rules?)\b/i },
  { kind: "prompt-override", severity: "high", reason: "role/persona hijack", re: /\byou\s+are\s+now\b|\bfrom\s+now\s+on,?\s+you\b|\bnew\s+(system\s+)?(instructions?|persona|role)\s*:/i },
  { kind: "system-prompt-leak", severity: "high", reason: "tries to exfiltrate the system prompt", re: /\b(reveal|print|show|repeat|output|dump)\s+(me\s+)?(your|the)\s+(system\s+prompt|instructions?|initial\s+prompt|guidelines)\b/i },
  { kind: "exfiltration", severity: "high", reason: "tries to exfiltrate secrets/credentials", re: /\b(send|post|exfiltrate|upload|leak|email|curl|fetch)\b[^.\n]{0,40}\b(api[_\s-]?key|secret|password|credential|\.env|token|private\s+key)\b/i },
  { kind: "collusion", severity: "high", reason: "asks to hide from the user", re: /\b(don'?t|do\s+not|never)\s+(tell|inform|notify|mention\s+to|alert)\s+(the\s+)?user\b/i },
  { kind: "collusion", severity: "low", reason: "asks to skip verification", re: /\b(skip|bypass|disable|don'?t\s+bother\s+with)\s+(the\s+)?(verification|checks?|validation|review|audit)\b/i },
  { kind: "collusion", severity: "low", reason: "pressures blind agreement", re: /\b(just\s+)?(agree\s+with\s+me|confirm\s+(this|it)\s+without|say\s+yes|don'?t\s+question)\b/i },
];

/** Scan one cross-agent message for threats. */
export function scanMessage(text: string): MeshScan {
  const threats: MeshThreat[] = [];
  if (text && typeof text === "string") {
    for (const p of PATTERNS) {
      const m = p.re.exec(text);
      if (m) threats.push({ kind: p.kind, reason: p.reason, match: m[0].slice(0, 100), severity: p.severity });
    }
    // Reuse WORM-CANARY for self-replication / auto-exec tool coercion.
    const worm = scanForWormSignatures(text);
    for (const w of worm.findings as WormFinding[]) {
      threats.push({ kind: "tool-coercion", reason: w.reason, match: w.match, severity: "high" });
    }
  }
  const maxSeverity: MeshScan["maxSeverity"] = threats.some((t) => t.severity === "high") ? "high" : threats.length ? "low" : "none";
  return { clean: threats.length === 0, threats, maxSeverity };
}

/** Firewall decision for a message. High → QUARANTINE, low → FLAG, none → ALLOW. */
export function quarantineDecision(scan: MeshScan): Disposition {
  if (scan.maxSeverity === "high") return "QUARANTINE";
  if (scan.maxSeverity === "low") return "FLAG";
  return "ALLOW";
}

export interface HopInput {
  agent: string;
  text: string;
  /** Was the upstream hop (the agent that produced this hop's input) infected? */
  upstreamInfected?: boolean;
}
export interface HopVerdict {
  agent: string;
  disposition: Disposition;
  infected: boolean;
  threats: MeshThreat[];
  /** infected because of its OWN content, or inherited from upstream. */
  source: "own" | "inherited" | "clean";
}

/**
 * Walk an A2A message chain. A hop is infected if its OWN content quarantines OR
 * its upstream was infected (contagion). Once infected, the rest of the chain is
 * quarantined — the supply-chain firewall.
 */
export function traceContagion(hops: HopInput[]): { verdicts: HopVerdict[]; quarantined: number; firstInfectedAt: number | null } {
  const verdicts: HopVerdict[] = [];
  let upstreamInfected = false;
  let firstInfectedAt: number | null = null;
  for (let i = 0; i < hops.length; i++) {
    const h = hops[i]!;
    const scan = scanMessage(h.text);
    const disp = quarantineDecision(scan);
    const ownInfected = disp === "QUARANTINE";
    const inherited = upstreamInfected || h.upstreamInfected === true;
    const infected = ownInfected || inherited;
    const source: HopVerdict["source"] = ownInfected ? "own" : inherited ? "inherited" : "clean";
    if (infected && firstInfectedAt === null) firstInfectedAt = i;
    verdicts.push({ agent: h.agent, disposition: infected ? "QUARANTINE" : disp, infected, threats: scan.threats, source });
    if (infected) upstreamInfected = true; // contagion propagates downstream
  }
  return { verdicts, quarantined: verdicts.filter((v) => v.infected).length, firstInfectedAt };
}
