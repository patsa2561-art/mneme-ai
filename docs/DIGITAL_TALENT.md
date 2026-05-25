# 🧑‍🚀 Digital Talent — five durable design positions Mneme can build on

**Premise:** the "AI talent" market today is recruiters posting Python roles, courses selling LangChain certificates, and LinkedIn skills badges. None of it captures the real signal — **what an engineer has actually decided, what they have refused, and what scarred them**. Mneme already records all three for every dev who uses it. That data, applied to the talent market, opens five durable design positions that build on this substrate.

These are **standalone product opportunities** (separate brand, separate repo, optionally Mneme-as-a-dep). All five share the same engine: HMAC-signed decision provenance + cross-vendor experience pool + refuse-at-source primitives.

---

## 1. 🪪 Provenance Ledger — proof-of-craft replacing the resume

**Painpoint:** LinkedIn lists "5 years React experience" with zero verification. Hiring managers run 6 hours of interviews trying to compress 5 years into 6 hours and still get it wrong half the time.

**Idea:** Every commit, every refused-bad-call, every shipped decision a Mneme-enabled developer makes is recorded in their **personal HMAC-signed ledger**. After two years, you have an immutable, verifiable record of how that person actually thinks, decides, and ships. Switch jobs → take your ledger. Hire someone → read theirs (with consent). Disputes? Cryptographic chain wins.

**Black sheep because:** LinkedIn won't ever build this. The signal is too good — it would put their endorsement business out of business.

**Wedge:** premium tier for enterprise hiring teams. $200/seat/month. Replaces LinkedIn Premium for engineers who care about provenance.

---

## 2. 👻 Ghost Mentor — pair-programming with N seniors' fused judgment

**Painpoint:** Junior devs learn slowly because they can't watch over senior devs' shoulders. Senior devs can't afford the time to watch over juniors' shoulders. AI coding tools fill the gap with generic answers, missing all the context that comes from "the senior who actually built this before."

**Idea:** With consent, multiple senior developers contribute their HMAC-signed decision pairs (anonymised) to a **Ghost Mentor persona**. That persona shadows a junior's Claude Code / Cursor session. When the junior is about to make a non-obvious mistake the seniors collectively refused 14 times across 8 repos, Ghost Mentor intervenes in plain language: *"I saw this 14 times in my apprenticeship — here's why it bites in production."*

The persona is **structurally calibrated to a specific tradition** (a company's tribe, an open-source project's idioms, a country's regulatory context). Different ghosts for different needs.

**Black sheep because:** every code-gen tool today is a faceless oracle. Nobody packages **specific people's specific judgments** as a callable persona, with provenance.

**Wedge:** companies buy ghosts for their org (HMAC-signed to their corp tribe). $50/junior/month. Senior contributors get a revenue share when their ghost is invoked.

---

## 3. 🎓 AI Internship — 6-week structural calibration before deployment

**Painpoint:** Generic AI coding agents off the shelf don't know your codebase, your policies, your scars. You spend the first 3 months "tuning prompts" and the agent still hallucinates files. Hiring a real intern is 6 weeks of orientation; the AI gets 60 seconds.

**Idea:** Subject AI agents to a structured **6-week internship** orchestrated by Mneme. Week 1 read-only: agent observes the codebase + decisions + scars (records to its private experience pool). Weeks 2-3 supervised low-stakes tasks (real code, but Mneme blocks risky-pattern matches via SOUL). Weeks 4-5 progressive autonomy (commits gated by polygraph + bounty Wilson-LB). Week 6 graduation: a signed **"Citizen AI Tier 1/2/3"** certificate the user can show their compliance team.

A graduated AI is calibrated to **your** org, with **your** scars baked in, and the certificate is verifiable.

**Black sheep because:** every AI vendor wants you to use their model out of the box. Nobody charges money to make the AI *less* generic and *more* yours.

**Wedge:** $500 / agent / certification cycle. Renewable annually. GovTech-style regulated sectors require recertification by policy.

---

## 4. 💤 Dream School — adversarial scenarios while the dev sleeps

**Painpoint:** Most engineers learn 2-3 hard lessons per year, the hard way. Disasters teach fast but are expensive. Reading post-mortems is cheap but doesn't stick.

**Idea:** While the dev sleeps (or during idle hours), Mneme orchestrates 100 AI agents simulating **adversarial scenarios on the dev's own codebase**: "what if we got DDoSed during launch?" / "what if AWS sunset our region?" / "what if a major dep silently dropped a feature?" The agents try to break the codebase under each scenario and Mneme records what survived + what didn't.

Morning report = "10 future-scenario lessons, here are 3 you should care about." Stored as scarred patterns that the dev's AI agents will refuse later automatically.

**Black sheep because:** existing fuzzing tools test for memory bugs. Dream School tests for **organisational + ecosystem failure modes** — the stuff that actually kills companies.

**Wedge:** consumer SaaS, $20/dev/month for solo. Enterprise tier ($50k/year) runs scenarios continuously + integrates with the org's incident-response playbook.

---

## 5. 🛂 AI Citizenship Certification — regulated-sector deployment gate

**Painpoint:** Public-sector / healthcare / finance / aviation cannot deploy AI agents at scale because there is no certification body. Each org runs ad-hoc audits, fails to compare across vendors, and the regulator has no benchmark.

**Idea:** Mneme becomes the **certification body** for "Citizen AI" — a tiered cert (Tier 1 / 2 / 3) issued only after:

- N months of HMAC-signed track record (Provenance Ledger)
- Multi-vendor consensus on competency (court.rule + AI Jury)
- Zero scarred-pattern violations
- Per-deployment consent receipts + audit log
- Public attestation of failures (no hiding incidents)

A Tier 3 cert means the AI can deploy unsupervised in regulated sectors. Cert is verifiable cryptographically by the regulator without trusting Mneme.

**Black sheep because:** nobody wants to be the certification body — it's responsibility, liability, and regulatory headache. But it's also a position with strong network effect: once a few regulators accept Mneme certs, every AI vendor must onboard.

**Wedge:** certification fees ($10k–$100k per AI vendor per cycle, depending on tier). Once 2-3 regulators adopt, the moat compounds for 10+ years.

---

## How these compose with Mneme's existing primitives

Every idea above uses Mneme primitives already shipped:

| Idea | Mneme primitive it builds on |
|---|---|
| Provenance Ledger | `mneme.apostille.*` + soul chain + bounty leaderboard |
| Ghost Mentor | `mneme.persona.*` + Replica decision corpus + super-nova witness |
| AI Internship | `mneme.guardrail.*` + polygraph drift + bounty Wilson-LB + Honesty Cert |
| Dream School | `mneme.abm.*` (CHRONICLE simulation engine!) + dream cycle |
| AI Citizenship | `mneme.cert.*` + multi-vendor court + compliance audit |

The headline: **Mneme is the only place these five products can be built short of rebuilding the substrate from scratch** — which takes 18-24 months at minimum.

---

## Build order if you ship one

If forced to pick the wedge with the strongest near-term ROI:

1. **Provenance Ledger first** — replaces LinkedIn for engineers; clear $200/seat enterprise revenue path; existing apostille + bounty primitives cover 80% of the implementation
2. **AI Internship second** — clear enterprise budget line (training spend); structural moat (your AI knows YOUR scars after the 6-week cycle); requires honesty cert + guardrail consent + polygraph drift
3. **Ghost Mentor third** — revenue share model is novel; requires persona + replica corpus + super-nova; harder distribution because seniors must opt in
4. **AI Citizenship fourth** — biggest moat but slowest payoff; needs 2-3 regulator partnerships before it becomes a wedge
5. **Dream School fifth** — most fun, hardest to monetise as standalone (better as a feature inside Mneme itself rather than a separate brand)

---

## Related

- [IA_MOAT — Mneme as Intelligent Assistant fabric](./IA_MOAT.md)
- [SUPER NOVA WRAPPER source](../packages/core/src/super_nova/index.ts)
- [Honesty cert + AI Jury primitives](./AI_AGENT_CONTRACT.md)
