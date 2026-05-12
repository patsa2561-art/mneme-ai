/**
 * v1.81.0 -- SYNAPSE PROTOCOL: universal cross-device brain sync.
 *
 * Three innovations stack:
 *   nexus_code        -- 6-char short code → soul prompt resolution
 *   qr_anchor         -- SVG QR encoder for cross-device payload transfer
 *   token_compression -- deterministic codebook compression for tight
 *                        mobile AI context windows
 *
 * Net effect: user can move their AI conversation from PC → phone →
 * tablet → second laptop without typing long URLs or pasting 1000-token
 * walls of text. Short code or QR scan does it.
 */

export * from "./nexus_code.js";
export * from "./qr_anchor.js";
export * from "./token_compression.js";
