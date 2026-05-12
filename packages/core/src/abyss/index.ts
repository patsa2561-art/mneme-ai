/**
 * v1.76.0 -- ABYSS PROTOCOL: final-boss minions.
 *
 * - SCYTHE: capsule TTL + auto-prune. Stops `.mneme/capsules/` from
 *   growing forever; nightly daemon job clears them.
 * - REVENANT: soul prompt archive. Every soul prompt is replayable
 *   by id; mark-as-used closes the cross-vendor loop.
 * - HOMUNCULUS: receiver-write-back contract. Foreign AI returns its
 *   own soul prompt at session end → ingested into local genome.
 */

export * from "./scythe.js";
export * from "./revenant.js";
export * from "./homunculus.js";
