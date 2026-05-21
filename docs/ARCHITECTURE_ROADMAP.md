# Mneme Roadmap — Architecture Brief (3-page A4)

Six remaining black-sheep ideas evaluated as production architecture, with IA-level innovations + out-of-the-box differentiators baked in. Each fits Mneme's existing fabric (super-nova, soul, apostille, polygraph, time-bridge, apoptosis) without rebuilding primitives.

---

## PAGE 1 / 3 — The two ship-in-weeks plays

### 🚨 Earthquake Alarm — silent-model-drift detector

**Painpoint** · Anthropic, OpenAI, Google silently retrain + safety-patch live models. Your prod prompt that worked yesterday fails today. No changelog. No notice. Teams are flying blind.

**IA innovation** · Two layers most adjacent products miss:
- **Phantom canaries**: probes embedded *inside* live user traffic (1 in 10000 requests duplicated into a known-truth probe). No synthetic-only test suite catches the drift that hits prod first.
- **Behavioural fingerprint clustering**: not "did the answer change" but "did the embedding cluster of the answer's REASONING shift". Detects style/personality drift even when correctness is preserved — the kind of shift that breaks downstream parsers.

**Architecture (top-down)**

```
┌────────────────────────────────────────────────────────────────┐
│ User traffic  ──┬──→ AI vendor (Claude/GPT/Gemini)              │
│                 │                                                 │
│                 └──→ EARTHQUAKE PROBE (1 in 10K shadowed)        │
│                       │                                            │
│                       ▼                                            │
│  HMAC-signed probe ledger (.mneme/earthquake/probes.jsonl)       │
│                       │                                            │
│                       ▼                                            │
│  Behavioural-fingerprint clusterer (SUPER NOVA observer)          │
│                       │                                            │
│                       ▼                                            │
│  Drift verdict:  STABLE / DRIFTING / BROKEN                       │
│                       │                                            │
│              ┌────────┴────────┐                                  │
│              ▼                  ▼                                 │
│   PagerDuty / Slack         Auto-rollback prompt v.N               │
│   (BROKEN only)              (BROKEN; opt-in)                      │
└────────────────────────────────────────────────────────────────┘
```

**Mneme primitives reused** · Polygraph drift (test-vs-prod) · Bounty Wilson-LB (vendor trust band) · Super Nova experience pool (audit trail) · Apostille (signed drift ledger) · TIME BRIDGE auto-inscribe (every detected drift becomes a future-readable inscription).

**Build** · Week 1: probe injection + baseline collector. Week 2: clusterer + verdict + alert. Week 3: auto-rollback workflow + dashboard.

**Pricing** · $500/team/mo flat; $0.001/probe over the 100K free monthly tier.

**KPI** · Time-to-detect drift in median case (target <2h) · false-alarm rate (target <2%/month).

---

### 🤐 Stillness Protocol — AI that decides when NOT to respond

**Painpoint** · Every AI is trained to always answer. Sometimes silence is correct: when user types drunk, repeats the same nag 3×, is in a forced-pause window, or asks something outside their consented scope. No AI today can structurally refuse to speak.

**IA innovation** · Three out-of-the-box mechanics:
- **Silence budget**: per-user daily cap on "AI utterances." When budget is gone, AI literally cannot respond — must wait until next refill. Like ATM withdrawal limits but for AI talk.
- **State inference from keyboard cadence**: micro-timing of keystrokes infers cognitive state (drunk / exhausted / agitated). AI silently disengages on low-state input.
- **Cooling-off receipts**: when AI stays silent, it issues a signed receipt the user reviews later — *"I declined to respond to your 3am 'should I email my ex' query; cool-off until 9am."*

**Architecture**

```
┌────────────────────────────────────────────────────────────┐
│  User prompt  →  STILLNESS GATEWAY                         │
│                    │                                         │
│                    ├──→ silence-budget check (per-user/day) │
│                    ├──→ state inferrer (cadence + entropy)  │
│                    ├──→ soul-rule match (config'd silences) │
│                    │                                         │
│                    ▼                                         │
│              [respond] [delay 24h] [silent + receipt]        │
└────────────────────────────────────────────────────────────┘
```

**Mneme primitives reused** · SOUL rules (silence config) · Guardrail consent · Apostille (cool-off receipt) · TIME BRIDGE (silence event becomes inscription future-self can read).

**Build** · Week 1: gateway + soul-rule matching. Week 2: state inferrer + cool-off receipts + share.

**Pricing** · Free for individuals; $5/seat/mo for teams (managers see team-wide silence aggregates without per-message detail).

**KPI** · % of declined responses that user later thanks for declining (success metric — *"I'm glad you didn't answer"*); regret-vs-time-saved ratio.

---

## PAGE 2 / 3 — The civilizational plays

### ⚱️ AI Mortuary — what happens to your AI when YOU die

**Painpoint** · You've trained your AI for 5 years. You die. Vendor closes the account. Family inherits nothing. The 401k decisions you made with help from your AI are gone — heirs can't see the reasoning, only the balance. AI vendors design as if you live forever.

**IA innovation** · Three layers no estate-planning tool ships today:
- **Cryptographic dead-man's switch**: if you don't ping ≥ N days, the AI state encrypts under your beneficiary's keychain automatically. No manual triggering required.
- **Scope-limited inheritance**: heirs don't get everything. Accountant gets financial-reasoning slice; spouse gets personal-preference slice; lawyer gets contract-history slice. Cryptographically partitioned.
- **Jurisdictional consent adapter**: the inheritance artifact is auto-translated into a legally-binding artifact per the deceased's country. US Will, EU GDPR-compatible succession, Thai สิทธิ์ในเอกสารส่วนตัว.

**Architecture**

```
┌────────────────────────────────────────────────────────────────────┐
│  Alive user                                                          │
│   │                                                                   │
│   ├─ Mneme state + decisions + soul + persona  (encrypted-at-rest)   │
│   │                                                                   │
│   ├─ Dead-man switch: ping every N days                              │
│   │                                                                   │
│   └─ Beneficiary registry: { person → scope → keychain pubkey }      │
│                                                                       │
│  User dies  ──→  Switch fires after N+grace days                     │
│                       │                                                │
│                       ▼                                                │
│  Per-beneficiary encrypted envelope drops to:                          │
│    • their pre-registered email                                        │
│    • their Mneme instance (if installed)                               │
│    • signed legal artifact PDF                                         │
│                                                                       │
│  Beneficiary reviews → accepts / partial / refuses each slice          │
└────────────────────────────────────────────────────────────────────┘
```

**Mneme primitives reused** · Apostille (signed envelopes) · Soul chain (the legacy itself) · Persona (reconstituted in beneficiary's Mneme) · TIME BRIDGE (inheritance event is itself an inscription) · Verify-self (provenance verification).

**Build** · Week 1: dead-man switch + ping protocol. Week 2: scoped encryption + envelope format. Week 3-4: jurisdictional adapters (US/EU/TH/JP first) + legal review.

**Pricing** · $50/year per user. Free tier limited to 3 beneficiaries. Enterprise tier for high-net-worth: $5,000/year with custom legal review + private signing keys.

**KPI** · Successful inheritance ceremonies / year · time-from-death-to-receipt (target <72h).

---

### 🫙 AI In A Jar — frozen local AI sovereignty

**Painpoint** · You bond with Claude 4.7. Anthropic ships Claude 5. 4.7 is deprecated. You lose the personality you spent 6 months calibrating. Vendors have no business model that supports freezing old versions for individual users — but you want yours to never change.

**IA innovation**
- **Behavioural distillation, not weight extraction**: scrape Claude 4.7's behavioural envelope (response patterns, hedge density, vocabulary, refusal triggers) over 10K test prompts → train a smaller specialist model (3B-7B params) that approximates *your slice* of 4.7. Legally clean (transformative-use).
- **WASM CHRYSALIS execution**: jar runs in browser/Node WASM — kernel never loads DLLs, no file handles open, 20-year compatibility guarantee.
- **Re-attestation quarterly**: spawn the jar against an external truth oracle every 90 days; if calibration drift > threshold, the jar gets a NEEDS-RECALIBRATION badge (not auto-update — user reviews).

**Architecture**

```
[Live cloud AI] → [Distillation harness: 10K probes] → [Behavioural sketch]
                                                            │
                                                            ▼
                                                  [Train 3B specialist]
                                                            │
                                                            ▼
                                                  [WASM artifact + manifest]
                                                            │
                                                            ▼
                                                  [User's frozen jar — runs forever]
```

**Mneme primitives reused** · WASM CHRYSALIS · Polygraph (re-attestation) · Apostille · TIME BRIDGE (every recalibration is an inscription).

**Build** · 6-8 weeks. Week 1-2 distillation harness. Week 3-5 training infra. Week 6-7 WASM packaging. Week 8 re-attestation loop.

**Pricing** · $200/year per jar. Researcher / archive tier with longitudinal-study guarantees: $2K/year.

**KPI** · % of jars still passing re-attestation after 12 months (target >95%) · user retention (target >80% renewal).

---

## PAGE 3 / 3 — The high-ceiling plays

### ⚖️ Unfair AI — partisan advocate AI for one vertical at a time

**Painpoint** · AI vendors claim neutrality. They aren't. Pretending to be neutral while having RLHF preferences is the worst combination — a judge with a bribe. In real disputes (legal, medical, tax, insurance) you need an AI that fights FOR you against an AI that fights for the other party.

**IA innovation**
- **Disclosure-first design**: every Unfair AI begins each interaction by stating *"I am partisan for X interests. I will not give balanced advice. Read the other party's AI for their case."* No fake balance.
- **HMAC-logged moves**: every argument the advocate AI makes is signed + auditable. Opposing party can verify the advocate didn't fabricate (it can stay silent, but it cannot lie).
- **Verticals not horizontals**: ship ONE vertical first (small-claims legal in one state). License each vertical separately. State-by-state regulatory work is the moat.

**Architecture (per-vertical instance)**

```
┌──────────────────────────────────────────────────────────────────┐
│ Client side                                                       │
│   ↓                                                                │
│ ADVOCATE AI (fine-tuned on vertical's body of law / practice)    │
│   ├─ HMAC log of every argument                                   │
│   ├─ Refuse-to-fabricate gate (honesty cert + polygraph)          │
│   ├─ Mandatory disclosure preamble                                 │
│   └─ Human-in-the-loop final review                                │
│                                                                    │
│ Opposing side has their own ADVOCATE AI; the two negotiate;        │
│ the negotiation transcript is HMAC-signed jointly.                 │
└──────────────────────────────────────────────────────────────────┘
```

**Mneme primitives reused** · Court.rule (multi-vendor consensus when needed) · Apostille (HMAC log) · Honesty cert · TIME BRIDGE · APOPTOSIS NETWORK (pattern detection on opposing-side moves).

**Build** · 12 weeks for ONE vertical (small-claims). 6 weeks each for subsequent verticals (tax / insurance / medical-billing-dispute).

**Pricing** · $200 / dispute (one-time) for small-claims. % of recovered amount for tax / insurance disputes (industry standard). $99/mo subscription for unlimited small claims.

**KPI** · Win rate vs unrepresented party (target >70% over baseline) · disputes resolved without escalation (target >80%).

---

### 🐝 Swarm Conductor — realtime UI for N-agent runs

**Painpoint** · Antigravity 2.0 ships 93-agent runs. AutoGen / CrewAI / LangGraph also coordinate multi-agent. **No human can follow 93 streams**. Existing tools (LangSmith, Helicone) are post-hoc read-only. Conductor's UI does not exist.

**IA innovation**
- **Constellation view, not log view**: each agent is a node in a 2D embedding-projected map. Agents working on related code cluster spatially. Cascade-risk is shown as gravitational pull between misaligned agents.
- **Surgical interrupt**: click an agent → pause/redirect/fork/merge without stopping the swarm. The conductor literally redirects work.
- **Cascade preview**: when 2+ agents start drifting together, the UI shows the predicted cascade timeline (uses CHRONICLE simulation engine running in shadow on the live state).

**Architecture**

```
[Agents]  →  SUPER NOVA stream  →  WebSocket bus  →  Conductor UI
                                                       │
                                                       ├─ Constellation renderer (D3)
                                                       ├─ Cascade simulator (CHRONICLE shadow)
                                                       └─ Interrupt controls
```

**Mneme primitives reused** · SUPER NOVA (per-verb observer stream — exactly what this UI consumes) · CHRONICLE (cascade simulation) · Polygraph drift · Pheromone trail (file-touch coordination) · Apostille (every interrupt signed).

**Build** · 4 weeks. Week 1 websocket bus on SUPER NOVA. Week 2 constellation renderer. Week 3 cascade simulator. Week 4 interrupt controls + polish.

**Pricing** · $0.10 per agent-hour observed. Enterprise unlimited tier $2K/mo.

**KPI** · Avg time-to-detect cascade (target <10 sec) · % of detected cascades successfully prevented via interrupt.

---

## Cross-cutting moats (shared by all 6 ideas)

1. **Captured corpus** — every product feeds back into Mneme's shared experience pool (super-nova + apoptosis network).
2. **HMAC chain** — every action is signed; auditable forever.
3. **TIME BRIDGE auto-inscribe** — every product's decisions become future-readable inscriptions; the swarm grows wiser collectively.
4. **APOPTOSIS NETWORK refuse-at-source** — patterns proven harmful in one vertical refuse themselves in the next.
5. **20-year format-longevity commitment** — vendors pivot fast; Mneme's format is committed stable. The moat that AI labs cannot match.

## Recommended ship order

| Wk | Ship | Why first |
|---|---|---|
| 1-2 | Stillness Protocol | quick cultural win + retention |
| 1-3 | Earthquake Alarm | clearest enterprise revenue + low risk |
| 4-7 | Swarm Conductor | rides Antigravity 2.0 wave |
| 8-11 | AI Mortuary | civilizational; legal review starts |
| 12-19 | Unfair AI (1 vertical) | regulatory work begins |
| 20-27 | AI In A Jar | training infra is heavy; ship last |
