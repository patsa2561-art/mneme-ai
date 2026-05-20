/**
 * ViewExplainer -- always-visible plain-English strip under the header
 * that tells the user, in 1 sentence + 3 bullets, what the active menu
 * actually IS and what they can do with it.
 *
 * The user's complaint in v1.26.1 review: "atrophy/nervous system/ ...
 * ควรบอก user ด้วยภาษาบ้านๆ เข้าใจง่ายสุดๆ ใน 1 นาทีว่าแต่ละ menu คืออะไร".
 * This component is the answer.
 */

import type { ViewMode } from "../types";

interface Explainer {
  title: string;       // human-readable view name
  oneLine: string;     // 1-sentence "what is this"
  whyCare: string;     // 1-line "why you should care"
  bullets: string[];   // 2-3 things you can do here
}

const EXPLAINERS: Record<ViewMode, Explainer> = {
  demon: {
    title: "Demon Stack",
    oneLine: "World's first PREVENT-BEFORE MCP layer. Type a claim, see what Mneme would let through to the user.",
    whyCare: "Every other MCP tool DETECTS hallucination after the fact. Mneme INTERCEPTS it before delivery — AI is structurally unable to lie through Mneme.",
    bullets: [
      "Live PRECOG firewall — type any AI claim, watch un-verifiable spans get hedged with named cause.",
      "All 6 protocols (PRECOG / APOPTOSIS / AEGIS / AUTARCHY / HYPERSCAN / ASCENSION) explained with bench numbers.",
      "World-position table: what no other MCP server does (4 mixed regex algos / shell-out to git / HMAC trust cert).",
    ],
  },
  graph: {
    title: "Nervous System",
    oneLine: "A live map of who knows what in your codebase.",
    whyCare: "When someone leaves, this is the picture of the knowledge you'll lose.",
    bullets: [
      "Each circle is a person; thicker links mean they share more files.",
      "Click anyone to see exactly which files they own.",
      "Drag the timeline to watch the team grow / shrink over the months.",
    ],
  },
  atrophy: {
    title: "Atrophy",
    oneLine: "Files where the original author is gone or hasn't touched the code in a long time.",
    whyCare: "These are the files where 'why is this here?' goes unanswered. Mneme spots them before they hurt you.",
    bullets: [
      "Red cells = high atrophy (knowledge has decayed).",
      "Click a row to see who used to own it.",
      "Use this to plan documentation or hand-off.",
    ],
  },
  influence: {
    title: "Influence",
    oneLine: "Who actually moves the codebase, ranked by code that's still alive in HEAD.",
    whyCare: "Commit-count rankings lie (many small commits ≠ much impact). This ranks by surviving lines.",
    bullets: [
      "Top of the ladder = highest cultural impact right now.",
      "Click an author for their full file footprint + atrophy.",
      "Useful for review-routing and 'who do I ask about X?'",
    ],
  },
  ecosystems: {
    title: "Ecosystems (Dynamic MCP)",
    oneLine: "Which frameworks/libraries your repo uses — and the MCP tools Mneme spawns for each.",
    whyCare: "Other MCP servers ship the same tools to every repo. Mneme reshapes itself to YOUR repo's stack.",
    bullets: [
      "Detection signals = npm/python deps + import statements + file patterns (3-way triangulation).",
      "Each ecosystem unlocks tools tailored to it (e.g. Stripe → PCI-PII auditor; React → hook-rules linter).",
      "Auto-on at startup. No config needed.",
    ],
  },
  dna: {
    title: "Code Search (DNA)",
    oneLine: "Search code by meaning, not keywords.",
    whyCare: "Grep finds words. DNA finds intent — even when the words don't match what you typed.",
    bullets: [
      "16-strand search engine (semantic + syntactic + structural + temporal + ...).",
      "Strict-mode 'Ghost-Sniper Verifier' filters out hallucinated matches.",
      "Click a match to see the full file in context.",
    ],
  },
  scrubber: {
    title: "Scrubber",
    oneLine: "Live prompt-injection defence. Paste any hostile text, watch Mneme strip the attack.",
    whyCare: "Public AI tools blindly forward user-supplied text to your model. This shows what gets through.",
    bullets: [
      "Try prompt-injection payloads from the wild — Mneme normalizes them.",
      "Detection categories: tag-confusion, URL exfil, role-override, jailbreak.",
      "All scrubbing runs in your browser — nothing leaves the page.",
    ],
  },
  antivirus: {
    title: "Antivirus Lab",
    oneLine: "The world's first MCP server with an antiviral against AI hallucination.",
    whyCare: "Catches AI-suggested code that references functions, files, packages, or commits that don't exist — BEFORE they merge.",
    bullets: [
      "Strain Atlas: 8 catalogued hallucination types (phantom commit, ghost function, fake npm package, ...).",
      "Pharmacopoeia: HMAC-signed vaccines with measured efficacy (precision/recall/F1).",
      "Run `mneme antivirus scan <draft>` to scan any AI output.",
    ],
  },
  retrieval: {
    title: "Retrieval Lab",
    oneLine: "Self-tuning RAG. Mneme tries multiple search configs and picks the best one for your repo's questions.",
    whyCare: "Most RAG systems pick one config and freeze it. This one keeps learning.",
    bullets: [
      "8 candidate arms (different embedder × reranker × HyDE × RRF k × weight combos).",
      "UCB1 multi-armed bandit picks which to try next based on regret.",
      "Pareto-frontier view shows quality-vs-latency trade-offs.",
    ],
  },
  polygraph: {
    title: "AI Polygraph (IDEA #1)",
    oneLine: "Live truth-meter overlay for every AI response — green / yellow / red dot per sentence as the verifier streams.",
    whyCare: "Every LLM hallucinates. The browser extension lands soon; this in-page demo previews the experience using the production `mneme verify` engine under the hood.",
    bullets: [
      "Pick a canned prompt or type your own — the demo streams a verified response sentence-by-sentence.",
      "Real engine: `mneme verify '<claim>'` (CLI) + `mneme.verify` (MCP tool).  Same code path as the upcoming extension.",
      "Refuted sentences show the contradicting evidence (file:line / spec / git history) — citations, not opinions.",
    ],
  },
};

interface Props {
  view: ViewMode;
  /** When true, prepend a big "DEMO DATA" banner (synthetic seed). */
  synthetic?: boolean;
  /** When true, prepend a "LIVE" badge with the source label. */
  liveMode?: boolean;
  liveSource?: string;
  /** Optional per-view list of new features (v1.26+) to advertise. */
  callouts?: string[];
}

export function ViewExplainer({ view, synthetic, liveMode, liveSource, callouts }: Props) {
  const e = EXPLAINERS[view];
  if (!e) return null;

  return (
    <section className="view-explainer" aria-label={`What is ${e.title}`}>
      <div className="view-explainer-row">
        <div className="view-explainer-titles">
          <h2 className="view-explainer-title">{e.title}</h2>
          <div className="view-explainer-mode">
            {synthetic && (
              <span className="data-mode demo" title="This is seed/synthetic data, NOT your repo. Drop your own to see real numbers.">
                ◉ DEMO DATA — not your repo
              </span>
            )}
            {!synthetic && liveMode && (
              <span className="data-mode live" title={`Pulled in-browser from ${liveSource ?? "git"} REST API. File-level expertise + atrophy heatmap require the local CLI.`}>
                ● LIVE · {liveSource ?? "git"} API
              </span>
            )}
            {!synthetic && !liveMode && (
              <span className="data-mode loaded">
                ● Loaded data
              </span>
            )}
          </div>
        </div>
      </div>

      <p className="view-explainer-oneline">{e.oneLine}</p>
      <p className="view-explainer-whycare"><strong>Why care:</strong> {e.whyCare}</p>

      <ul className="view-explainer-bullets">
        {e.bullets.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>

      {callouts && callouts.length > 0 && (
        <div className="view-explainer-callouts" aria-label="What's new in this view">
          <span className="view-explainer-callouts-label">NEW:</span>
          <ul>
            {callouts.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
