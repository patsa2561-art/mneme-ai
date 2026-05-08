# The Mneme Periodic Table

> *Element. Atom. Molecule. Compound. Catalyst. Reaction.*
> v0.40 introduces a chemistry-style architecture under Mneme's 75 commands —
> not by replacing them, but by exposing the building blocks they were
> implicitly built from. AI tools through MCP, and humans through
> `mneme periodic-table`, can now see the periodic table of operations
> Mneme is built on.

═══════════════════════════════════════════════════════════════════════════════

## Why this exists

Mneme has 75 commands. Most share the same primitive operations: `git log`,
embedding generation, cosine similarity, regex pattern matching, AST parsing,
Bayesian scoring. Encoding those primitives once, with manifests, means:

1. **AI tools through MCP can discover the periodic table at runtime** and
   assemble their own queries — no need to memorise a flat command bag.
2. **Cost-aware planning becomes possible** — the v0.41 compiler picks the
   cheapest composition for an intent.
3. **The system explains itself** — `mneme periodic-table` lists everything
   humans need to read.
4. **Tests validate every primitive** against its declared contract so
   nothing silently drifts.

═══════════════════════════════════════════════════════════════════════════════

## The chemistry metaphor (mapped exactly)

| Chemistry | Mneme | Example |
|---|---|---|
| **Element** (1 type of atom) | A primitive operation — one git command, one regex match, one vector dot-product | `git.log`, `vector.cosine`, `pattern.regex` |
| **Atom** (instance of an element) | An element with bound parameters | `git.log.recent` = `git.log{since: '90 days ago'}` |
| **Molecule** (atoms bonded) | A composition of atoms delivering a user-visible capability — today's commands | `molecule.karma` = `karma.scan` + flow-aggregation reaction |
| **Compound** (multi-element molecule) | A multi-domain molecule (people + history + security in one) | future: `compound.security-handoff` |
| **Catalyst** (shapes a reaction without being consumed) | Config / model context | `stack.profile`, `.mneme/suppressions.json` |
| **Reaction** (transformation rule) | A rule that shapes inputs/outputs at runtime | `flow-aggregation`, `z-score-population`, `bayesian-posterior` |

═══════════════════════════════════════════════════════════════════════════════

## v0.40 catalog — 15 elements, 5 atoms, 2 molecules

### ⚛  Elements (primitive operations)

| ID | Cost | Side-effect | What it does |
|---|---|---|---|
| `git.log` | low · 50 ms | git | Single-spawn `git log -p` reader |
| `git.blame` | low · 30 ms | git | Per-line blame for a file or line range |
| `git.grep` | low · 40 ms | git | Multi-pattern fixed-string grep |
| `embed.text` | medium · 80 ms | network | Convert text to unit-norm Float32Array |
| `vector.cosine` | trivial · 0.05 ms | none | Cosine similarity (4-way unrolled) |
| `vector.dot-normalised` | trivial · 0.02 ms | none | Dot product for pre-normalised vectors |
| `vector.normalise` | trivial · 0.05 ms | none | L2-normalise in place |
| `pattern.regex` | trivial · 0.1 ms | none | Single regex match |
| `ast.evidence` | low · 0.5 ms | none | Score the lexical context of a regex match |
| `stack.profile` | low · 20 ms | filesystem | Detect tech stack from package.json |
| `score.bayesian` | trivial · 0.05 ms | none | Combine stack-prior × AST-evidence into a posterior |
| `redact.secrets` | low · 0.5 ms | none | Replace likely secrets with `[redacted]` |
| `concurrency.pmap` | trivial · 0.02 ms | none | Bounded-concurrency parallel map |
| `karma.scan` | low · 80 ms | git | Walk history extracting TODO debit/credit events |
| `twin.profile` | low · 60 ms | git | Author stylometric voice fingerprint |

### ⚙  Atoms (elements with bound parameters)

| ID | Parent | Binding |
|---|---|---|
| `git.log.recent` | `git.log` | `{since: '90 days ago', noMerges: true}` |
| `git.log.author` | `git.log` | `{noMerges: true}` (caller passes `email`) |
| `embed.batch` | `embed.text` | `{concurrency: 16}` (HPC-pass bind) |
| `score.bayesian.tech-aware` | `score.bayesian` | (couples stack + evidence at call site) |
| `vector.search` | `vector.dot-normalised` | (top-k search wrapper) |

### 🧬  Molecules (atom compositions)

| ID | Composes | Reactions | Behind the command |
|---|---|---|---|
| `molecule.karma` | `karma.scan` | flow-aggregation, log-age-weight | `mneme karma` |
| `molecule.repo-mri` | `git.log`, `concurrency.pmap`, `karma.scan` | z-score-population | `mneme repo-mri` |

═══════════════════════════════════════════════════════════════════════════════

## Browse the catalog

```bash
mneme periodic-table                    # full catalog grouped by kind
mneme periodic-table git.log            # detail for one primitive
mneme periodic-table --kind atom        # filter by kind
mneme periodic-table --tag security     # filter by tag
mneme periodic-table --json             # machine-readable for AI / MCP
```

### Sample detail view

```
$ mneme periodic-table git.log

  ⚛  git.log  (element)

  Read raw git log + diff stream from the working repo.

  Single-spawn `git log -p` reader. Returns commits with diff bodies in
  chronological-newest-first order. Sub-linear in commit count because git
  keeps its packfile cursor open across the walk.

  Inputs
    cwd          string
    maxCommits   number?
    since        string?
    pathPrefix   string?

  → output: CommitWithDiff[]

  Cost
    io                  subprocess
    cpu                 low
    ms_p50              50 ms
    deterministic       true
    side effect         git

  Tags
    #git  #history  #scan

  Implementation
    module: ../git/batch-log.js
    export: loadCommitsWithDiffs
```

═══════════════════════════════════════════════════════════════════════════════

## What v0.41 → v0.43 add on top

- **v0.41 — Compiler.** `mneme compose "<natural-language intent>"`. The LLM
  planner uses the periodic table to assemble a custom molecule, picks the
  cheapest path via the cost model, and executes.
- **v0.42 — Second Brain.** Frequent dynamic molecules get *promoted* to
  named commands automatically. `.mneme/library.json` stores them
  per-user, per-repo. After 6 months your Mneme is uniquely shaped to your
  questions.
- **v0.43 — Holy Grails.** Five world-firsts that the molecule architecture
  finally makes feasible: `self-aware`, `rewind`, `dna-fold`,
  `adversarial-twin --evil`, `heartbeat`.

═══════════════════════════════════════════════════════════════════════════════

## Architectural promise

The catalog is **additive**. Every existing Mneme command keeps working
exactly as it did. The molecule architecture is a *new layer* under the
commands, not a replacement. We will refactor more commands as molecules
over the v0.41/v0.42 releases — but always behind a backwards-compatible
flat-name façade.

═══════════════════════════════════════════════════════════════════════════════

## Related

- 💎 [[The-Frontier]] — the complete table of Mneme world-firsts
- 🆕 [[Originals]] — the v0.36 Originals
- 🧠 [[Smart-Dispatcher]] — `mneme do` (predecessor to v0.41 compose)
- 📐 [[Novel-Algorithms]] — TDWE / RACB / ADS / CGAR scoring math
