/**
 * v1.86.0 -- CHAMELEON: environment-adaptive transport selection.
 *
 *   env_probe         -- detect git/CI/CODEOWNERS/ownership without any
 *                        external API calls
 *   spore_gate        -- explicit opt-in for spore git push (default OFF)
 *   transport_select  -- pick the safest transport for the destination
 *
 * Net effect: Mneme adapts to the user's repo context instead of
 * blindly auto-enabling git push. No more surprise PRs, no more
 * accidental CI runs, no more "wait, why did Mneme push to my fork?"
 */

export * from "./env_probe.js";
export * from "./spore_gate.js";
export * from "./transport_select.js";
