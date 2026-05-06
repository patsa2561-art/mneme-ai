# Forensic Code Science

> Real forensic-science methodology applied to git history — not a metaphor.
>
> Bayesian author attribution with the **ENFSI verbal scale**. Vulnerability hunting with **CWE-aligned signatures**. Insider-threat detection via **baseline deviation analysis**. Built for bank/finance-grade engineering oversight.

═══════════════════════════════════════════════════════════════════════════════

## What problem this solves

Code reviews catch what humans see. But:
- **Hackers don't write commits that say "exploit"** — they impersonate authors and slip changes through normal-looking PRs.
- **Vulnerabilities live silently for years** — a Math.random() introduced in 2019 stays exploitable until someone audits.
- **Disputed authorship has no rigorous answer** — "did Alice really write this?" usually gets a hand-wavy reply.

`mneme forensics` brings the actual practice of forensic science — likelihood ratios, verbal scales, evidence chains, baseline deviation — to git history. **The first system to do so.**

═══════════════════════════════════════════════════════════════════════════════

## Four commands, four disciplines

| Command | Discipline | Question it answers |
|---------|-----------|---------------------|
| `mneme forensics match <commit> <author>` | DNA matching | "Did this author write this commit?" |
| `mneme forensics attribute <commit>` | Anonymous identification | "Who most likely wrote this?" |
| `mneme forensics vulns` | Digital forensics | "What vulnerable patterns exist in our history?" |
| `mneme forensics anomaly` | Insider-threat detection | "Is any commit suspicious enough to investigate?" |

═══════════════════════════════════════════════════════════════════════════════

## 1 · STR-Loci Author Attribution

Real forensic DNA matches use **Short Tandem Repeats (STR)** at 13–20 loci. CODIS (the FBI database) reports likelihood ratios at each locus and combines them via product rule.

**Mneme's 12 code STR loci** *(novel taxonomy)*:

| # | Locus | What it measures |
|---|-------|------------------|
| L1 | `filesPerCommit` | Atomic-vs-bundled commit habit |
| L2 | `conventionalRatio` | Discipline (feat:/fix:/etc.) |
| L3 | `avgSubjectLength` | Communication style |
| L4 | `bodyRatio` | Documentation discipline |
| L5 | `referenceRatio` | PR/issue linking habit |
| L6 | `testRatio` | Quality bar |
| L7 | `peakHour` | Schedule fingerprint *(discrete)* |
| L8 | `weekendRatio` | Work-life pattern |
| L9 | `imperativeRatio` | Linguistic fingerprint |
| L10 | `topDirAffinity` | Domain expertise |
| L11 | `verbEntropy` | Vocabulary diversity (Shannon entropy) |
| L12 | `messageStyleHash` | Verb-fingerprint hash *(discrete)* |

### Likelihood ratio (Bayesian)

```
LR = P(evidence | suspect wrote it) / P(evidence | population wrote it)
```

Per locus: Gaussian likelihood for continuous, direct frequency for discrete.

Combined (product rule, assumes independence):

```
LR_total = ∏  LR_i
          i=1..12
```

### ENFSI verbal scale (real forensic standard)

| Combined LR | Verdict (ENFSI 2015 standard) |
|-------------|-------------------------------|
| > 1,000,000 | extremely strong support |
| 10,000–1,000,000 | very strong support |
| 1,000–10,000 | strong support |
| 100–1,000 | moderate support |
| 2–100 | weak support |
| 0.5–2 | uninformative |
| < 0.5 | support against (mirrored bands) |

> ⚖️ Forensic standards present LRs verbally, never as percentages. Mneme follows the same convention.

### Example output

```bash
mneme forensics attribute b933a2f --top 3
```

```text
🧬  Forensic Attribution — anonymous commit → most likely author
═══════════════════════════════════════════════════════════════
  commit b933a2f (Initial release: Mneme...)

  ◆ Ranked candidates

    #1   shinnapat@gmail.com               LR=2.34e+04  VERY STRONG SUPPORT
         18 prior commits · log10(LR)=4.37

    #2   bob@example.com                   LR=8.21e-02  WEAK SUPPORT AGAINST
         12 prior commits · log10(LR)=-1.09
```

═══════════════════════════════════════════════════════════════════════════════

## 2 · Vulnerability Hunt (CWE-aligned)

Pattern-match against known-vulnerable signatures across all of git history.

**11 vulnerability classes** mapped to CWE identifiers:

| Class | CWE | Examples detected |
|-------|-----|-------------------|
| 🔐 Crypto weakness | CWE-327, 330, 321 | MD5/SHA1, DES, Math.random as RNG, hardcoded secrets |
| 💉 SQL injection | CWE-89 | string concat / template interpolation in queries |
| 💉 Shell injection | CWE-78 | exec/spawn with user input |
| 💉 XSS | CWE-79, 95 | dangerouslySetInnerHTML, eval() with input |
| 🚪 Auth flaw | CWE-287, 798, 347, 942 | hardcoded tokens, JWT no-verify, CORS *+credentials |
| 💸 Financial logic | CWE-190, 682, 840 | money arithmetic, JS Number for amounts, missing negative checks |
| 📦 Supply chain | CWE-1357 | dependency added/version changed |
| 🕳 Info leakage | CWE-209 | sensitive value logged, stack trace in response |
| 🔀 Race condition | CWE-362 | check-then-await TOCTOU patterns |
| 🎭 Privilege | CWE-269 | setuid(0), os.setuid |

### Output

```bash
mneme forensics vulns --since 2024-01-01 --top 500
```

```text
🛡  Vulnerability Hunt — pattern-matched security findings
═══════════════════════════════════════════════════════════════
  500 commits scanned  ·  34 hits  ·  3 silent fixes

  ✦ By severity
    CRIT      10
    HIGH       2
    MEDIUM    22

  ◆ Top findings
    CRIT      f427ab1 2024-05-05 CWE-330
        Non-cryptographic RNG used — use crypto.randomBytes
        evidence: Math.random()

    CRIT      a3f9b21 2024-08-14 CWE-89
        SQL string concatenation — possible injection
        evidence: "SELECT * FROM users WHERE id = " + userId
```

> ⚠️ **Pattern matching produces candidates.** Every hit needs human review before action. This is honest forensic methodology — never auto-fail on heuristic signal.

### Silent-fix detection

If a commit's subject mentions security but doesn't raise rule hits, it's listed under `silent fixes`. Useful for compliance: did anyone ship a security fix without telling the team?

═══════════════════════════════════════════════════════════════════════════════

## 3 · Insider-Threat / Anomaly Detection

The bank/finance scenario: **detect compromised credentials or rogue commits.**

For each author, build a baseline from their entire history, then score new commits across four independent axes:

| Axis | Measures | Bank-relevant signal |
|------|----------|---------------------|
| **TIME** | Distance from author's UTC peak window + hour rarity | "Alice never commits at 3 AM but this one is at 3:47 AM" |
| **FILES** | Fraction of touched files the author has never touched before | "Alice has never touched src/payments/secrets.ts" |
| **STYLE** | Verb-novelty + commit-size deviation | "Verb 'exfiltrate' not in Alice's vocabulary across 1247 commits" |
| **SIZE** | Robust z-score (MAD) of insertions+deletions vs author's median | "+4,231 lines vs Alice's median 47" |

### Composite score

```
total_deviation = w_time × time + w_files × files + w_style × style + w_size × size
                  (1.0)         (1.0)            (0.7)           (0.8)
```

### Severity bands

| Total deviation | Severity | Recommended action |
|----------------|----------|-------------------|
| ≥ 2.5 | CRITICAL | Verify author identity out-of-band before merge |
| ≥ 1.7 | HIGH | Require explicit approval from a second engineer |
| ≥ 0.9 | MEDIUM | Include in standard PR review with attention |
| < 0.9 | LOW | No action |

### Example output

```bash
mneme forensics anomaly --threshold 1.5
```

```text
🕵  Anomaly Detection — insider-threat / credential-compromise hunt
═══════════════════════════════════════════════════════════════

  ⚠ Anomalous commits (sorted by deviation)

    CRIT      e45d0a1 2026-05-06T03:47 · alice@bank.com
        deviation = 4.20  (≈ 8.40σ)
        feat: refactor payments module

          ████████░░  time   commit hour 03:00 UTC is 12h from peak window 14:00–18:00 · hour frequency 0.2% in author history
          ██████████  files  3/3 files are new for this author (e.g. src/auth/secrets.ts, src/db/private.ts)
          █████░░░░░  style  verb "exfiltrate" not in author's vocabulary (47 verbs across 1247 commits)
          ████████░░  size   +4231 lines vs author's median 47 (robust z = 92.0)
        → review immediately; verify author identity out-of-band before merging
```

> 🛡 This is the bank-grade use case. A stolen credential pushing a single commit at 3:47 AM gets caught **before review** — with a specific four-axis explanation that a security analyst can act on.

═══════════════════════════════════════════════════════════════════════════════

## Honest limits

- **Pattern matching produces candidates, not certified vulnerabilities.** Always human-review every hit.
- **STR loci aren't as discriminating as biological STR.** Don't claim "100% accurate identification" — claim "very strong support" on the verbal scale.
- **Anomaly detection is probabilistic.** A 4σ event has ~6 in 100,000 chance of being normal noise — not zero.
- **No tool replaces SAST.** This complements CodeQL/semgrep by surfacing patterns *across history*, not just current snapshot.

What this gives you that no other tool does:
- **Forensic-grade methodology** — verbal scale, likelihood ratios, baseline deviation
- **Retrospective vulnerability hunt** — find old MD5() introductions that current SAST can't see in unchanged code
- **Author authentication** — verify a disputed commit really came from the claimed author
- **Audit trail** — every finding includes evidence + reference + reproducible methodology

═══════════════════════════════════════════════════════════════════════════════

## See also

- 🛡 [[Guardian]] — runs forensics commands periodically for continuous oversight
- 📊 [[Novel-Algorithms]] — the math behind retrieval scoring (related but separate)
- 🔒 [[Privacy]] — forensics runs locally; no commit data leaves your machine
- 🏗 [ARCHITECTURE.md](https://github.com/patsa2561-art/mneme-ai/blob/main/ARCHITECTURE.md)
