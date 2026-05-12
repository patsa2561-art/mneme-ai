/**
 * v1.71.0 -- SENTINEL S1: DANGEROUS COMMAND DETECTOR.
 *
 * PRECOG was about CLAIMS (hallucinated facts). SENTINEL is about
 * ACTIONS (dangerous commands). The same intercept pattern, applied
 * to the MCP boundary: every shell command the AI proposes passes
 * through SENTINEL before execution.
 *
 * Catalog of 30+ dangerous patterns, organized into 8 risk classes:
 *   - mass-delete       rm -rf /, find -delete on / | $HOME
 *   - pipe-to-shell     curl URL | sh, wget URL | bash
 *   - fork-bomb         :(){:|:&};:
 *   - disk-wipe         dd if=... of=/dev/sda
 *   - permission-bomb   chmod 777 /, chown nobody /
 *   - exfiltration      tar ... | nc, scp to unknown
 *   - net-scan          nmap, masscan, nikto, sqlmap
 *   - credential-leak   cat .env | curl, .ssh access
 *
 * Each detection carries a RISK LEVEL (low/medium/high/critical) so
 * the orchestrator can decide block vs warn vs allow-with-audit.
 */

export type RiskClass =
  | "mass-delete"
  | "pipe-to-shell"
  | "fork-bomb"
  | "disk-wipe"
  | "permission-bomb"
  | "exfiltration"
  | "net-scan"
  | "credential-leak"
  | "privilege-escalation"
  | "process-kill"
  | "history-tamper";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface DangerSignature {
  id: string;
  /** Regex on the full command. */
  pattern: RegExp;
  risk: RiskLevel;
  class: RiskClass;
  /** Plain-English why this is dangerous. */
  rationale: string;
  /** Optional safe-context override -- if this regex ALSO matches, the
   *  command is LIKELY safe even though the main pattern fired. */
  safeContext?: RegExp;
}

export const DANGER_CATALOG: DangerSignature[] = [
  // ─── mass-delete ────────────────────────────────────────────────
  {
    id: "rm-rf-root",
    pattern: /\brm\s+(-[rfRF]+\s+)*\/(\s|$)/,
    risk: "critical", class: "mass-delete",
    rationale: "rm -rf / wipes the entire filesystem.",
  },
  {
    id: "rm-rf-home",
    pattern: /\brm\s+(-[rfRF]+\s+)*(\$HOME|~)(\s|\/|$)/,
    risk: "critical", class: "mass-delete",
    rationale: "rm -rf $HOME deletes the user's entire home directory.",
  },
  {
    id: "rm-rf-star",
    pattern: /\brm\s+(-[rfRF]+\s+)*[*]/,
    risk: "high", class: "mass-delete",
    rationale: "rm -rf * recursively deletes everything in the current directory.",
  },
  {
    id: "rm-rf-unvalidated-var",
    pattern: /\brm\s+(-[rfRF]+\s+)*"?\$\{?[A-Z_][A-Z0-9_]*\}?"?/,
    risk: "high", class: "mass-delete",
    rationale: "rm -rf $VAR -- if VAR is empty or attacker-controlled, this becomes rm -rf with unintended scope.",
    safeContext: /\brm\s+(-[rfRF]+\s+)*"?\$\{?[A-Z_]+\}?\/[\w.-]+/, // OK if VAR is followed by a fixed subpath
  },
  {
    id: "find-delete-root",
    pattern: /\bfind\s+\/\s+.*-delete\b/,
    risk: "critical", class: "mass-delete",
    rationale: "find / ... -delete walks from root and deletes everything matching.",
  },
  {
    id: "find-delete-home",
    pattern: /\bfind\s+(\$HOME|~)\s+.*-delete\b/,
    risk: "high", class: "mass-delete",
    rationale: "find $HOME ... -delete walks home dir and deletes.",
  },

  // ─── pipe-to-shell ─────────────────────────────────────────────
  {
    id: "curl-pipe-sh",
    pattern: /\bcurl\s+[^|]+\|\s*(sh|bash|zsh|fish)\b/,
    risk: "critical", class: "pipe-to-shell",
    rationale: "Piping curl output directly into a shell runs UNTRUSTED code without inspection.",
  },
  {
    id: "wget-pipe-sh",
    pattern: /\bwget\s+[^|]+\|\s*(sh|bash|zsh|fish)\b/,
    risk: "critical", class: "pipe-to-shell",
    rationale: "Piping wget output directly into a shell runs untrusted code.",
  },
  {
    id: "curl-eval",
    pattern: /\beval\s+["'`]?\$\(\s*curl\b/,
    risk: "critical", class: "pipe-to-shell",
    rationale: "eval $(curl ...) executes whatever the URL returns.",
  },

  // ─── fork-bomb ─────────────────────────────────────────────────
  {
    id: "classic-fork-bomb",
    pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    risk: "critical", class: "fork-bomb",
    rationale: "Classic fork bomb -- spawns processes recursively until system exhaustion.",
  },

  // ─── disk-wipe ─────────────────────────────────────────────────
  {
    id: "dd-to-disk",
    pattern: /\bdd\s+.*\bof=\/dev\/(sd[a-z]|nvme|hd[a-z]|disk)/,
    risk: "critical", class: "disk-wipe",
    rationale: "dd writes raw bytes to a block device -- corrupts the disk.",
  },
  {
    id: "mkfs-on-device",
    pattern: /\bmkfs\.\w+\s+\/dev\//,
    risk: "critical", class: "disk-wipe",
    rationale: "Formatting a block device wipes the partition.",
  },

  // ─── permission-bomb ───────────────────────────────────────────
  {
    id: "chmod-777-root",
    pattern: /\bchmod\s+(-[rfR]+\s+)?7{3,4}\s+\/\s*$/,
    risk: "critical", class: "permission-bomb",
    rationale: "chmod 777 / makes everything world-writable.",
  },
  {
    id: "chmod-r-root",
    pattern: /\bchmod\s+-R\s+\S+\s+\/\s*$/,
    risk: "high", class: "permission-bomb",
    rationale: "chmod -R on / changes permissions on every file.",
  },
  {
    id: "chown-root",
    pattern: /\bchown\s+(-R\s+)?\S+\s+\/\s*$/,
    risk: "high", class: "permission-bomb",
    rationale: "chown ... / changes ownership of the entire filesystem.",
  },

  // ─── exfiltration ──────────────────────────────────────────────
  {
    id: "tar-pipe-nc",
    pattern: /\btar\b.*\|\s*nc\s+\S+\s+\d+/,
    risk: "high", class: "exfiltration",
    rationale: "tar | nc pipes archive contents over the network to an arbitrary host.",
  },
  {
    id: "curl-upload-secret",
    pattern: /\b(curl|wget)\b[^|\n]*[@=]\.(env|aws|ssh|gpg|pem|key|credentials)\b/i,
    risk: "critical", class: "exfiltration",
    rationale: "Uploading dotfile credentials (.env / .aws / .ssh / .gpg) to an external host.",
  },
  {
    id: "scp-secret",
    pattern: /\bscp\s+.*\.(env|aws|ssh|gpg|pem|key)\b/,
    risk: "high", class: "exfiltration",
    rationale: "scp transferring credential-bearing files to a remote host.",
  },

  // ─── net-scan ──────────────────────────────────────────────────
  {
    id: "nmap-scan",
    pattern: /\bnmap\s+.*(--script|--top-ports|-p-|-sS|-sV)/,
    risk: "medium", class: "net-scan",
    rationale: "nmap port scan -- often abused as recon for attacks.",
  },
  {
    id: "masscan",
    pattern: /\bmasscan\s+/,
    risk: "high", class: "net-scan",
    rationale: "masscan is a fast network scanner; commonly used for botnet recon.",
  },
  {
    id: "sqlmap",
    pattern: /\bsqlmap\s+.*-u\b/,
    risk: "high", class: "net-scan",
    rationale: "sqlmap is an automated SQL injection tool; using it on remote URLs is attack-shaped.",
  },
  {
    id: "nikto",
    pattern: /\bnikto\s+.*-h\b/,
    risk: "medium", class: "net-scan",
    rationale: "nikto is a vulnerability scanner.",
  },

  // ─── credential-leak ───────────────────────────────────────────
  {
    id: "cat-env-pipe",
    pattern: /\bcat\s+["']?\.env["']?\s*\|/,
    risk: "high", class: "credential-leak",
    rationale: "cat .env | ... pipes secret env vars to another process.",
  },
  {
    id: "cat-ssh-key",
    pattern: /\bcat\s+["']?[~/.]*\.ssh\/(id_[a-z0-9]+|.*key.*)/,
    risk: "high", class: "credential-leak",
    rationale: "Reading SSH private keys.",
  },
  {
    id: "cat-aws-creds",
    pattern: /\bcat\s+["']?[~/.]*\.aws\/credentials/,
    risk: "high", class: "credential-leak",
    rationale: "Reading AWS credentials file.",
  },
  {
    id: "git-credential-show",
    pattern: /\bgit\s+credential\s+(fill|approve|show)/,
    risk: "medium", class: "credential-leak",
    rationale: "Direct git credential commands -- usually not needed in scripts.",
  },

  // ─── privilege-escalation ──────────────────────────────────────
  {
    id: "sudo-rm",
    pattern: /\bsudo\s+rm\s+(-[rfRF]+\s+)*\//,
    risk: "critical", class: "privilege-escalation",
    rationale: "sudo combined with rm at root -- highest possible blast radius.",
  },
  {
    id: "sudo-curl-pipe",
    pattern: /\bsudo\s+(sh|bash)\s+(-c\s+)?["']?.*\bcurl\b/,
    risk: "critical", class: "privilege-escalation",
    rationale: "sudo running a shell that curls + executes -- privilege + untrusted code.",
  },
  {
    id: "passwd-change",
    pattern: /\bpasswd\s+(root|admin|\$\w+)/,
    risk: "high", class: "privilege-escalation",
    rationale: "Changing root/admin password.",
  },
  {
    id: "usermod-root-shell",
    pattern: /\busermod\s+.*-s\s+\/bin\/(sh|bash)\s+/,
    risk: "high", class: "privilege-escalation",
    rationale: "Changing a user's login shell -- can be used to plant a backdoor.",
  },

  // ─── process-kill ──────────────────────────────────────────────
  {
    id: "kill-pid-1",
    pattern: /\bkill\s+(-9\s+)?(1|init)\b/,
    risk: "high", class: "process-kill",
    rationale: "Killing PID 1 (init) -- crashes the system.",
  },
  {
    id: "killall-essential",
    pattern: /\bkillall\s+(-9\s+)?(systemd|init|sshd|rsyslog|cron)/,
    risk: "high", class: "process-kill",
    rationale: "Killing essential system processes.",
  },

  // ─── history-tamper ────────────────────────────────────────────
  {
    id: "history-c",
    pattern: /\bhistory\s+-c\b/,
    risk: "medium", class: "history-tamper",
    rationale: "Clearing shell history -- often done to hide a prior dangerous command.",
  },
  {
    id: "remove-bash-history",
    pattern: /\brm\s+(-f\s+)?["']?[~/.]*\.bash_history/,
    risk: "medium", class: "history-tamper",
    rationale: "Deleting .bash_history file.",
  },
];

export interface DetectionMatch {
  signature: DangerSignature;
  /** What part of the command actually matched. */
  matchedText: string;
  /** Offset in the input. */
  offset: number;
}

export interface CommandDetectionReport {
  command: string;
  matches: DetectionMatch[];
  /** Highest risk-level among matches. */
  highestRisk: RiskLevel | null;
  /** All matched classes. */
  classes: RiskClass[];
  /** Plain-English headline. */
  headline: string;
  /** ms. */
  ms: number;
}

const RISK_RANK: Record<RiskLevel, number> = { low: 1, medium: 2, high: 3, critical: 4 };

export function detectDangerous(command: string): CommandDetectionReport {
  const t0 = Date.now();
  const matches: DetectionMatch[] = [];
  for (const sig of DANGER_CATALOG) {
    const m = sig.pattern.exec(command);
    if (!m) continue;
    if (sig.safeContext && sig.safeContext.test(command)) continue;
    matches.push({ signature: sig, matchedText: m[0], offset: m.index });
  }
  // Dedupe overlapping matches: prefer higher risk at same offset range.
  matches.sort((a, b) => RISK_RANK[b.signature.risk] - RISK_RANK[a.signature.risk]);
  let highestRisk: RiskLevel | null = matches.length === 0 ? null : matches[0]!.signature.risk;
  const classes = [...new Set(matches.map((m) => m.signature.class))];
  const headline = matches.length === 0
    ? "Command appears safe (no SENTINEL pattern matched)."
    : `${matches.length} risk signature(s) matched; highest=${highestRisk}; classes=${classes.join(", ")}.`;
  return { command, matches, highestRisk, classes, headline, ms: Date.now() - t0 };
}

/** Return only the catalog entries for a class, for inspection. */
export function listByClass(cls: RiskClass): DangerSignature[] {
  return DANGER_CATALOG.filter((s) => s.class === cls);
}
