/**
 * Insights — high-level analyses on top of the indexed memory.
 *
 *   who-knows    — surface human experts on a topic
 *   decisions    — auto-extract architectural decisions from commit text
 *   stack-trace  — parse an error and find historical context for each frame
 *   story        — narrate the evolution of a topic across acts
 */

export * from "./who-knows.js";
export * from "./decisions.js";
export * from "./stack-trace.js";
export * from "./story.js";
