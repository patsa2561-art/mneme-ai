# 📟 Cosmic Pager — approve your agent from your phone, lid closed

> Run an autonomous agent overnight. When it hits an action that needs a human, it pages
> **your phone** (Telegram). You tap **✅ / ⛔**. It continues. The brain stays on **your**
> machine — only a one-line **summary + hash** ever leaves it, and the approval that comes
> back is a **cryptographic transfer of authority**, not a dumb "yes".
>
> **Different from a hosted "remote control"**: there is **no server, no public IP, no
> tunnel**. The laptop reaches *out* to Telegram (long-poll behind NAT). Your code never
> leaves the machine. Every approval is a **signed, court-admissible** record that a *human*
> — not the AI — authorized the action.

---

## Why it exists

You want to leave Claude Code / Cursor / Codex / aider running while you sleep or step out.
But agents stop and ask: *"Allow this bash command? [Yes] [No]"*. If you're not at the
keyboard, the run stalls — or worse, you pre-approve everything and a destructive command
slips through. The Cosmic Pager is the **out-of-band approval rail**: safe work flows,
risky work waits for your thumb, destructive work is fail-safe by default.

## The four diamonds (the measurable core — `successionGauntlet`-style, all proven)

`@mneme-ai/core/pager` is pure, deterministic, and `pagerGauntlet() === 100`:

1. **Signed Authority Transfer.** The approval is a nonce **bound to the exact
   `(command-hash · agent · session)`**, **one-time**, and **TTL'd** (default 5 min). A
   captured Telegram message can't be replayed; an approval for `npm test` can **never**
   release `rm -rf` (hash mismatch → reject). *Checks: bound · no-replay · expired-rejected.*

2. **Trust-Tide (the self-tuning hybrid policy).** Every command is classified
   (blast-radius × command-class). Per request it picks a lane and **the policy itself
   adapts over time**:
   - 🟢 **Productive** — a class proven safe (Wilson-LB ≥ 70% over ≥ 5 approvals) → **auto-allow**; the pager goes *quiet*.
   - 🟡 **Conservative** — unproven / moderate → **page + hold** (never an auto-default).
   - 🔴 **Fail-safe** — destructive → **page**, and **auto-DENY on timeout**.

   **Hard ceiling:** a destructive class can **never** graduate to auto-allow, no matter how
   many times it was approved. **Regret demotion:** one denial (or a reverted outcome) drops
   the class straight back to *conservative*. *Checks: productive · ceiling · conservative · demoted.*

3. **Dead-man queue.** Leave it running. On each wake tick, timed-out pendings resolve by
   their lane — **safe → allow, destructive → deny, moderate → wait** — so you wake to a
   tidy **batch** to approve, never a hung run and never an unattended `rm -rf`.
   *Checks: safe-allows · destructive-denies · moderate-waits.*

4. **Court-admissible receipt.** Every decision (human, policy-auto, or dead-man) is a
   content-bound, signed record: *"approval for hash `Y`, decided by `human` via `telegram`
   at `T`."* Accountability no Telegram bot has — you can **prove** a human authorized it.
   *Checks: binds-decision · deterministic.*

## The full loop (all tiers, seamless)

```
┌── TIER 1 · AGENT ────────────────────────────────────────────────────────────┐
│  Claude Code / Cursor / Codex / aider / any MCP agent wants a sensitive tool   │
│   seam (sanctioned, no terminal hijack, no kernel):                            │
│     • Claude Code → PreToolUse HOOK  → `mneme pager request`                   │
│     • MCP client  → ELICITATION       → `mneme pager request`                  │
│     • un-hookable CLI → pty-wrapper inject (last resort)                       │
└───────────────┬───────────────────────────────────────────────────────────────┘
                ▼ local IPC (CLI exit JSON / unix socket / named pipe)
┌── TIER 2 · MNEME (local, the brain) ──────────────────────────────────────────┐
│  classify blast → summary → `egress.guard(summary)` (the summary itself leaks  │
│  no secret) → raw command HELD LOCAL (notary canon) → Trust-Tide.decide():     │
│     AUTO_ALLOW → release + sign receipt (pager stays quiet)                    │
│     PAGE       → enqueue + page → wait for signed authority                    │
│     destructive timeout → fail-safe DENY                                       │
│  power "breathing": inhibit sleep while work pends; RTC-wake while idle        │
└───────────────┬───────────────────────────────────────────────────────────────┘
                ▼ OUT-OF-BAND · outbound HTTPS only (behind NAT, no server)
┌── TIER 3 · NETWORK / TELEGRAM ────────────────────────────────────────────────┐
│  laptop LONG-POLLS `api.telegram.org/getUpdates` (it reaches OUT; the phone    │
│  never reaches in) → sends summary + hash + inline [✅ Approve] [⛔ Deny]        │
│  user taps on phone → next poll receives a `callback_query`                    │
│  callback data = `a:<id>:<nonce>`  → the signed authority                      │
└───────────────┬───────────────────────────────────────────────────────────────┘
                ▼ verify offline (bound · one-time · in-TTL)
   release raw from canon → return ALLOW to the hook → agent runs
   + every step → signed flight-recorder / canon entry (provable human authority)
```

### Protocols at each seam
| Seam | Protocol | Why |
|---|---|---|
| Agent → Mneme | Claude Code **PreToolUse hook** · **MCP elicitation** · pty-inject (fallback) | sanctioned interception — no OS/kernel hacking |
| Mneme ↔ Mneme | local **CLI exit-JSON** / **unix socket** / **named pipe** | fast, in-machine, raw command never crosses the wire |
| Mneme → Phone | **Telegram Bot API long-poll** (`getUpdates`, outbound HTTPS) | works behind any NAT/firewall; no server, no public IP |
| Approval | **signed nonce** (hash-bound, one-time, TTL) via `verify-self` capsule chain | replay-proof, command-bound authority transfer |
| Power | `caffeinate` (mac) · `systemd-inhibit` + `rtcwake` (linux) · `SetThreadExecutionState`/Away-Mode (win) | "breathing" sleep — awake while working, wake-to-poll while idle |

## The user types NOTHING — the AI agent sets it up

The user will never know `mneme pager` commands. They just say *"I want to approve you from
my phone"* / *"ส่งไป Telegram"* / *"run this overnight, lid closed."* The agent then asks for
the **only** thing it can't make itself — a Telegram bot — and wires everything in one call:

```bash
# The USER does ONE thing, once: open Telegram → @BotFather → /newbot → copy the token,
# and get their chat-id (message @userinfobot). Then the AGENT runs:
mneme pager autosetup --telegram-token <token> --chat-id <id>
```
`autosetup` (zero further user steps) — wires the Claude Code **PreToolUse hook** into
`.claude/settings.json`, sets the **lid-close action to "do nothing"** (so closing the lid
keeps the agent running + paging), registers a **login auto-start** service, **sends a test
message** to the phone, and **launches** the long-poll loop in the background. Close the lid
and walk away.

> **"Press sleep / close the lid → it still reaches Telegram":** the page is sent the
> *instant* the agent asks (while awake) — so it's already on your phone before you sleep.
> `autosetup` sets lid-close = *do nothing* so the agent keeps working + paging new questions
> after you close the lid; if you *force* deep sleep, breathing-power wakes on a timer to
> flush the queue + process approvals, then sleeps again.

### Lower-level verbs (for scripts / debugging — the user never needs these)
```bash
mneme pager status                 # pending queue + Trust-Tide state
mneme pager approve <id> [--deny]  # local approve (testing without the phone)
mneme pager start | request | setup | hook   # the pieces autosetup composes
```
MCP: `mneme.pager.scan` (read the pending queue + trust). The boot table tells every agent to
run `autosetup` on the user's natural-language intent.

## Honest limits (no marketing)

- **Truly off / deep sleep (S3) = nothing runs.** The pager works while **awake**,
  **lid-closed-stay-awake** (Windows/Linux: a power setting + an inhibitor — reliable), or
  on a **breathing cadence** (RTC wake every *N* min → poll → re-sleep; latency = the wake
  interval). **Near-real-time only** on **Modern Standby (S0ix)** / **macOS Power Nap** /
  **Windows Away-Mode**. A phone tap during deep S3 sleep is seen on the next wake.
- **macOS, lid-closed, on battery → the firmware sleeps** regardless. Reliable stay-awake
  needs **AC power** (`sudo pmset -c disablesleep 1`) or an external display. Windows/Linux
  do not have this limit.
- **Scope = local agent *runtimes*** (Claude Code, Cursor, Codex, aider, MCP agents). A
  hosted browser chat (chatgpt.com) does not run local commands, so there is nothing to gate.
- **The measurable core (the 4 diamonds) is `pagerGauntlet === 100`.** The live transport
  (Telegram) and cross-OS power need *your* bot token and *your* machines to validate
  end-to-end — that part is functional + structured, not claimed-proven here.
- **No kernel driver** — by design (no BSOD / signing / security surface). User-space daemon
  + sanctioned hooks is the correct, stable architecture.

## Provenance

Built on shipped primitives — `heph` (blast classify), `egress` (secret-screen the summary),
`notary` / `verify-self` (signed nonce + TTL + chain), `engagement` / `govern` (policy),
`agent_benchmark` (Wilson-LB trust), `reckon` / `flight` (court-admissible audit). The pager
is the *composition*; each piece is independently measured.
