# 🕸 The Provider Web (ใยแมงมุม) + the Approval Matrix

Two layers make multi-chat approvals **correct and infinitely extensible**.

## The Approval Matrix — one decision, no double-tap

When an agent asks to run something sensitive, the ask is broadcast to **every** surface at once:
Telegram · LINE · Slack · Discord · WhatsApp **and your computer**. The Approval Matrix makes the
result deterministic:

- **One authoritative ticket** per request — the single source of truth.
- **First-wins, atomic.** The first decision from *any* surface (your phone, a relay webhook, the
  long-poll daemon, or `mneme pager approve <id>` on the computer) is accepted by compare-and-set.
  A later tap on any other surface reads **"already decided by <who> on <where>"** and never acts.
- **The others clear, exactly once.** A single idempotent reconcile plan edits the message in place
  where the provider supports it, or posts a short "answered elsewhere" note where it doesn't —
  tracked so a retry across ticks/processes never double-clears.
- **The computer is a first-class surface.** Sitting at your machine? Approve there. On your phone?
  Approve there. Same ticket — whichever happens first wins, the rest clear.

Default is **all** surfaces. If you told the agent *"only line and whatsapp"*, the matrix opens the
ticket on just those.

## The Provider Web — a new provider plugs itself in

A chat provider is **not** code baked into Mneme. It is a thread of **silk** — a small declarative
descriptor:

```jsonc
{
  "provider": "wechat",
  "capabilities": { "buttons": false, "edit": false, "inbound": "webhook", "verify": "signature" },
  "parse": { "answerPath": "Content", "idPath": "MsgId", "answerMap": { "同意": "allow", "拒绝": "deny" } }
}
```

That's the whole integration. The web then:

- **routes** asks out across every woven thread (`routePlan`),
- **harvests** a tap from *any* provider's inbound payload via its declared dot-paths
  (`harvestInbound` — one parser for Telegram's `callback_query.data`, WeChat's `Content`, a
  webhook's `payload.choice`, …),
- **negotiates capability** — a thread that can't edit gets a follow-up note instead of an in-place
  edit; the matrix never branches on a provider name,
- **weaves at runtime** — a *signed* silk descriptor can be ingested live (`ingestDescriptor`), so
  the web grows a new thread with no redeploy; an unsigned/forged descriptor is refused.

```bash
mneme keryx web                      # the woven threads + their capabilities
mneme keryx web --harvest telegram --payload '{"callback_query":{"data":"allow:t1"}}'
# 🕸 harvested telegram: answer="allow" id=t1
```

Add WeChat, Mastodon, a Matrix.org room, or a corporate webhook by declaring its silk — **zero core
change, no release**. Future providers join the same first-wins matrix automatically.

Both layers are pure + deterministic and each scores **100/100** on its gauntlet
(`approvalMatrixGauntlet`, `providerWebGauntlet`).
