# 🏛 KERYX — the herald: one gate, every chat

> **Telegram works behind NAT with zero server** (the laptop long-polls out). But **LINE,
> Slack, Discord, WhatsApp are webhook-based** — they push to a public endpoint a laptop
> behind NAT can't expose. **KERYX** is the dumb, signed relay that fixes this for *every*
> chat at once — a genius wisdom-gate like the Telegram pager, but open to any provider.

## The idea (one picture)

```
ANY chat  ──webhook──▶  KERYX relay (public · your DO droplet · gephyra serve)
(LINE / Slack /          ▲   │
 Discord / WhatsApp)      │   │  signed envelope (summary + hash only)
                         │   ▼
        local Mneme daemon ──outbound WS/SSE──┘   (the laptop reaches OUT — no public IP, behind NAT)
```

The relay is **deliberately dumb**: it can *route* an envelope but never *forge* one, never
read your code, never replay. The brain stays on **your** machine — exactly like the Telegram
pager — only now any chat platform can reach it.

## The four guarantees (protocol — `keryxGauntlet = 100`, shipped in `@mneme-ai/core/keryx`)

1. **PRIVACY** — an envelope carries only a human *summary* + a sha256 *command-hash*. The raw
   command/secret **never** crosses the relay. (`envelopeLeaksRaw` proves it.)
2. **UNFORGEABLE** — every envelope is signed with the daemon's key; the relay (which never
   holds that key) **cannot fabricate** an approval. Tamper the payload → verify fails.
3. **REPLAY-PROOF** — nonce + TTL: a captured envelope is useless after its window.
4. **CHANNEL-AGNOSTIC** — the *same* signed envelope works over LINE / Slack / Discord /
   Telegram. The transport is dumb; the signature is the truth.

`mneme keryx demo` shows a signed ask→answer round-trip; `mneme keryx verify <file> --secret …`
verifies an envelope offline.

## How it's different from a hosted remote-control

A normal bot puts the brain in the cloud. KERYX keeps the brain **local** and uses the relay
only as a **signed switchboard** — so even though there's now a public endpoint (needed for
webhook providers), it can't read your code, can't forge an approval, and can't replay one.
You get LINE/Slack/Discord reach *without* surrendering the privacy model.

## Status & roadmap (honest)

- ✅ **Protocol core** — the signed envelope, offline verification, the four guarantees:
  shipped + measured (`keryxGauntlet=100`).
- 🔜 **Relay server** — deploys on `gephyra serve` (your DO droplet): receives each provider's
  webhook, holds a per-daemon queue, and the daemon connects OUT (WS/SSE) to drain it.
- 🔜 **Provider adapters** — LINE / Slack / Discord webhook → envelope parsers (Telegram already
  works directly via long-poll, no relay needed).

> The protocol is the load-bearing part (privacy + unforgeability + replay-proofing) and it's
> done. The relay deployment is plumbing on top — it cannot weaken those guarantees, by design.
