/**
 * v1.89.0 -- RAINBOW PROTOCOL: multi-channel cross-device handoff.
 *
 * Live channels (work without ANY install + ANY account):
 *   🅰 LAN HTTP server      same WiFi, 1-tap
 *   🅱 data: URL bridge     ANY network, 1-tap (HTML lives in QR)
 *   🅲 dpaste raw           always works, 4-tap fallback
 *
 * Roadmap channels (v1.90 opt-in):
 *   🔊 ggwave audio         zero-network, sound-based
 *   🔗 cloudflared tunnel   public HTTPS, one-time install
 *   📡 WebRTC P2P           browser-native peer-to-peer
 */

export * from "./handoff.js";
export * from "./tunnel.js";
export * from "./multi_paste.js";
export * from "./resource_hints.js";
export * from "./page_renderer.js";
export * from "./same_shell.js";
export * from "./phoenix.js";
export * from "./boomerang.js";
// v1.97 — clone_to: universal Thai+English+mixed intent parser →
// transport plan → auto-open browser. The ONE function AI agents call
// when user says ANY phrase about sending/cloning/syncing brain.
export * from "./clone_to.js";
// v1.97 — bug_truth: honest postmortem on v1.85 RELAY (4 bugs the user
// caught us in). Replacement is clone_to.cloneTo with clipboard transport.
export * from "./bug_truth.js";
