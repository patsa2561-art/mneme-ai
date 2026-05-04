<div align="center">

# Mneme · Meditations

*Thirteen short essays on memory, code, and the absence of both.*

```
   μνήμη was the Greek personification of memory,
   sometimes counted among the muses,
   sometimes named as their mother.
   These are the principles that shape the tool that bears her name.
```

</div>

---

## How to read this

Each entry is short. Read one a day if you like — the CLI will pick a different one for you each morning:

```bash
mneme wisdom            # today's meditation
mneme wisdom --n 7      # specific meditation
mneme manifesto         # all of them, in order
```

These are not comments on the code. They are a *manual for the mind* of the engineer using it.

---

## I — On Memory and Intelligence

An intelligence without memory is just guessing in a loop.

The Greeks knew this. They made Mnemosyne — μνήμη — the *mother* of the muses, not their student. Without memory you cannot have history, and without history you cannot have art, philosophy, or science. The faculties stand on the shoulders of recall.

Every AI assistant you use today is a Mnemosyne with amnesia. It can reason brilliantly within its context window — and forgets the moment that window scrolls past. We are building tools whose intelligence outstrips their memory by orders of magnitude, and we are surprised when they hallucinate.

> **Intelligence is the spark; memory is the fuel.**

---

## II — On What and Why

A passing test never told anyone *why* it had to exist.

Source code answers the question of what the program does. It is a precise, mechanical answer. Run the function with these inputs and observe these outputs. Read the types and infer the contract. In five minutes a careful reader can know what code does.

Source code does not answer the question of why. Why this control flow rather than another. Why this dependency rather than the obvious alternative. Why this hardcoded number. The why lives in the past — in commits, in pull requests, in incidents that prompted the change, in conversations that no longer exist.

Most engineering questions are really questions about the past. Mneme is a way to make the past readable.

> **Code answers what. Git answers why. Hold both.**

---

## III — On Commits as Gifts

Every commit message is a letter to the engineer who reads it six months from now.

That engineer might be a colleague. They might be you. They will not have the context you have right now. They will not remember the meeting where this design was decided, or the Slack thread that led to the constraint, or the production incident that revealed the bug.

The cost of writing a good commit message is two minutes. The cost of decoding a bad one is two hours, multiplied by everyone who ever needs to. Across a project's lifetime this asymmetry compounds into thousands of hours of avoidable archaeology.

Bad commit messages are not a personal flaw. They are a tax we levy on our own future selves, and on every teammate who will ever follow.

> **A commit message is the cheapest gift you can leave your future self.**

---

## IV — On Hallucination

When an AI assistant cannot see why a piece of code exists, it does not say so.

It guesses. The guess sounds plausible because plausibility is what language models optimize. The reasoning is well-formed, the citations look real, the tone is confident. There is nothing in the output that says *I made this up*.

This is not a bug in the model. The model is doing exactly what it was trained to do — produce continuations that read like good writing. When the model lacks the context, the only way for it to produce good writing is to invent context that fits.

Hallucination is the absence of context, dressed up as confidence.

The cure is not a smarter model. The cure is to give the model the actual context. That is the work Mneme does.

> **An AI without memory is a confident liar by default.**

---

## V — On Two-Stage Retrieval

Recall is not the same as precision.

A good first stage casts a wide net. It says, *the right answer is probably somewhere in these fifty results*. It does not try to choose the best one yet. It tries to make sure the best one has not been missed.

A good second stage — a reranker — looks at those fifty and chooses the top three. It can be slower, more careful, more expensive. It does not need to scan a million chunks; it has fifty in front of it.

Trying to do both jobs at once is the cardinal sin of retrieval. A first stage tuned for precision will discard the right answer. A second stage tuned for recall will surface noise. The shape of the system mirrors the shape of the work.

> **Recall first. Precision second. Never both at once.**

---

## VI — On Garbage In

If your commit history is `wip`, `update`, `fix`, `update again`, then Mneme will tell you so.

It will tell you in the form of empty answers. We do not invent reasons. We surface what was recorded. When nothing was recorded, we surface nothing — and the surface itself is the lesson.

Some teams discover, on first use, that their history says nothing. They thought they had memory; they had only timestamps. The discovery is uncomfortable. It is also valuable: a tool that refuses to lie about your data is more useful than a tool that always answers.

> **A tool that refuses to lie is more useful than a tool that always answers.**

---

## VII — On the Bus Factor

The bus factor is not really about people leaving.

It is about knowledge that never made it into the repository in the first place. The tribal knowledge that lives in someone's head, in a one-on-one Zoom from 2022, in a Slack thread that has rolled out of the search window, in a whiteboard photographed and forgotten.

Mneme cannot save what was never written. No tool can. But it can make legible everything that *was* written — and most teams underestimate how much of that there is, scattered across PRs and issues and old commits.

The first job of memory is preservation. The second job is access. We do the second.

> **What is written can be read. What was never written is gone.**

---

## VIII — On the Palimpsest

A palimpsest is a manuscript scraped clean and written over, again and again.

In the Middle Ages parchment was scarce. Old texts — sometimes priceless ones — were erased so the surface could be reused. Later, scholars learned to read what was underneath: the faint impressions, the ghost of older script, the layers of decision.

Every codebase is a palimpsest. The current file is the surface. Beneath it lies last year's design, and the year before's, and the original 3am hack that started it all. Mneme reads the layers.

> **Every line of code stands on the bones of older lines.**

---

## IX — On Speed

Sub-second answers do not come from a smarter model.

They come from giving the model less to read. When a question takes ten seconds to answer, nine of those seconds are usually noise the assistant was forced to scan. The intelligence was always fast; the input was always slow.

This is why retrieval matters more than reasoning, for most engineering questions. The right context, delivered in a hundred tokens, beats a million tokens of plausible irrelevance every time.

> **Speed is not a smarter model. It is less noise.**

---

## X — On the Most Expensive Bug

The most expensive bug is the one you fix without remembering why it existed.

The patch lands. The tests pass. The original constraint — a peculiar Stripe API behavior, a regulatory requirement, a security disclosure from three quarters ago — is forgotten. Six months later, someone undoes the fix, because in isolation it looks like dead code. The bug returns. Now harder, because nobody remembers it ever was a bug.

Mneme is not a debugger. It is a counterweight to that forgetting. When the next engineer reaches the line that says `try { return Number(amount.toString()); } catch ...`, the question *why is this here* will have an answer, and the answer will be the actual one.

> **A fix without context is a future bug with extra steps.**

---

## XI — On the Honest No

Most retrieval systems are pressured into answering.

A search bar that always returns results — even when nothing in the corpus is relevant — feels responsive. Users like immediate output. The pressure on system designers is to deliver, even when the right delivery is silence.

Mneme tries hard, sometimes harder than feels natural, to say *no relevant context found* when that is the truth. The phrase appears in our outputs deliberately. A retrieval system that cannot say no cannot be trusted to say yes either; if every answer is a hit, no answer is a hit.

> **An honest no is worth a thousand confident maybes.**

---

## XII — On Knowing When Not To Use This

Mneme is not a substitute for reading code.

It is not a substitute for asking a colleague. It is not an oracle. It is a way to compress thirty minutes of git archaeology into thirty seconds — when the answer is in git.

When the answer is not in git, the right move is to close the laptop and walk to a desk. Some questions are answered only by humans, and the recognition that you have hit one of those questions is itself a useful skill — one that a bad retrieval tool will rob you of, by pretending to answer.

> **The tool ends where the conversation begins.**

---

## XIII — On the Convex Combination

A correlation engine that saturates at 1.0 cannot rank anything that scores 1.0.

This sounds like a math joke until you watch it happen in production. We had a temporal correlation that combined two signals, each weighted at 0.5 to 0.6, and clamped the sum into [0, 1]. Two strong signals would both produce weight = 1.0, and the engine would shrug — *they all look maximal to me, you pick*.

The fix was a convex combination: a weighted average that mathematically guarantees the sum stays in bounds without clamping. The numbers stopped saturating. The ranking returned.

Most retrieval failures are math failures wearing the costume of intelligence. Choose your formulas with care; the shape of your math becomes the shape of your answers.

> **Choose your convex combinations. The shape of your math becomes the shape of your answers.**

---

<div align="center">

*Read one a day. Build the codebase your future self will want to inherit.*

```bash
mneme wisdom
```

</div>
