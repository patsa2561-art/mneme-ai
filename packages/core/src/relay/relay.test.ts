import { describe, it, expect } from "vitest";

import { uploadToDpaste, uploadToPasteRs, uploadToZeroXZero, uploadWithFallback } from "./paste_backend.js";
import { encryptWithCode, decryptWithCode } from "./encrypted_payload.js";
import { renderMobileRecipe } from "./mobile_recipe.js";

function mockFetch(status: number, body: string): typeof fetch {
  return (async (): Promise<Response> => new Response(body, { status })) as unknown as typeof fetch;
}

describe("v1.85 RELAY · paste backends (mocked)", () => {
  it("dpaste upload returns URL on 200", async () => {
    const r = await uploadToDpaste({ content: "soul", fetchImpl: mockFetch(200, "https://dpaste.com/AB12CD") });
    expect(r.ok).toBe(true);
    expect(r.url).toContain("dpaste.com");
    expect(r.backend).toBe("dpaste");
  });

  it("dpaste failure returns ok=false with reason", async () => {
    const r = await uploadToDpaste({ content: "soul", fetchImpl: mockFetch(500, "internal error") });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("500");
  });

  it("paste.rs upload returns URL on 200", async () => {
    const r = await uploadToPasteRs({ content: "soul", fetchImpl: mockFetch(200, "https://paste.rs/aBcD") });
    expect(r.ok).toBe(true);
    expect(r.url).toBe("https://paste.rs/aBcD");
    expect(r.backend).toBe("pasters");
  });

  it("0x0.st upload returns URL on 200", async () => {
    const r = await uploadToZeroXZero({ content: "soul", fetchImpl: mockFetch(200, "https://0x0.st/abcd.txt") });
    expect(r.ok).toBe(true);
    expect(r.url).toContain("0x0.st");
  });

  it("uploadWithFallback tries each backend in order", async () => {
    // First backend fails, second succeeds.
    let attempt = 0;
    const fetchImpl = (async (): Promise<Response> => {
      attempt += 1;
      if (attempt === 1) return new Response("rate-limit", { status: 429 });
      return new Response("https://paste.rs/AB", { status: 200 });
    }) as unknown as typeof fetch;
    const r = await uploadWithFallback({ content: "soul", fetchImpl }, ["dpaste", "pasters"]);
    expect(r.ok).toBe(true);
    expect(r.backend).toBe("pasters");
  });

  it("uploadWithFallback returns combined errors when all fail", async () => {
    const r = await uploadWithFallback(
      { content: "soul", fetchImpl: mockFetch(500, "err") },
      ["dpaste", "pasters"],
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("all backends failed");
    expect(r.reason).toContain("dpaste");
    expect(r.reason).toContain("pasters");
  });
});

describe("v1.85 RELAY · encrypted payload", () => {
  it("encrypt + decrypt round-trip recovers the plaintext", () => {
    const env = encryptWithCode("# SOUL\nbody body body", "K7M9X2");
    const r = decryptWithCode(env.text, "K7M9X2");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plaintext).toBe("# SOUL\nbody body body");
  });

  it("wrong code fails decryption (auth tag mismatch)", () => {
    const env = encryptWithCode("secret", "K7M9X2");
    const r = decryptWithCode(env.text, "WRONGC");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("wrong-code-or-tampered");
  });

  it("garbage envelope returns not-envelope", () => {
    const r = decryptWithCode("not a real envelope", "ANY123");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not-envelope");
  });

  it("tampered ciphertext is detected by auth tag", () => {
    const env = encryptWithCode("secret", "K7M9X2");
    // Mutate one char in the base64url body
    const head = env.text.slice(0, 30);
    const tail = env.text.slice(31);
    const tampered = head + (env.text[30] === "A" ? "B" : "A") + tail;
    const r = decryptWithCode(tampered, "K7M9X2");
    expect(r.ok).toBe(false);
  });

  it("envelope header is stable across encryptions", () => {
    const a = encryptWithCode("x", "AAA111");
    const b = encryptWithCode("x", "AAA111");
    // Same prefix, different bodies (random salt+iv).
    expect(a.text.split("\n")[0]).toBe(b.text.split("\n")[0]);
    expect(a.text).not.toBe(b.text);
  });

  it("algorithm metadata is exposed for audit", () => {
    const env = encryptWithCode("x", "Y");
    expect(env.algorithm).toBe("aes-256-gcm");
    expect(env.iterations).toBe(200_000);
  });
});

describe("v1.85 RELAY · mobile recipe", () => {
  it("renderMobileRecipe produces a one-line mobile prompt + 3 instructions", () => {
    const r = renderMobileRecipe("https://paste.rs/aB", "K7M9X2");
    expect(r.url).toBe("https://paste.rs/aB");
    expect(r.code).toBe("K7M9X2");
    expect(r.mobilePrompt).toContain("Fetch the URL https://paste.rs/aB");
    expect(r.mobilePrompt).toContain("K7M9X2");
    expect(r.qrPayload).toBe("mneme:K7M9X2|https://paste.rs/aB");
    expect(r.instructions.mobileAiApp).toContain("Claude / Gemini / ChatGPT");
    expect(r.instructions.mnemeAwareEditor).toContain("mneme.synapse.resolve_code");
    expect(r.instructions.webAi).toContain("chatgpt.com / gemini.google.com");
  });
});
