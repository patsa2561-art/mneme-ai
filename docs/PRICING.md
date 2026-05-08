# Mneme — Pricing

Three tiers. The local-first one is the **premium**. That's not a typo.

═══════════════════════════════════════════════════════════════════════

## 🆓 Free — for solo devs, open source, vibe coders

**$0 forever.** MIT-licensed. No account. No phone home. No telemetry.

What you get:
- Full CLI — every one of the 90+ commands
- MCP server with 94 tools (memory · people · audit · forensics · insights · quality · quant · lab · meta + grader)
- Second Brain layer (compose hints + 20 molecules + lifecycle tracking)
- Super Sonic Engine (5 grading algorithms)
- `git mneme` extension + 4 git hooks
- 3 CI/CD templates (GitHub Actions, GitLab CI, Bitbucket Pipelines)
- Docker image (ghcr.io)
- AI-installable via Claude Code / Cursor / Codex CLI / Continue

What you DON'T get:
- Cryptographic signed audit certificates (Pro tier)
- Cross-repo Wisdom Federation network access (Pro tier)
- Priority support

```bash
npm install -g mneme-ai     # done. you're on the Free tier.
```

═══════════════════════════════════════════════════════════════════════

## 💼 Pro — for small teams, $20/mo per developer

For teams of 2-50 devs who want:

- **Hosted audit chain** — your audit certificates land in a Mneme-hosted Merkle chain. Tamper-evident, queryable, exportable for SOC2/ISO/EU AI Act.
- **Ed25519-signed certificates** — Mneme issues you an organization key; every `audit certify` output gets cryptographically signed.
- **Wisdom Federation hub** — opt-in differential-privacy network where 1000+ repos contribute aggregate signals. Get insights from across the ecosystem without sharing your code.
- **Email support** — 48-hour response time.

What you DON'T get:
- On-premise deployment
- Air-gapped operation
- Dedicated engineer

```bash
mneme login                 # creates your Pro subscription
mneme audit --certify       # certificates now signed + chained automatically
```

═══════════════════════════════════════════════════════════════════════

## 🛡 Air-gapped Enterprise — $50,000-$200,000 / year

For defense, fintech, healthcare, government, EU AI Act subjects.

**Why it costs more:** every other AI tool ships SaaS. Cloud is cheap to operate at scale. Local-first / air-gapped is **harder** — needs on-premise federation hub deployment, air-gap-aware install paths, dedicated engineering support, custom rubric tuning, and the legal stack to back it up.

What you get:
- Everything in Pro, deployed entirely **inside your perimeter**
- Air-gapped install path — no outbound network calls, ever
- On-premise Wisdom Federation hub for your private repos
- Custom audit rubrics tuned to your compliance regime (SOX, SOC2, EU AI Act, FedRAMP, ISO 27001)
- 4-hour SLA with a named engineer
- Quarterly compliance review report (PDF, signed)
- Custom integration work
- Source escrow agreement

**Inverse pricing logic.** Most AI tools charge less for "local-first" because cloud is the default product. Mneme's premium tier IS local-first — because that's what regulated industries require, and they pay accordingly.

```
contact: enterprise@mneme.dev   (inquiries reviewed weekly)
```

═══════════════════════════════════════════════════════════════════════

## Comparison

| Capability | Free | Pro | Enterprise |
|---|:---:|:---:|:---:|
| Full CLI + MCP server (94 tools) | ✅ | ✅ | ✅ |
| Second Brain + Super Sonic Engine | ✅ | ✅ | ✅ |
| `git mneme` extension + hooks | ✅ | ✅ | ✅ |
| CI/CD templates | ✅ | ✅ | ✅ |
| Local-first (no telemetry) | ✅ | ✅ | ✅ |
| Hosted audit chain (Merkle) | — | ✅ | ✅ |
| Ed25519-signed certificates | — | ✅ | ✅ |
| Wisdom Federation network | — | ✅ (public hub) | ✅ (private hub) |
| Email support | — | 48h | 4h SLA |
| On-premise deployment | — | — | ✅ |
| Air-gapped install path | — | — | ✅ |
| Custom compliance rubrics | — | — | ✅ |
| Quarterly signed compliance report | — | — | ✅ |
| Source escrow | — | — | ✅ |
| Dedicated engineer | — | — | ✅ |

═══════════════════════════════════════════════════════════════════════

## FAQ

**Why is Enterprise more expensive than SaaS?**
Because cloud SaaS is the easier product to ship and operate. Local-first / air-gapped is harder. The price reflects that — and the regulated industries that need it agree it's worth it.

**Can I use the Free tier commercially?**
Yes. MIT license. Use it however you want.

**Can I self-host the Wisdom Federation hub on the Pro tier?**
No — Pro uses our public hub. If you need an on-premise hub, that's the Enterprise tier.

**Is there a discount for non-profits / academic researchers?**
Pro tier is free for verified non-profits + academic users at accredited institutions. Email proof of affiliation.

**Will the Free tier ever stop being free?**
No. The Free tier is the wedge. Capabilities may move from Pro back to Free as the project matures. Capabilities never move the other way.

═══════════════════════════════════════════════════════════════════════

## See also

- [README — what Mneme is](../README.md)
- [docs/sales/01-PARTNERSHIP-PITCH.md — for GitHub/GitLab/Microsoft conversations](sales/01-PARTNERSHIP-PITCH.md)
- [docs/sales/02-EU-AI-ACT-COMPLIANCE.md — for compliance officers](sales/02-EU-AI-ACT-COMPLIANCE.md)
- [docs/sales/03-SAAS-V2-ARCHITECTURE.md — the SaaS path (future tier)](sales/03-SAAS-V2-ARCHITECTURE.md)
