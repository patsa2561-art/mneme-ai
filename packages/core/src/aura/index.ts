/**
 * v1.83.0 -- AURA: same-WiFi auto-discovery + owner-only pairing.
 *
 * pair_payload    -- signed bundle (lanUrl + NEXUS code + expiry + owner)
 * auto_discovery  -- list LAN IPv4 candidates without broadcasting
 *
 * Privacy property: nothing leaves the source machine until the user
 * explicitly shares the pairing payload (QR / NEXUS code). Office WiFi
 * neighbours never learn anything about Mneme.
 */

export * from "./pair_payload.js";
export * from "./auto_discovery.js";
