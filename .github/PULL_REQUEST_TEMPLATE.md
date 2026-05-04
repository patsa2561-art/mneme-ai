<!--
Thanks for the PR. The cheapest way to get this merged is to:
  - Keep it focused (one concern per PR)
  - Pass CI (build + tests + eval)
  - Explain *why* in the description (Mneme is a tool that reads commit and PR descriptions — write the kind of message Mneme would surface for a future contributor)
-->

## What this PR does

<!-- A few sentences. The diff says what changed; this section says why it changed. -->

## Phase / area

<!-- Tick whatever applies; remove the rest. -->

- [ ] Phase 1 — Archaeologist core
- [ ] Phase 2 — Semantic similarity / clones
- [ ] Phase 3 — Error correlation
- [ ] Phase 4 — Temporal viz
- [ ] Cross-cutting (build, CI, docs, tests)

## How I tested it

<!--
Specify which suites you ran. Required (run them locally before opening):
  - npm run build
  - npm test
  - npm run eval -- --variant baseline
If your change touches retrieval quality, also run:
  - npm run eval     (all variants)
  - paste the comparison table here
-->

## Quality gates

- [ ] `npm run build` — passes
- [ ] `npm test` — all tests pass
- [ ] `npm run eval -- --variant baseline` — no regression vs `main`
- [ ] If quality-affecting: ran full eval and noted any change
- [ ] If new public API: added or updated tests
- [ ] Did not commit `.claude/`, `.cursor/`, `.env*`, secrets, build artifacts

## Notes for the reviewer

<!-- Tradeoffs you considered. Things you couldn't decide. Things you want a second opinion on. -->
