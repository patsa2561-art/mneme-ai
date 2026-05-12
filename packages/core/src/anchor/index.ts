/**
 * v1.88.0 -- ANCHOR PROTOCOL: parent-pole / child-rope architecture.
 *
 *   pole_id            -- parent identity + signed rope tokens for children
 *   clipboard_handoff  -- OS-level clipboard write (Phone Link / Universal
 *                          Clipboard / KDE Connect → phone clipboard)
 *
 * Architecture (user's metaphor): parent = the pole; ropes radiate
 * out to children; as long as a rope is valid + signed by the pole,
 * the child can sync with siblings AND inherit parent upgrades on
 * its next connection. No central server -- the pole's HMAC secret
 * IS the trust root.
 */

export * from "./pole_id.js";
export * from "./clipboard_handoff.js";
