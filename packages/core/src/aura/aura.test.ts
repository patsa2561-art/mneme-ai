import { describe, it, expect } from "vitest";

import { encodePairing, decodePairing } from "./pair_payload.js";
import { discoverLanAddresses, buildLanUrl } from "./auto_discovery.js";

const OWNER_KEY_A = "owner-pubkey-hash-aaaaaaaaaaaaaaaaaaaaaaaaa";
const OWNER_KEY_B = "owner-pubkey-hash-bbbbbbbbbbbbbbbbbbbbbbbbb";
const SECRET = "owner-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 1000).toISOString();

describe("v1.83 AURA · pair_payload encode/decode", () => {
  it("encodes a pairing payload to a base64url token", () => {
    const { token } = encodePairing({
      lanUrl: "http://192.168.1.42:7741",
      code: "K7M9X2",
      expiresAt: FUTURE,
      ownerSecret: SECRET,
      ownerPubKeyHash: OWNER_KEY_A,
    });
    expect(token.length).toBeGreaterThan(40);
    expect(token).not.toContain("=");
  });

  it("decodes a fresh payload with the correct owner", () => {
    const { token } = encodePairing({
      lanUrl: "http://192.168.1.42:7741",
      code: "K7M9X2",
      expiresAt: FUTURE,
      ownerSecret: SECRET,
      ownerPubKeyHash: OWNER_KEY_A,
    });
    const result = decodePairing(token, OWNER_KEY_A, SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.lanUrl).toBe("http://192.168.1.42:7741");
      expect(result.payload.code).toBe("K7M9X2");
    }
  });

  it("REJECTS a payload with a different owner (privacy guard)", () => {
    const { token } = encodePairing({
      lanUrl: "http://192.168.1.42:7741",
      code: "K7M9X2",
      expiresAt: FUTURE,
      ownerSecret: SECRET,
      ownerPubKeyHash: OWNER_KEY_A,
    });
    const result = decodePairing(token, OWNER_KEY_B, SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("wrong-owner");
  });

  it("REJECTS a payload with tampered signature", () => {
    const { payload, token } = encodePairing({
      lanUrl: "http://192.168.1.42:7741",
      code: "K7M9X2",
      expiresAt: FUTURE,
      ownerSecret: SECRET,
      ownerPubKeyHash: OWNER_KEY_A,
    });
    void payload;
    // Mutate the token by flipping a char in the body section
    const flipped = token.slice(0, 30) + "X" + token.slice(31);
    const result = decodePairing(flipped, OWNER_KEY_A, SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(["malformed", "wrong-owner", "bad-sig"]).toContain(result.reason);
  });

  it("REJECTS an expired payload", () => {
    const { token } = encodePairing({
      lanUrl: "http://192.168.1.42:7741",
      code: "K7M9X2",
      expiresAt: PAST,
      ownerSecret: SECRET,
      ownerPubKeyHash: OWNER_KEY_A,
    });
    const result = decodePairing(token, OWNER_KEY_A, SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("REJECTS garbage input", () => {
    const result = decodePairing("not-a-real-token", OWNER_KEY_A, SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("malformed");
  });
});

describe("v1.83 AURA · auto_discovery", () => {
  it("discoverLanAddresses returns an array (may be empty on no-LAN hosts)", () => {
    const list = discoverLanAddresses();
    expect(Array.isArray(list)).toBe(true);
    for (const c of list) {
      expect(c.isPrivate).toBe(true);
      expect(c.ipv4).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    }
  });

  it("buildLanUrl returns http URL OR null", () => {
    const u = buildLanUrl();
    if (u !== null) {
      expect(u).toMatch(/^http:\/\/\d+\.\d+\.\d+\.\d+:7741$/);
    }
  });

  it("buildLanUrl respects a custom port", () => {
    const u = buildLanUrl(9000);
    if (u !== null) {
      expect(u).toContain(":9000");
    }
  });
});
