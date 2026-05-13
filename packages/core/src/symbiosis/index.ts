/**
 * v2.4.0 -- SYMBIOSIS · master facade.
 *
 *   "Mneme should be a close friend to every AI model — not just a tool
 *    the AI calls, but a co-thinker that speaks the AI's own voice."
 *
 * Four cooperating layers:
 *   VOICE    per-vendor verbosity / hedging / code-ratio / structure / formality
 *   INTENT   shape an intent string the way the vendor prefers to read it
 *   LEDGER   record which intents actually succeeded per vendor (Wilson LB)
 *   FUSION   single paste-able bundle (voice + intents + lexicon + sha digest)
 *
 * SYMBIOSIS composes the four into one call: fuseWithVendor({vendor, intents}).
 * The returned bundle is byte-stable for the same input (deterministic
 * digest), so callers can cache it across turns.
 *
 * Pure functions. The optional ledger is the only mutable surface, and
 * persistence is the caller's responsibility (so the daemon decides
 * where to keep the JSONL).
 */

export * from "./voice.js";
export * from "./intent.js";
export * from "./ledger.js";
export * from "./fusion.js";
