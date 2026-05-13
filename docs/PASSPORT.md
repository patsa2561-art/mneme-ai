# 🛂 MNEME PASSPORT — portable, eternal, you own it

> *"Until today, every AI vendor was the warden of your context. Tomorrow, you hand the AI a passport and the warden disappears."*

A small HMAC-signed JSON bundle (~2-4 KB) that holds your last 50 decisions, regrets, wisdoms, vaccines, and preferences. Carry it across vendors. **Default: never expires** until YOU revoke it. ANY AI agent can READ entries; only the secret-holder (you) can ISSUE / REVOKE.

---

## The vendor lock-in problem

- ChatGPT remembers YOUR conversation history — in OpenAI's cloud.
- Claude.ai remembers — in Anthropic's cloud.
- Gemini remembers — in Google's.
- Switching vendors = losing your memory. **Worth billions.**

## The Mneme Passport inversion

| Operation | Who can do it |
|---|---|
| READ entries | **Anyone** — including the AI you paste it into. The disruption: AI gets your context. |
| WRITE / re-issue / revoke | **Only the secret-holder** (you). Local `.mneme/passport.secret`. |
| VERIFY signature | Anyone with the secret. Tamper-evident HMAC-SHA256. |

5 verdicts: `VALID` · `EXPIRED` · `TAMPERED` · `WRONG_KEY` · `REVOKED`.

---

## API

```typescript
import {
  issuePassport, verifyPassport, revokePassport,
  serializePassport, parsePassport, generatePassportSecret,
} from "@mneme-ai/core";

// One-time setup
const secret = generatePassportSecret(); // persist to .mneme/passport.secret

// Issue — eternal by default (no ttlDays)
const env = issuePassport({
  holder: "alice@mneme",
  entries: [
    { id: "d1", ts: Date.now(), kind: "decision", text: "Postgres native JSONB for v1", scope: "auth-service" },
    { id: "r1", ts: Date.now(), kind: "regret",   text: "JWT 5-min broke prod DST 2024", scope: "commit a3f9b21" },
  ],
  secret,
});

// Paste-friendly serialization
const text = serializePassport(env);            // ~2-4 KB; paste into any AI

// Read on the receiving side (ANY AI can do this — no secret needed)
const parsed = parsePassport(text);             // env.entries available immediately

// Verify (only secret-holder can; others ignore this step)
const r = verifyPassport(env, secret);
// r.verdict: VALID / EXPIRED / TAMPERED / WRONG_KEY / REVOKED

// Revoke when you want (replaces the issued passport)
const revoked = revokePassport(env, env.id, secret);
```

---

## What an AI agent does when it sees a passport

```typescript
import { parsePassport, verifyPassport } from "@mneme-ai/core";

// Detect passport in user's message
if (userMessage.includes("--- MNEME PASSPORT v1 ---")) {
  const env = parsePassport(userMessage);
  if (env) {
    // READ entries — no secret needed
    for (const e of env.entries) {
      console.log(`${e.kind}: ${e.text}`);
    }
    // Use entries as grounding context for the rest of the conversation.
  }
}
```

ANY AI agent — including paste-only Web AIs (Gemini-Free, ChatGPT-Free) — can read the entries the moment the user pastes the bundle. No web-fetch, no decryption, no deep link needed.

---

## Eternal by default + explicit revocation

v1.99 changed the default from "90-day TTL" to **eternal**:

- `issuePassport({holder, entries, secret})` → `expiresAt = Number.MAX_SAFE_INTEGER` (effectively forever).
- `issuePassport({..., ttlDays: 7})` → finite TTL for one-time delegation use cases.
- `revokePassport(env, env.id, secret)` → adds id to revocation list + re-signs.
- `verifyPassport` checks the revocation list first; returns `REVOKED` verdict if hit.

The user is the only authority over their passport's lifecycle.

---

## Why this is the disruption

A vendor that accepts the PASSPORT format signals "we don't lock you in" and wins user trust. A vendor that refuses becomes a wall. The open standard (PASSPORT envelope JSON shape) becomes the lingua franca of AI context. Mneme is the reference implementation + first adopter.

v1.99 is the **seed**. Adoption is community + market work.

---

← [Back to README](../README.md) · [FLASH INTELLIGENCE](FLASH.md) · [AI agent contract](AI_AGENT_CONTRACT.md)
