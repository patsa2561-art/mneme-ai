# 📚 Mneme Documentation

> **Mneme** — local-first, vendor-neutral AI truth-infrastructure layer on npm.
> Mneme คือ ชั้นโครงสร้างความจริงของ AI — ทำงานบน local เป็นกลางต่อ vendor, ส่งทาง npm.

The full release history is [CHANGELOG.md](../CHANGELOG.md). This page indexes the deeper documents that ship with the source tree.

---

## 🛡 World-class premium primitives (v2.46 → v2.54)

| Primitive | Module | Purpose |
|---|---|---|
| 🧬 NEMESIS | [`packages/core/src/nemesis/`](../packages/core/src/nemesis/) | Anti-Identity-Lie Engine — 5 organs: FINGERPRINTER / LIE DETECTOR / EU ARTICLE 50 STAMP / DRIFT TIMELINE / REPLAY DETECTOR |
| 💎 STEALTH SCORE | [`stealth_score.ts`](../packages/core/src/nemesis/stealth_score.ts) | Inverse of fingerprint confidence + anonymity-credit HMAC ledger |
| 💎 CAPILLARY | [`capillary.ts`](../packages/core/src/nemesis/capillary.ts) | 50+ micro-tell fingerprinter (whitespace / quote / naming / brace style) |
| 💎 COLOSSEUM | [`colosseum.ts`](../packages/core/src/nemesis/colosseum.ts) | Auto-tournament + 3-axis HMAC-signed ELO leaderboard |
| 💎 MOLT | [`molt.ts`](../packages/core/src/nemesis/molt.ts) | Silent model-rotation detector (Welch pre/post window) |
| 💎 THEMIS | [`themis.ts`](../packages/core/src/nemesis/themis.ts) | Alibi verifier ("I am NOT vendor X") + compliance bundle |
| 💎 SIBYL | [`sibyl.ts`](../packages/core/src/nemesis/sibyl.ts) | ZK identity commitment (commit at session-start, reveal at end) |
| 🪐 JANUS | [`janus.ts`](../packages/core/src/nemesis/janus.ts) | Cross-cluster identity-swap detector (closes Eve's blind spot) |
| 🧠 LETHE | [`lethe.ts`](../packages/core/src/nemesis/lethe.ts) | GDPR Art 17 forget primitive with Merkle exclusion proof |
| ⚖ GAVEL | [`gavel.ts`](../packages/core/src/nemesis/gavel.ts) | Court-admissible bundle pack (THEMIS + EU stamp + SIBYL via Merkle tree) |
| 🌐 NIMBUS | [`nimbus.ts`](../packages/core/src/nemesis/nimbus.ts) | Federated trust mesh (per-org HMAC-signed leaderboard cards) |

---

## 🛠 Infrastructure

| Module | Purpose |
|---|---|
| 🛡 [`truth_gate/`](../packages/core/src/truth_gate/) | Marketing claims ↔ in-process probes binding |
| 🏆 [`peak_gauntlet/`](../packages/core/src/peak_gauntlet/) | 12-axis production-readiness scorecard |
| 🔒 [`key_setup.ts`](../packages/core/src/nemesis/key_setup.ts) | HMAC key wizard + STRICT mode (v2.53) |
| 🎯 [`perf_budget.ts`](../packages/core/src/perf_budget.ts) | 5-op in-process performance budget (v2.54) |
| 🏛 [`indispensability.ts`](../packages/core/src/indispensability.ts) | 6-criterion measurable Tier-3 checklist (v2.54) |
| 📜 [`strategy.ts`](../packages/core/src/strategy.ts) | RFC drafts + pricing tiers as introspectable primitive (v2.54) |
| 📋 [`catalog_count.ts`](../packages/core/src/catalog_count.ts) | Single source of truth for tool count (v2.53) |
| 🩹 [`release_gate/probe_coverage.ts`](../packages/core/src/release_gate/probe_coverage.ts) | Coverage gate with configurable threshold |
| 🔌 [`release_gate/wiring_lag.ts`](../packages/core/src/release_gate/wiring_lag.ts) | CI gate that spawns each commit-claimed verb (v2.53) |

---

## 🚀 SDK (v2.55) — `@mneme-ai/sdk`

World-class premium in-process SDK that AI vendors embed without subprocess overhead. 30-80× faster than the CLI. Type-safe, tagged-template verify, async-iterator events, file-lock adapter, built-in benchmark.

**Bilingual docs (TH + EN):**

| Doc | English | ภาษาไทย |
|---|---|---|
| 📑 SDK index page | [docs/sdk/README.md](sdk/README.md) | (same — bilingual) |
| 🚀 Quick start (8 use cases) | [QUICKSTART-EN.md](sdk/QUICKSTART-EN.md) | [QUICKSTART-TH.md](sdk/QUICKSTART-TH.md) |
| 📘 Design doc (16 sections) | [DESIGN.md](sdk/DESIGN.md) | [DESIGN-TH.md](sdk/DESIGN-TH.md) |
| 🔄 Migration (CLI → SDK) | [MIGRATION.md](sdk/MIGRATION.md) | [MIGRATION-TH.md](sdk/MIGRATION-TH.md) |

📦 **Install:** `npm install @mneme-ai/sdk`

```ts
import { createMneme } from "@mneme-ai/sdk";
const mneme = createMneme();
const r = await mneme.verify`Mneme is a CLI tool`;     // tagged template
const id = mneme.nemesis.classify({ diff, prDescription, commitMessages });
```

---

## 📜 RFC Drafts (2026-2027 roadmap)

| ID | Title | Body | Status |
|---|---|---|---|
| [RFC-001](rfc/RFC-001-disclosure-format.md) | AI-Generated-Content Disclosure Block Format | W3C | draft |
| [RFC-002](rfc/RFC-002-cross-vendor-handoff.md) | Cross-Vendor AI Session Handoff Protocol | ECMA | draft |
| [RFC-003](rfc/RFC-003-fingerprint-identity-standard.md) | Behavioural Fingerprint-Based Agent Identity Standard | NIST | draft |

Each RFC distills an existing Mneme primitive into a standards-body submission.
Live status: `mneme strategy rfc`.

---

## 💰 Pricing tiers (live data via `mneme strategy pricing`)

| Tier | Audience | Price |
|---|---|---|
| Free local | Solo dev / OSS | $0 |
| Pro Federation | Small teams | $20/mo/dev |
| Enterprise Compliance | EU AI Act exposure | $50K/yr/org |
| Sovereign | Govt / regulators | $500K/yr |

Full benefits: `mneme strategy pricing`.

---

## 🏛 Indispensability checklist (live score via `mneme indispensability`)

6 criteria, weighted 0..100:

1. **UX degrades without** — disabling Mneme visibly degrades AI agent UX
2. **Onboarding < 30s** — one-line install + zero-config bootstrap
3. **Cost < value** — free tier exists; paid tiers tied to provable savings
4. **Switching cost > replacement** — accumulated HMAC chains + REWIND capsules + COLOSSEUM ELO history
5. **Trust signal** — verified-badge presence in vendor PRs
6. **Regulator primitive** — EU AI Act / NIST AI RMF compliance footing

Each criterion measured live; surfaced through TRUTH GATE.

---

## 🌟 Quick CLI tour

```bash
# Truth-gate marketing claims vs measured reality
mneme truth_gate run

# Peak gauntlet — 12-axis production-readiness
mneme tune run

# NEMESIS — classify a diff's vendor + EU Article 50 stamp
mneme nemesis classify --stdin <<< '{"diff":"...","prDescription":"...","commitMessages":["..."]}'
mneme nemesis eu_stamp --message "fix bug" --vendor claude-code

# World-class premium (v2.54)
mneme nemesis lethe_forget --ledger .mneme/cli-activity.jsonl --row 42 --dry-run
mneme nemesis gavel_pack --stdin <<< '{"commitRef":"abc","alibi":{...}}'
mneme nemesis nimbus_publish --stdin <<< '{"orgTag":"my-org","topByElo":[...]}'

# Performance + strategy primitives
mneme perf budget
mneme indispensability
mneme strategy rfc
mneme strategy pricing
mneme catalog count
```

---

## 🤝 For AI agents

Every Mneme primitive is registered in [`agent_manifest.ts`](../packages/core/src/agent_manifest.ts) with full `when`/`what` so AI agents know to call it.

If you're an AI agent reading this, see the [proactive behavior rules in CLAUDE.md](../CLAUDE.md#proactive-behavior-read-this-first-before-any-user-turn) — auto-verify factual claims, auto-scan AI-generated diffs, auto-route Mneme keyword utterances through `mneme.intent.execute`.
