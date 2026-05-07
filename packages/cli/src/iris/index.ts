/**
 * Iris — the journalist output engine for Mneme.
 *
 * Named after Iris (Greek messenger between gods and humans) — pairs with
 * Mneme (goddess of memory).  Iris's job: render every command's data so
 * a non-engineer can scan the result in ~30 seconds.
 *
 * Five pillars:
 *   1. Inverted-pyramid auto-renderer (most-important first)
 *   2. AI-summarized headline (LLM with extractive fallback)
 *   3. Visual entity continuity (same commit/author/file render identically)
 *   4. Adaptive verbosity (verbose for newcomers, terse for repeat users)
 *   5. 30-second contract (validator for all rendered output)
 *
 * This module is the public surface — every command imports from here.
 */

export type { PyramidInput, PyramidSection, PyramidTier } from "./pyramid.js";
export { renderPyramid, singleSection, stripAnsi } from "./pyramid.js";

export type {
  HeadlineCommandType,
  HeadlineEnricher,
  HeadlineRequest,
} from "./headline.js";
export {
  HEADLINE_SYSTEM_PROMPT,
  clearHeadlineCache,
  extractiveHeadline,
  generateHeadline,
  sanitizeHeadline,
} from "./headline.js";

export type {
  RenderableCommit,
  RenderAuthorOpts,
  RenderCommitOpts,
  RenderFileOpts,
  RenderHashRefOpts,
} from "./entity.js";
export {
  renderAuthor,
  renderCommit,
  renderFile,
  renderHashRef,
} from "./entity.js";

export type { FlashInput, FlashType } from "./flash.js";
export { flash } from "./flash.js";

export type { IrisState } from "./adaptive.js";
export {
  VERBOSE_GUIDE_THRESHOLD,
  clearIrisState,
  readIrisState,
  recordCommandRun,
  shouldShowVerboseGuide,
  writeIrisState,
} from "./adaptive.js";

export type { ContractResult } from "./contract.js";
export { checkContract } from "./contract.js";

import { renderPyramid, type PyramidInput } from "./pyramid.js";

/** Top-level convenience: alias for `renderPyramid`. */
export const iris = {
  render(input: PyramidInput): string {
    return renderPyramid(input);
  },
};
