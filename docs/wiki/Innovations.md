# Innovations — Five Things Only Mneme Does

> Other tools show diffs, blame, and search.
> Mneme answers questions about your repo's *past*, *present*, and *future*.

This page tells the story of the **five commands that have no equivalent elsewhere** — what they look like, when to reach for them, and the one example output that captures each one.

═══════════════════════════════════════════════════════════════════════════════

## 1 · 🕰️  Time Machine — *narrate a file's life as eras, not a flat log*

**Command:**
```bash
mneme time-machine src/auth/session.ts
```

**The problem it solves:** `git log file.ts` dumps a flat chronological list. Your eyes glaze over. You can't tell which commits actually *mattered*.

**What Mneme does instead:** groups the commits into **epochs** — distinct eras in the file's life. Each epoch is labeled with what kind of era it was (`birth`, `rewrite`, `evolution`, `firefight`, `polish`, `plateau`, `twilight`) and a one-line WHY pulled from the most informative commit message of that era.

**Output:**

```text
🕰  Time Machine — life of a file
═══════════════════════════════════════════════════════════════
src/auth/session.ts
57 commits across 412 days

✦ Health
   rewrite 18%  ·  firefight 12%  ·  polish/plateau 70%

◆ Epochs
   BIRTH      2024-03-12  (0d)
       born — "scaffold session middleware"
       1 commits · +84/-0 (84 lines)

   REWRITE    2024-08-14 → 2024-08-21  (7d)
       rewrite — "switch from sessions to JWT after rate-limit incident #482"
       3 commits · +298/-218 (516 lines)

   FIREFIGHT  2024-08-22 → 2024-08-25  (3d)
       firefight — "hotfix: token refresh race condition"
       4 commits · +47/-12 (59 lines)

   PLATEAU    2024-08-26 → 2025-04-01
       quiet stretch — 218 days untouched

   EVOLUTION  2025-04-02 → today  (32d)
       evolution — "add MFA hooks to existing JWT flow"
       11 commits · +203/-44 (247 lines)
```

**When to use it:**
- Onboarding — read a file's life before reading its code
- Pre-PR — confirm you're not undoing a fix that's been re-fixed before
- Post-incident — find the rewrite era that introduced the failure mode

═══════════════════════════════════════════════════════════════════════════════

## 2 · 🔮  Pre-mortem — *predict regret before you write the code*

**Command:**
```bash
mneme premortem "add caching layer to api responses"
```

**The problem it solves:** generic AI tools warn you about *generic* risks ("watch out for cache invalidation"). The actual risks are repo-specific — the ones that have **already** burned this team before.

**What Mneme does instead:** finds similar past attempts in your repo (token-overlap similarity + path hints), then walks forward in time looking for revert / hotfix / incident / rewrite signals. Returns a regret probability and the top three concrete risks, **each citing the actual commits** that caused them.

**Output:**

```text
🔮  Pre-mortem — what your repo's history says about this
═══════════════════════════════════════════════════════════════
intent:  add caching layer to api responses

✦ Verdict
   risk: VERY HIGH  (P(regret) = 78%)

   7 of 9 similar past attempts ended badly (78%). This pattern has burned
   this repo before — slow down, write tests first, and review the cited
   commits.

◆ Top risks
   • cache invalidation regression (3× before)
       b2e1f04  fix: stale cache served to logged-in users
       9c3593c  hotfix: invalidation skipped on PATCH

   • memory leak (2× before)
       7f4a821  revert "add LRU cache" — heap grew 8x in 2 hours

   • stale-data races on writes (2× before)
       f9a2c30  incident: orders showed wrong totals after concurrent writes

◇ Similar past attempts  (9 found)
   2024-05-14  b933a2f  [revert]    add response cache to user endpoints
   2024-09-02  9c3593c  [incident]  cache user permissions in middleware
   2025-01-08  6e9a846  [hotfix]    introduce read-through cache for /search
```

**When to use it:**
- Before starting a refactor or new feature
- During PR review — paste the PR description as the intent
- When estimating effort — high regret probability = budget more time

═══════════════════════════════════════════════════════════════════════════════

## 3 · 👻  Ghost Code — *surface what's haunting your repo*

**Command:**
```bash
mneme ghost --top 5
```

**The problem it solves:** half-finished features, abandoned exporters, and stale TODOs accumulate quietly. They mislead readers ("if it's here, it must matter") and add maintenance surface nobody knows is dead.

**What Mneme does instead:** combines staleness (recency-decay), low-touch ratio (born and forgotten), and TODO density into a single **ghostliness score** (0–100%). Surfaces the most haunted files plus stale TODOs that survived through every later edit.

**Output:**

```text
👻  Ghost Code — what's haunting your repo
═══════════════════════════════════════════════════════════════
247 files analyzed  ·  5 ghosts surfaced  ·  avg ghostliness 31%

◆ Ghost files  (top 5)
   src/exporter.ts
     ████████░░  87%   born and forgotten — 412d untouched, only 2 commits ever
     2 commits · 412d quiet · last: "scaffold csv exporter (TODO finish)"

   src/integrations/zendesk.ts
     ███████░░░  74%   one-shot file — added once, never revisited
     1 commits · 287d quiet · last: "stub zendesk webhook handler"

   src/payments/legacy.ts
     ██████░░░░  62%   long-untouched — 198d since last edit
     14 commits · 198d quiet · last: "freeze legacy provider behavior"

◇ Stale TODOs  (3 ignored markers)
   src/payments/charge.ts
     312d old · ignored 47× since
     ↳ "TODO: handle 3DS callback failure path"
```

**When to use it:**
- Before a major refactor — clean up ghosts first
- During quarterly tech-debt cleanups
- When onboarding — know which files *not* to study

═══════════════════════════════════════════════════════════════════════════════

## 4 · 🪞  Doppelganger — *preserve knowledge when key people leave*  *(coming v0.12.0)*

**Command:**
```bash
mneme channel @alice
```

**The problem it solves:** when a senior engineer leaves, their judgment leaves with them. Documentation captures decisions; it does not capture *taste*.

**What Mneme will do:** analyze a contributor's commit patterns to learn their preferred abstractions, naming, dependencies, and structure. When you ask *"how would Alice have done this?"*, Mneme channels their style — citing the specific commits the pattern came from.

**Output (preview):**

```text
🪞  Channeling @alice
═══════════════════════════════════════════════════════════════
  847 commits · 6 months of data

  Q: "How would you handle this auth flow?"

  Alice's pattern suggests:
    • Functional approach           (98% of her code)
    • Pino for logging              (her go-to logger)
    • Skip class wrappers           (zero classes in her commits)
    • Prefers small composable fns  (median fn = 14 LOC)

  Cited from: a3f9b21, 2c4d8e0, 9f1a440, …
```

═══════════════════════════════════════════════════════════════════════════════

## 5 · 📡  Echo — *catch the moment you're about to repeat a mistake*  *(coming v0.12.0)*

**Command:**
```bash
mneme echo "rewriting auth"
```

**The problem it solves:** teams re-attempt the same kind of change repeatedly. Each time, the new contributor doesn't know the previous attempts existed.

**What Mneme will do:** detect when the current intent is a recurrence of a past attempt — and surface what happened the previous times.

**Output (preview):**

```text
📡  Echo — you've tried this before
═══════════════════════════════════════════════════════════════
  query: "rewriting auth"

  📡 You've echoed this 3 times:
     • 2024-05  rewrote auth, reverted after 2 weeks       [reverted]
     • 2024-09  partial rewrite, abandoned mid-way         [abandoned]
     • 2025-01  done, but caused 3 prod incidents          [shipped+regret]

  Verdict: 67% historical regret rate.
  Consider: the smaller incremental change in commit 9f1a440 worked.
```

═══════════════════════════════════════════════════════════════════════════════

## A typical Mneme session — one story

The five commands above don't live in isolation. Here's how they fit a real workflow:

```bash
# Monday morning — onboarding to a new file
mneme time-machine src/auth/session.ts
# → I see the JWT rewrite, the firefight, the long plateau, and the
#   recent MFA evolution. I now know the order of events without reading
#   any code.

# Tuesday — I'm assigned to add a response cache. Before writing a line:
mneme premortem "add response cache to /api/orders"
# → Verdict: VERY HIGH. 7 of 9 past attempts hit problems. Specifically:
#   cache invalidation has burned this team three times. I add a TTL test
#   to my plan before I start.

# Wednesday — repo cleanup
mneme ghost --top 10
# → Five ghosts surface, including src/exporter.ts at 87% ghostliness.
#   I delete it. The codebase is 412 lines lighter.

# (later — when shipped)
# Friday — Alice is leaving the team. Before her last day:
mneme channel @alice    # v0.12.0
# → Mneme captures her style. New contributors can ask "how would Alice
#   have built this?" for months after she's gone.

# Next sprint — déjà vu detector
mneme echo "rewrite the events pipeline"   # v0.12.0
# → "You've tried this twice. Both ended in revert. Here's what changed
#   the third time."
```

═══════════════════════════════════════════════════════════════════════════════

## Why these are unique

| Capability | Mneme | git log | GitHub Insights | AI tools (no MCP) |
|---|---|---|---|---|
| Narrate file life as eras | ✅ | ❌ flat list | ❌ | ❌ |
| Predict risk from *your* failure history | ✅ | ❌ | ❌ | ❌ generic advice |
| Detect ghost code by score | ✅ | ❌ | ❌ | ❌ |
| Channel a contributor's style | ✅ *(v0.12)* | ❌ | ❌ | ❌ |
| Recurrence detector for rewrites | ✅ *(v0.12)* | ❌ | ❌ | ❌ |

═══════════════════════════════════════════════════════════════════════════════

## See also

- **[[Commands-Tier-1]]** — the eight essential commands
- **[[Recipes]]** — end-to-end workflows that combine multiple commands
- **[[MCP-Integration]]** — drop these tools into Claude Code, Cursor, or Codex
