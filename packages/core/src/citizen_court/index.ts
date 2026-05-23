/**
 * v2.33.0 — CITIZEN COURT (Mneme Confessional, public participatory variant).
 *
 * The AI Honesty Citizen Court. Local-first user-judgment ledger that
 * powers per-vendor Honesty Score Cards (HSC). Optional MNEMNET
 * federation aggregates across consenting nodes for the Public
 * Honesty Court. Distinct from the v2.19 ARENA-audit confessional —
 * this is HCI/participatory, that one is vendor-diff orchestration.
 */

export type {
  CourtVerdict, HonestyScoreCard, CourtRevealInput, CourtReveal, VoteInput,
} from "./types.js";

export {
  recordRevealAndWait, vote, listVerdicts, listPending, verifyVerdict,
  __resetConfessionalChainForTest,
} from "./court.js";

export { computeHsc, readHsc } from "./hsc.js";
