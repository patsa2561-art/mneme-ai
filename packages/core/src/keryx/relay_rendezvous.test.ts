import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleKeryxRelay } from "../gephyra/index.js";
import { mintPairingCode } from "./rendezvous.js";

describe("RELAY RENDEZVOUS — end-to-end (pair-register → webhook code → link → answer route)", () => {
  it("send a LINE code links the conversation, then a tap from it routes to the daemon", async () => {
    const repo = mkdtempSync(join(tmpdir(), "relay-rdv-"));
    const { code, record } = mintPairingCode("daemonX", "line", { now: Date.now(), secret: "s" });

    // 1) daemon registers the minted record
    const reg = await handleKeryxRelay(repo, "pair-register", { daemonId: "daemonX", record }, {});
    expect(reg.status).toBe(200); expect((reg.body as { registered?: boolean }).registered).toBe(true);

    // 2) user SENDS THE CODE to the LINE bot (real LINE webhook shape) → should LINK
    const lineCodeMsg = JSON.stringify({ events: [{ type: "message", message: { type: "text", text: `link ${code}` }, source: { userId: "Uconv123" } }] });
    const link = await handleKeryxRelay(repo, "webhook", lineCodeMsg, { provider: "line" });
    expect((link.body as { linked?: boolean; daemonId?: string }).linked).toBe(true);
    expect((link.body as { daemonId?: string }).daemonId).toBe("daemonX");

    // 3) drain returns the link to the daemon (so it knows where to push)
    const drain1 = await handleKeryxRelay(repo, "drain", null, { daemon: "daemonX" });
    const links = (drain1.body as { links?: Array<{ provider: string; conversation: string }> }).links ?? [];
    expect(links.some((l) => l.provider === "line" && l.conversation === "Uconv123")).toBe(true);

    // 4) the SAME code can't be replayed (one-time)
    const replay = await handleKeryxRelay(repo, "webhook", lineCodeMsg, { provider: "line" });
    expect((replay.body as { linked?: boolean }).linked).not.toBe(true);

    // 5) a real tap/answer from that conversation routes to daemonX (by link, even without an askId)
    const tapMsg = JSON.stringify({ events: [{ type: "message", message: { type: "text", text: "allow" }, source: { userId: "Uconv123" } }] });
    await handleKeryxRelay(repo, "webhook", tapMsg, { provider: "line" });
    const drain2 = await handleKeryxRelay(repo, "drain", null, { daemon: "daemonX" });
    const answers = (drain2.body as { answers?: Array<{ payload: string; channel: string }> }).answers ?? [];
    expect(answers.some((a) => a.channel === "line" && a.payload === "allow")).toBe(true);
  });

  it("an unknown code links nothing", async () => {
    const repo = mkdtempSync(join(tmpdir(), "relay-rdv2-"));
    const msg = JSON.stringify({ events: [{ message: { text: "MNEME-ZZZZZZ" }, source: { userId: "U9" } }] });
    const r = await handleKeryxRelay(repo, "webhook", msg, { provider: "line" });
    expect((r.body as { linked?: boolean }).linked).not.toBe(true);
  });
});
