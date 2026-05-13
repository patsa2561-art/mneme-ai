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
