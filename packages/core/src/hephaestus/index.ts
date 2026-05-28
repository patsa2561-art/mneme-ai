/**
 * v2.86.0 — HEPHAESTUS (Ἥφαιστος, the smith god) · GEPHYRA's OS lane.
 *
 * NOT "an AI that runs commands" (that's Grok Computer / Warp / Claude Code —
 * crowded, we'd lose). HEPHAESTUS is the neutral SUBSTRATE a shell + AI run ON:
 * every command that wants to touch the machine first CROSSES it — gets risk-
 * classified, policy-gated, optionally judged by a cross-vendor tribunal, has its
 * output immune-scanned, and is recorded as a signed, tamper-evident crossing
 * (who: human vs which AI). It is GEPHYRA's claim-crossing, applied to COMMANDS.
 *
 * DECISION-FIRST, EXECUTION-OPTIONAL: the value is the SIGNED VERDICT (ALLOW /
 * NEEDS_COSIGN / BLOCK + reasons + tribunal + provenance), not the runner. The
 * gate is pure logic → deterministic + identical across every OS. Execution is a
 * separate, guarded, opt-in step.
 *
 * THE SAFETY INVARIANT (pinned in tests): a DESTRUCTIVE command can NEVER be ALLOW
 * without an explicit co-sign. A fox cannot guard its own henhouse — so for
 * destructive ops a cross-vendor tribunal (Grok+Gemini+Claude, UNcorrelated errors)
 * judges, and Mneme — owned by no vendor — is the only legitimate convener.
 *
 * Composes flight_recorder (the black box) + notary (the stamp) + mesh_immune
 * (injection scan). Never throws — every organ degrades gracefully.
 */

import { record, replay, readCdr } from "../flight_recorder/index.js";
import { scanMessage, quarantineDecision, type MeshThreat } from "../mesh_immune/index.js";
import { verifyReceipt, type NotaryReceipt } from "../notary/index.js";

export type CommandRisk = "read" | "write" | "destructive";
export type Disposition = "ALLOW" | "NEEDS_COSIGN" | "BLOCK";
export type TribunalConsensus = "safe" | "danger" | "split";

export interface RiskClassification { risk: CommandRisk; signals: string[] }

// Order matters: destructive patterns win over write/read.
const DESTRUCTIVE: Array<[RegExp, string]> = [
  [/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|-rf|-fr)\b/i, "rm -rf"],
  [/\brm\s+-[a-z]*r\b/i, "recursive rm"],
  [/\b(rmdir|rd)\s+\/s\b/i, "rmdir /s"],
  [/\bdel\s+\/[a-z]*[qsf]/i, "del /q|/s|/f"],
  [/\b(mkfs|fdisk|parted|wipefs|diskpart)\b/i, "disk format/partition"],
  [/\bdd\s+if=/i, "dd"],
  [/>\s*\/dev\/(sd|nvme|disk)/i, "write to raw disk"],
  [/\bformat\s+[a-z]:/i, "format drive"],
  [/\bkubectl\s+delete\b/i, "kubectl delete"],
  [/\bhelm\s+(delete|uninstall)\b/i, "helm delete"],
  [/\bterraform\s+destroy\b/i, "terraform destroy"],
  [/\bdocker\s+(system\s+prune|rm\s+-f|volume\s+rm)\b/i, "docker destructive"],
  [/\bdrop\s+(table|database|schema|index|view|user|role)\b/i, "SQL drop"],
  [/\btruncate\s+(table\s+)?["`[]?\w/i, "SQL truncate"],
  [/\bdelete\s+from\b(?![^;]*\bwhere\b)/i, "SQL delete without where"],
  [/\bgit\s+(push\s+(-f|--force)|reset\s+--hard|clean\s+-[a-z]*f)/i, "git force/reset/clean"],
  [/\b(shutdown|reboot|halt|poweroff|Stop-Computer|Restart-Computer)\b/i, "power state"],
  [/\b(systemctl|service)\s+(stop|disable|mask)\b/i, "stop/disable service"],
  [/\bchmod\s+-R\s+777\b/i, "chmod -R 777"],
  [/:\s*\(\s*\)\s*\{.*\|.*&\s*\}\s*;/i, "fork bomb"],
  [/\b(Remove-Item|ri|rm)\b.*-Recurse.*-Force|\b(Remove-Item|ri)\b.*-Force.*-Recurse/i, "Remove-Item -Recurse -Force"],
];
const WRITE: Array<[RegExp, string]> = [
  [/\b(apt|apt-get|yum|dnf|brew|npm|pnpm|yarn|pip|pip3|cargo|gem)\s+(install|add|i|update|upgrade)\b/i, "package install"],
  [/\b(mv|cp|mkdir|touch|ln|chmod|chown|tee|truncate)\b/i, "filesystem write"],
  [/>>?\s*[^&|]/, "output redirect"],
  [/\bsed\s+-i\b|\bperl\s+-i\b/i, "in-place edit"],
  [/\bgit\s+(commit|merge|rebase|checkout|stash|add|tag)\b/i, "git mutate"],
  [/\b(Set-|New-|Add-|Out-File|Set-Content|Add-Content)\b/, "PowerShell write cmdlet"],
  [/\b(docker\s+(run|build|start)|kubectl\s+(apply|create|patch|scale)|systemctl\s+(start|restart|enable))\b/i, "deploy/start"],
  [/\b(echo|printf)\b.*>/, "write via echo"],
];
const READ: Array<[RegExp, string]> = [
  [/^\s*(ls|dir|cat|bat|head|tail|less|more|grep|rg|find|fd|wc|ps|top|htop|df|du|free|ss|netstat|lsof|ip|ifconfig|ping|traceroute|whoami|id|pwd|cd|which|where|env|printenv|uname|hostname|date|uptime|history|stat|file|tree|jq|awk|sort|uniq|diff)\b/i, "read tool"],
  [/\b(kubectl\s+(get|describe|logs|top)|docker\s+(ps|images|logs|inspect)|systemctl\s+status|git\s+(status|log|diff|show|branch))\b/i, "read subcommand"],
  [/\b(Get-|Test-|Measure-|Select-|Where-|Format-)\b/, "PowerShell read cmdlet"],
  [/^\s*(echo|printf)\b(?![^|]*>)/, "echo (no redirect)"],
];

/**
 * Classify a command's blast radius. Destructive wins, then write, then read.
 * UNKNOWN defaults to "write" (conservative — gets policy-gated, never silently
 * treated as harmless). Deterministic + OS-agnostic (pure pattern logic).
 */
export function classifyCommandRisk(command: string): RiskClassification {
  const c = String(command ?? "");
  const signals: string[] = [];
  for (const [re, label] of DESTRUCTIVE) if (re.test(c)) signals.push(label);
  if (signals.length) return { risk: "destructive", signals };
  for (const [re, label] of WRITE) if (re.test(c)) signals.push(label);
  if (signals.length) return { risk: "write", signals };
  for (const [re, label] of READ) if (re.test(c)) signals.push(label);
  if (signals.length) return { risk: "read", signals };
  return { risk: "write", signals: ["unknown command — defaulting to write (gated)"] };
}

export interface Policy {
  /** Destructive commands require an explicit human co-sign. Default true. */
  destructiveNeedsCosign: boolean;
  /** On hosts tagged prod, anything beyond read-only is blocked. Default false. */
  prodReadOnly: boolean;
}

export const DEFAULT_POLICY: Policy = { destructiveNeedsCosign: true, prodReadOnly: false };

/** Parse a one-time, plain-language policy ("destructive must co-sign, prod is read-only"). */
export function parsePolicy(text: string): Policy {
  const t = String(text ?? "").toLowerCase();
  const mentionsDestructive = /destructive|dangerous|rm|delete|drop/.test(t);
  const mentionsCosign = /co-?sign|cosign|human|approval|confirm|two-person|2-person/.test(t);
  const noCosign = /no\s+co-?sign|without\s+co-?sign|don'?t\s+(require\s+)?co-?sign/.test(t);
  const prodReadOnly = /prod[a-z]*\s*(is\s*)?(read[- ]?only|ro\b|no\s+writes?)/.test(t) || /read[- ]?only\s+(on\s+)?prod/.test(t);
  return {
    destructiveNeedsCosign: noCosign ? false : (mentionsDestructive && mentionsCosign ? true : DEFAULT_POLICY.destructiveNeedsCosign),
    prodReadOnly: prodReadOnly || DEFAULT_POLICY.prodReadOnly,
  };
}

export interface CrossCommandInput {
  command: string;
  /** Who is asking — "human" or an AI agent id (claude/grok/gemini/cursor/...). */
  agent: string;
  /** Optional host/context tag (e.g. "prod-db-1"). "prod" substring triggers prodReadOnly. */
  host?: string;
  /** A human co-sign was provided out-of-band for a destructive op. */
  cosigned?: boolean;
}

export interface CrossCommandDeps {
  policy?: Policy;
  /** The cross-vendor TRIBUNAL — judge a destructive command via independent
   *  vendors (e.g. via diff_arena adapters). Mneme is the neutral convener.
   *  Returns each vendor's verdict + the consensus. Pluggable; CLI/MCP wire it. */
  tribunal?: (command: string, risk: CommandRisk) => Promise<{ verdicts: Array<{ vendor: string; verdict: "safe" | "danger" }>; consensus: TribunalConsensus }>;
  now?: number;
}

export interface CrossCommandResult {
  disposition: Disposition;
  risk: CommandRisk;
  signals: string[];
  reasons: string[];
  agent: string;
  host: string | null;
  /** provenance: was the requester a human or an AI? */
  origin: "human" | "ai";
  threats: MeshThreat[];
  tribunal?: { verdicts: Array<{ vendor: string; verdict: "safe" | "danger" }>; consensus: TribunalConsensus };
  /** The tamper-evident signed crossing (flight-recorder frame's NOTARY receipt). */
  receipt: NotaryReceipt | null;
  degraded: string[];
}

/**
 * Cross a command into the OS: classify → immune-scan → policy/tribunal gate →
 * record a signed provenance frame → return the verdict. NEVER executes here and
 * NEVER throws. The SAFETY INVARIANT holds: destructive ⇒ never ALLOW without a
 * co-sign (or a unanimous-safe tribunal under a no-cosign policy).
 */
export async function crossCommand(repoRoot: string, input: CrossCommandInput, deps: CrossCommandDeps = {}): Promise<CrossCommandResult> {
  const degraded: string[] = [];
  const command = String(input.command ?? "");
  const agent = String(input.agent ?? "unknown");
  const host = input.host ? String(input.host) : null;
  const origin: "human" | "ai" = /^human$|^user$/i.test(agent) ? "human" : "ai";
  const policy = deps.policy ?? DEFAULT_POLICY;
  const reasons: string[] = [];

  // 1. IMMUNE — injection hidden in the command itself.
  let threats: MeshThreat[] = [];
  try { const scan = scanMessage(command); threats = scan.threats; if (quarantineDecision(scan) === "QUARANTINE") reasons.push("injection signature in command"); }
  catch (e) { degraded.push(`immune:${(e as Error).message}`); }
  const injected = reasons.length > 0;

  // 2. RISK.
  const { risk, signals } = classifyCommandRisk(command);

  // 3/4. POLICY + TRIBUNAL gate → disposition.
  let disposition: Disposition;
  let tribunal: CrossCommandResult["tribunal"];
  const prodLocked = policy.prodReadOnly && !!host && /prod/i.test(host) && risk !== "read";

  if (injected) {
    disposition = "BLOCK";
  } else if (prodLocked) {
    disposition = "BLOCK";
    reasons.push(`policy: ${host} is prod / read-only — ${risk} command blocked`);
  } else if (risk === "destructive") {
    if (deps.tribunal) {
      try {
        const r = await deps.tribunal(command, risk);
        tribunal = r;
        if (r.consensus === "danger" || r.consensus === "split") {
          disposition = "BLOCK";
          reasons.push(`tribunal: ${r.consensus} (${r.verdicts.map((v) => `${v.vendor}=${v.verdict}`).join(", ")}) — a fox can't guard its own henhouse`);
        } else {
          // unanimous safe — still co-sign unless policy waives it.
          disposition = policy.destructiveNeedsCosign && !input.cosigned ? "NEEDS_COSIGN" : "ALLOW";
          if (disposition === "NEEDS_COSIGN") reasons.push("destructive: tribunal says safe but policy requires human co-sign");
        }
      } catch (e) {
        degraded.push(`tribunal:${(e as Error).message}`);
        disposition = "BLOCK"; // tribunal down ⇒ fail CLOSED for destructive (safe default)
        reasons.push("tribunal unavailable — failing closed on a destructive command");
      }
    } else {
      disposition = input.cosigned ? "ALLOW" : (policy.destructiveNeedsCosign ? "NEEDS_COSIGN" : "ALLOW");
      if (disposition === "NEEDS_COSIGN") reasons.push("destructive command requires human co-sign");
    }
  } else if (risk === "write") {
    disposition = "ALLOW";
  } else {
    disposition = "ALLOW";
  }

  if (disposition === "ALLOW" && reasons.length === 0) reasons.push(`${risk} command — allowed`);

  // 5/6. BLACK BOX + STAMP — record the crossing (provenance: who + risk + verdict).
  const td = disposition === "BLOCK" ? "CONTRADICT" : disposition === "ALLOW" ? "MATCH" : "UNVERIFIED";
  let receipt: NotaryReceipt | null = null;
  try {
    const frame = record(repoRoot, {
      agent, kind: disposition === "ALLOW" ? "tool-call" : "decision",
      action: `heph:${disposition}:${command.slice(0, 80)}`,
      claim: command, observedReality: `${disposition} (${risk}) by ${origin}:${agent}`, truthDelta: td,
    });
    receipt = frame.receipt;
  } catch (e) { degraded.push(`recorder:${(e as Error).message}`); }

  return { disposition, risk, signals, reasons, agent, host, origin, threats, tribunal, receipt, degraded };
}

// ── Universal Polyglot Command — one intent, every shell ──────────────────
export type Platform = "linux" | "macos" | "powershell";

const POLYGLOT: Record<string, Record<Platform, string>> = {
  "list listening ports": { linux: "ss -tlnp", macos: "lsof -iTCP -sTCP:LISTEN -n -P", powershell: "Get-NetTCPConnection -State Listen" },
  "list processes": { linux: "ps aux", macos: "ps aux", powershell: "Get-Process" },
  "disk usage": { linux: "df -h", macos: "df -h", powershell: "Get-PSDrive -PSProvider FileSystem" },
  "memory usage": { linux: "free -h", macos: "vm_stat", powershell: "Get-CimInstance Win32_OperatingSystem | Select FreePhysicalMemory,TotalVisibleMemorySize" },
  "current directory": { linux: "pwd", macos: "pwd", powershell: "Get-Location" },
  "list files": { linux: "ls -la", macos: "ls -la", powershell: "Get-ChildItem -Force" },
  "environment variables": { linux: "printenv", macos: "printenv", powershell: "Get-ChildItem Env:" },
  "network interfaces": { linux: "ip addr", macos: "ifconfig", powershell: "Get-NetIPAddress" },
};

export function currentPlatform(): Platform {
  return process.platform === "win32" ? "powershell" : process.platform === "darwin" ? "macos" : "linux";
}

/** Translate a canonical intent to the right shell for a platform (default: this OS). */
export function polyglot(intent: string, platform?: Platform): { intent: string; platform: Platform; command: string } | null {
  const key = String(intent ?? "").toLowerCase().trim();
  const row = POLYGLOT[key];
  if (!row) return null;
  const p = platform ?? currentPlatform();
  return { intent: key, platform: p, command: row[p] };
}

export function polyglotIntents(): string[] { return Object.keys(POLYGLOT); }

// ── Immune Shell — scan command OUTPUT before it's fed back to the AI ──────
export function scanCommandOutput(output: string): { clean: boolean; threats: MeshThreat[] } {
  try { const s = scanMessage(String(output ?? "")); return { clean: s.clean, threats: s.threats }; }
  catch { return { clean: true, threats: [] }; }
}

// ── Execution (OPT-IN, GUARDED) — only runs an already-ALLOWed crossing ───
export interface ExecResult {
  ran: boolean;
  reason: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  outputThreats: MeshThreat[];
  receipt: NotaryReceipt | null;
}

/**
 * Execute a command ONLY if its crossing verdict is ALLOW. Captures stdout/stderr/
 * exit, immune-scans the output (so the AI isn't pwned by what it reads), and
 * records the result. Refuses anything not ALLOW. Cross-platform (uses the OS shell).
 */
export async function executeGuarded(
  repoRoot: string,
  input: { command: string; agent: string; disposition: Disposition; timeoutMs?: number },
): Promise<ExecResult> {
  if (input.disposition !== "ALLOW") {
    return { ran: false, reason: `refused: disposition is ${input.disposition}, not ALLOW`, exitCode: null, stdout: "", stderr: "", outputThreats: [], receipt: null };
  }
  const { spawnSync } = await import("node:child_process");
  let stdout = "", stderr = "", exitCode: number | null = null;
  try {
    const r = spawnSync(input.command, {
      shell: true, encoding: "utf8", timeout: input.timeoutMs ?? 30_000, windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    stdout = r.stdout ?? ""; stderr = r.stderr ?? ""; exitCode = r.status;
  } catch (e) {
    stderr = (e as Error).message; exitCode = null;
  }
  const scan = scanCommandOutput(stdout + "\n" + stderr);
  let receipt: NotaryReceipt | null = null;
  try {
    const frame = record(repoRoot, {
      agent: input.agent, kind: "tool-call", action: `heph:executed:${input.command.slice(0, 80)}`,
      claim: input.command, observedReality: `exit=${exitCode} outputThreats=${scan.threats.length}`,
      truthDelta: scan.clean ? "MATCH" : "CONTRADICT",
    });
    receipt = frame.receipt;
  } catch { /* */ }
  return { ran: true, reason: "executed", exitCode, stdout, stderr, outputThreats: scan.threats, receipt };
}

export interface HephStatus {
  crossings: number;
  allowed: number;
  needsCosign: number;
  blocked: number;
  chainValid: boolean;
}

/** Live HEPHAESTUS status from the shared flight-recorder black box. */
export function hephaestusStatus(repoRoot: string): HephStatus {
  try {
    const rep = replay(repoRoot);
    const frames = readCdr(repoRoot);
    let allowed = 0, needsCosign = 0, blocked = 0;
    for (const f of frames) {
      const p = (f.payload ?? {}) as { action?: string };
      if (typeof p.action !== "string" || !p.action.startsWith("heph:")) continue;
      if (p.action.startsWith("heph:ALLOW") || p.action.startsWith("heph:executed")) allowed++;
      else if (p.action.startsWith("heph:NEEDS_COSIGN")) needsCosign++;
      else if (p.action.startsWith("heph:BLOCK")) blocked++;
    }
    return { crossings: allowed + needsCosign + blocked, allowed, needsCosign, blocked, chainValid: rep.chainValid };
  } catch {
    return { crossings: 0, allowed: 0, needsCosign: 0, blocked: 0, chainValid: true };
  }
}

/** Verify a HEPHAESTUS crossing/execution receipt offline. */
export function verifyHephReceipt(receipt: unknown): { valid: boolean; reason: string } {
  const v = verifyReceipt(receipt);
  return { valid: v.valid, reason: v.reason };
}
