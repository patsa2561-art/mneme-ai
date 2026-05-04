/**
 * Meditations — short, quotable teachings about codebase memory.
 *
 * Each meditation has three parts:
 *   - title:  one short phrase (the koan)
 *   - body:   2-4 sentences of context
 *   - aphorism: a single tweetable line (the takeaway)
 *
 * Meditations are addressed by index for `mneme wisdom --n <N>` and selected
 * deterministically by date for `mneme wisdom` (one-per-day rhythm — different
 * teaching each day, same teaching all day).
 */

export interface Meditation {
  id: string;
  title: string;
  body: string;
  aphorism: string;
}

export const MEDITATIONS: Meditation[] = [
  {
    id: "memory-vs-intelligence",
    title: "On Memory and Intelligence",
    body:
      "An intelligence without memory is just guessing in a loop. The Greeks knew this — they made μνήμη the mother of the muses, not their student.\n" +
      "Every AI assistant you use today is a Mnemosyne with amnesia.",
    aphorism: "Intelligence is the spark; memory is the fuel.",
  },
  {
    id: "what-vs-why",
    title: "On What and Why",
    body:
      "A passing test never told anyone why it had to exist. A green check on CI does not explain the bug it was born to prevent.\n" +
      "Source code tells the present. Git tells the past. Most engineering questions are really asking about the past.",
    aphorism: "Code answers what. Git answers why. Hold both.",
  },
  {
    id: "commits-as-gifts",
    title: "On Commits as Gifts",
    body:
      "Every commit message is a letter to the engineer who reads it six months from now. That engineer might be a colleague — and might be you.\n" +
      "The cost of writing a good commit message is two minutes. The cost of decoding a bad one is two hours, multiplied by everyone who ever needs to.",
    aphorism: "A commit message is the cheapest gift you can leave your future self.",
  },
  {
    id: "hallucination",
    title: "On Hallucination",
    body:
      "When an AI assistant cannot see why a piece of code exists, it does not say so. It guesses. The guess sounds plausible because plausibility is what language models optimize.\n" +
      "Hallucination is not a bug in the model. It is the absence of context, dressed up as confidence.",
    aphorism: "An AI without memory is a confident liar by default.",
  },
  {
    id: "two-stage-retrieval",
    title: "On Two-Stage Retrieval",
    body:
      "First-stage search casts a wide net. The right answer is somewhere in the top fifty. Then a reranker takes those fifty and finds the top three.\n" +
      "Recall is not the same as precision. Casting wide and then choosing well beats trying to do both in one shot.",
    aphorism: "Recall first. Precision second. Never both at once.",
  },
  {
    id: "garbage-in",
    title: "On Garbage In",
    body:
      "If your commit history is `wip`, `update`, `fix`, `update again` — Mneme will tell you so, in the form of empty answers.\n" +
      "We do not invent reasons. We surface what was recorded. Some teams discover, on first use, that their history says nothing. That itself is the lesson.",
    aphorism: "A tool that refuses to lie is more useful than a tool that always answers.",
  },
  {
    id: "bus-factor",
    title: "On the Bus Factor",
    body:
      "The bus factor is not really about people leaving. It is about knowledge that never made it into the repository in the first place.\n" +
      "Mneme cannot save what was never written. But it can make legible everything that was — which is more than most teams realize.",
    aphorism: "What is written can be read. What was never written is gone.",
  },
  {
    id: "palimpsest",
    title: "On the Palimpsest",
    body:
      "A palimpsest is a manuscript scraped clean and written over, again and again. Every codebase is one. Each new decision is ink on top of an older decision, on top of an older one still.\n" +
      "Your present file is the surface. Mneme reads every layer beneath.",
    aphorism: "Every line of code stands on the bones of older lines.",
  },
  {
    id: "speed",
    title: "On Speed",
    body:
      "Sub-second answers do not come from a smarter model. They come from giving the model less to read.\n" +
      "When a question takes ten seconds to answer, nine of those seconds are usually noise the assistant was forced to scan.",
    aphorism: "Speed is not a smarter model. It is less noise.",
  },
  {
    id: "expensive-bug",
    title: "On the Most Expensive Bug",
    body:
      "The most expensive bug is the one you fix without remembering why it existed. The patch lands. The original constraint is forgotten. Six months later, someone undoes the fix because it looks like dead code, and the bug returns — now harder, because nobody remembers it ever was a bug.\n" +
      "Mneme is not a debugger. It is a counterweight to that forgetting.",
    aphorism: "A fix without context is a future bug with extra steps.",
  },
  {
    id: "honest-no",
    title: "On the Honest No",
    body:
      "Most retrieval systems are pressured into answering. Even when they shouldn't. Even when the right answer is silence.\n" +
      "Mneme tries hard to say `no relevant context found` when that is the truth. A tool that admits its limits is one you can trust at its claims.",
    aphorism: "An honest no is worth a thousand confident maybes.",
  },
  {
    id: "knowing-when-not",
    title: "On Knowing When Not To Use This",
    body:
      "Mneme is not a substitute for reading code. It is not a substitute for asking a colleague. It is not an oracle.\n" +
      "It is a way to compress thirty minutes of git archaeology into thirty seconds — when the answer is in git. When it is not, the right move is to close the laptop and walk to a desk.",
    aphorism: "The tool ends where the conversation begins.",
  },
  {
    id: "convex-combination",
    title: "On the Convex Combination",
    body:
      "A correlation engine that saturates at 1.0 cannot rank anything that scores 1.0. The math forces a choice — keep the constraint, lose the signal, or weight the inputs so the sum stays in bounds.\n" +
      "Most retrieval failures are math failures wearing the costume of intelligence.",
    aphorism: "Choose your convex combinations. The shape of your math becomes the shape of your answers.",
  },
];

/** Pick a meditation deterministically — same teaching all day, new one tomorrow. */
export function meditationOfTheDay(now: Date = new Date()): Meditation {
  // Days since unix epoch (UTC) → stable index regardless of timezone.
  const day = Math.floor(now.getTime() / (24 * 60 * 60 * 1000));
  return MEDITATIONS[day % MEDITATIONS.length]!;
}

export function meditationByIndex(n: number): Meditation | undefined {
  if (!Number.isFinite(n) || n < 1 || n > MEDITATIONS.length) return undefined;
  return MEDITATIONS[n - 1];
}

export function meditationById(id: string): Meditation | undefined {
  return MEDITATIONS.find((m) => m.id === id);
}
