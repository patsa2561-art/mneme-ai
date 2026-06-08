# Launch copy — the Cross-Layer Accountability Suite (ready to post)

Honest by construction: every claim below maps to a deterministic command anyone can re-run. No
"AI-powered" hand-waving — the differentiator is that there's *no LLM in the analysis path*, so the
findings are reproducible and signed. Edit the voice to taste; don't add claims that aren't in the box.

---

## Show HN

**Show HN: Mneme — cross-layer code intelligence with no LLM in the analysis path**

I kept hitting a class of bug that `git`, my linter, and CI all miss: a change that's fine *in its own
file* but breaks something across a layer it never mentions — an edit that silently writes a different
table, two AI agents editing different files that both write `users`, a "chore: cleanup" commit that
actually rewrites a payment function, dropping a table that 14 functions still use.

So I built a deterministic cross-layer graph — **code ↔ DB tables (from the ORM/SQL schema) ↔ API
routes ↔ business rules (from the PRD)** — extracted by structural pattern, no model, every node/edge
traceable to a real file. On top of it, one command:

    npm i -g mneme-ai && mneme review

prints a Codebase Accountability Report: risk hotspots (keystones = sole-writers to a table), authz
gaps (an endpoint that writes a sensitive table with no auth on the path), and untested keystones.

The pieces I found genuinely missing elsewhere:
- **`mneme graph reverse <table>`** — what breaks if you drop it (SAFE/RISKY/CRITICAL).
- **`mneme collision --branches a,b`** — two branches that collide *across layers* (different files,
  same table) — the conflict git can't see — plus a safe merge order.
- **`mneme scope verify`** — did an autonomous agent stay within the scope it declared? Signed,
  cross-vendor *fidelity* score. (An agent can't certify its own scope-keeping — that's why a neutral
  layer issues it.)
- **`mneme commit-check`** — is the commit message mislabeled vs its real impact?

It's also an MCP server, so any agent (Claude Code / Cursor / Cline / …) gets these as tools, and it's
on a gRPC rail. Works on JS/TS/Python/Go/Rust.

**Honest about the limits:** it's a *structural* analysis — function bodies are region-approximated
(not a full AST), "untested" means no test file mentions a node (a heuristic, reliable for distinctive
names), authz gaps can be false-positives when auth is middleware. Every finding is a candidate to
inspect, not a proven runtime bug. The win is the cross-layer JOIN + that it's deterministic and signed.

MIT, local-first, the source never leaves your machine. Try it on any public repo with no install:
https://xray.mneme-ai.space/radar  ·  npm: https://www.npmjs.com/package/mneme-ai

Would love feedback on the extractor's precision on your stack.

---

## X / thread

1/ git catches a merge conflict when two people edit the same lines.
It's blind to this: Agent A edits `auth.ts`, Agent B edits `billing.ts` — and both write the `users`
table. No conflict. Then prod breaks.
I built the layer that catches it. 🧵

2/ `npm i -g mneme-ai && mneme review`
→ one Codebase Accountability Report: risk hotspots, authz gaps, untested keystones.
Deterministic. No LLM in the analysis path. Every finding traces to a real file.

3/ It's a cross-layer graph: code ↔ DB tables ↔ API routes ↔ business rules.
`mneme graph reverse payments` → everything that breaks if you drop it.
`mneme graph view <fn>` → an interactive "Impact Radar" of the blast across layers.

4/ For the multi-agent era:
`mneme scope verify` → did the agent stay in the scope it *declared*? (signed, cross-vendor)
`mneme collision --branches a,b` → where two agents collide across layers + a safe merge order.

5/ It's an MCP server too — Claude Code / Cursor / Cline get all of it as tools, automatically.
Works on JS/TS/Python/Go/Rust. MIT. Local-first.

6/ Honest about limits: structural analysis, heuristics where it must, candidates not proofs.
The edge is the cross-layer join + determinism + signed receipts a vendor can't issue for its own agent.
Try any public repo, no install: xray.mneme-ai.space/radar

---

## One-liner (bio / tagline)
> The cross-layer accountability layer for the autonomous-agent era — deterministic, signed, no LLM in the analysis path.
