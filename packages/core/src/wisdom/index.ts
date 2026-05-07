/**
 * Wisdom Mutant Engine — public surface.
 *
 * The engine has three appendable artifacts (feedback, calibrations,
 * eval-runs) and three operations on them: collect, calibrate, self-eval.
 *
 * Inspired by AlphaGo Zero's loop — observe, adapt, measure, repeat —
 * minus the reinforcement learning. We are not training a model. We are
 * tuning a small set of search knobs against the user's own feedback
 * over time. The point is the *loop*, not the algorithm.
 */

export * from "./types.js";
export * from "./feedback.js";
export * from "./calibrator.js";
export * from "./session.js";
export * from "./mutant-adapt.js";
