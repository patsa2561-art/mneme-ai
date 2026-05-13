# 🔄 Stays up to date — automatically

You install Mneme **once.** From that moment on:

```
   👤 You                        🤖 Your AI                🤖 Mneme daemon
   open computer ─────────►   "let's code"    
                                    │
                                    ▼
                              every MCP call
                              fires a pulse
                                    │
                                    ▼
                              [INFO] v1.92.0 available — auto-upgrade queued
                                    │
                                    ▼
                                                      🧠 SYSTEM-COMPAT probes:
                                                         · OS detected (Win/macOS/Linux + version)
                                                         · Node ≥ 22?
                                                         · npm / yarn / pnpm / brew / docker present?
                                                         · global-install path writable without sudo?
                                                         · which strategy succeeds on THIS machine?
                                                              ↓
                                                         verdict: SAFE / DEFER / BLOCK
                                                              ↓
                                                      if SAFE → spawn the right command
                                                         npm install -g  · OR
                                                         npm install --prefix ~/.local · OR
                                                         brew upgrade · OR
                                                         docker pull
                                                              ↓
                                                         done — silently, at safe-window tick
   keep coding ─────────►   "fix this bug"
                                    │
                                    ▼
                              new tools available
                              (next session inherits)
```

**You typed zero commands.** The pulse told the AI. The daemon ran SYSTEM-COMPAT. The right upgrade strategy spawned. You kept coding.

---

## What runs under the hood

| Layer | File | What it does |
|---|---|---|
| 🔍 Version probe | [`packages/core/src/version_check.ts`](../packages/core/src/version_check.ts) | Hourly non-blocking `GET registry.npmjs.org/mneme-ai/latest` (single GET, no telemetry, no auth) |
| 📣 Pulse surfacing | [`packages/core/src/pulse.ts`](../packages/core/src/pulse.ts) | If newer version found → push `[INFO] HIGH` line to your MCP inbox; visible on next `mneme.*` call |
| 🧠 SYSTEM-COMPAT gate | [`packages/core/src/system_compat/index.ts`](../packages/core/src/system_compat/index.ts) | Probes OS / Node / pkg-mgr / write-perms; returns SAFE/DEFER/BLOCK + the right shell command |
| 🤖 Daemon execution | [`packages/core/src/nucleus_daemon.ts`](../packages/core/src/nucleus_daemon.ts) | Caretaker tick drains the auto-action queue; **gates every `mneme.system.upgrade` through SYSTEM-COMPAT first** so silent failures are structurally impossible |
| 📜 Audit | [`packages/core/src/ai_compliance.ts`](../packages/core/src/ai_compliance.ts) | Every upgrade attempt logged HMAC-signed to `ai-compliance.jsonl` for SOC2 audit |

---

## OS + version matrix

SYSTEM-COMPAT tested on every combination below — auto-detects + adapts.

| Platform | Recognition | Upgrade strategy |
|---|---|---|
| **Windows 10/11** (x64 / ARM64) | `process.platform === "win32"` | `global-npm` (per-user prefix, no admin needed) |
| **macOS Big Sur → Sequoia** (Intel + Apple Silicon) | Darwin major-num → human label | `global-npm` when `/usr/local/lib/node_modules` writable; falls back to `user-npm` (`--prefix ~/.local`) or `docker` |
| **Linux** (any distro) | `process.platform === "linux"` + release | `global-npm` when prefix writable; `user-npm` for sudo-blocked machines; `docker` last resort |
| **Linux + nvm** | nvm sets prefix to user dir → fully writable | `global-npm` (recommended) |
| **macOS + Homebrew Node** | brew owns `/usr/local` | DEFER + tell user `npm config set prefix ~/.local` (we refuse to auto-sudo) |
| **WSL2** | platform=linux | treated as Linux |
| **Sandboxed agent** (no shell write) | detected via spawn-test | DEFER with inbox message — user runs upgrade manually |

---

## What the AI agent should know (for the install contract)

Add to your install routine:

```typescript
import { gateDaemonUpgrade, probeUpgradeEnvironment } from "@mneme-ai/core";

const probe = probeUpgradeEnvironment();
// probe.verdict: "SAFE" | "DEFER" | "BLOCK"
// probe.upgradeStrategy: "global-npm" | "user-npm" | "brew" | "docker" | "manual"
// probe.reasons: string[] — explain to user when not SAFE
// probe.pulseLine: one-line pulse summary

const gate = gateDaemonUpgrade();
if (!gate.shouldProceed) {
  // surface gate.inboxLine to the user; do NOT spawn an upgrade
} else {
  // spawn gate.command.cmd with gate.command.args
}
```

The daemon already does this on its drainQueue tick. AI agents that surface upgrade state to the user should call `probeUpgradeEnvironment` so they show the same verdict the daemon will act on.

---

## Configuration

| Behavior | How to change |
|---|---|
| Auto-upgrade default ON | `mneme config set auto-upgrade false` to disable |
| Check interval (default 1h) | `mneme config set version-check-interval 6h` |
| Refuse sudo even when needed | already the default — we never auto-`sudo` |
| Force a specific strategy | `mneme config set upgrade-strategy docker` |

---

## Failure modes — and how SYSTEM-COMPAT handles each

| Scenario | Old behavior | SYSTEM-COMPAT behavior |
|---|---|---|
| Node too old | silent `npm install` failure looped forever | **BLOCK** + clear inbox: *"Node v20.0.0 is too old (need v22+). User must upgrade Node first."* |
| Homebrew-owned `/usr/local` | sudo prompts hidden, install fails silently | **DEFER** + clear inbox: *"prefix requires elevation; refusing to auto-sudo. Set `npm config set prefix ~/.local` or use Docker."* |
| Corporate firewall blocks npm registry | retry storm | version probe times out after 6s, falls back to cached state — no retry loop |
| User on WSL2 with stale npm cache | `mneme upgrade --force` no-ops silently | **SAFE** + uses `npm install -g mneme-ai@latest` which bypasses cache |
| No package manager installed at all | crash | **BLOCK** + clear inbox: *"No supported package manager found. Install Node ≥ 22 or Docker manually."* |

---

← [Back to README](../README.md) · [TOKEN-NOVA](TOKEN_NOVA.md) · [Install contract](AI_AGENT_CONTRACT.md)
