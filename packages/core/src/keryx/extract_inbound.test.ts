import { describe, it, expect } from "vitest";
import { extractInbound } from "./index.js";

describe("extractInbound — text + conversation per provider (every shape)", () => {
  it("LINE: userId source + message text", () => {
    const r = extractInbound("line", { events: [{ message: { text: "hi" }, source: { userId: "U123" } }] });
    expect(r).toEqual({ text: "hi", conversation: "U123" });
  });
  it("LINE: group + room sources", () => {
    expect(extractInbound("line", { events: [{ message: { text: "g" }, source: { groupId: "G1" } }] }).conversation).toBe("G1");
    expect(extractInbound("line", { events: [{ message: { text: "r" }, source: { roomId: "R1" } }] }).conversation).toBe("R1");
  });
  it("Slack: event.user + event.text", () => {
    const r = extractInbound("slack", { event: { user: "Uslack", text: "yo" } });
    expect(r.text).toBe("yo"); expect(r.conversation).toBe("Uslack");
  });
  it("Slack: top-level text + channel fallback", () => {
    const r = extractInbound("slack", { text: "t", channel_id: "C9" });
    expect(r.text).toBe("t"); expect(r.conversation).toBe("C9");
  });
  it("Discord: member.user.id + content", () => {
    const r = extractInbound("discord", { content: "cmd", member: { user: { id: "D1" } } });
    expect(r.text).toBe("cmd"); expect(r.conversation).toBe("D1");
  });
  it("Discord: author.id + channel_id fallbacks", () => {
    expect(extractInbound("discord", { content: "x", author: { id: "A1" } }).conversation).toBe("A1");
    expect(extractInbound("discord", { content: "x", channel_id: "CH1" }).conversation).toBe("CH1");
  });
  it("WhatsApp: nested entry→changes→value→messages[0] from + text.body", () => {
    const body = { entry: [{ changes: [{ value: { messages: [{ from: "66999", text: { body: "ok" } }] } }] }] };
    const r = extractInbound("whatsapp", body);
    expect(r.text).toBe("ok"); expect(r.conversation).toBe("66999");
  });
  it("Telegram: message.chat.id + message.text", () => {
    const r = extractInbound("telegram", { message: { text: "hello", chat: { id: 42 }, from: { id: 7 } } });
    expect(r.text).toBe("hello"); expect(r.conversation).toBe("42");
  });
  it("generic fallback: text + from/user", () => {
    expect(extractInbound("whatever", { text: "g", from: "F1" })).toEqual({ text: "g", conversation: "F1" });
  });
  it("accepts a raw JSON string body", () => {
    const r = extractInbound("line", JSON.stringify({ events: [{ message: { text: "s" }, source: { userId: "U" } }] }));
    expect(r.text).toBe("s"); expect(r.conversation).toBe("U");
  });
  it("total — null / malformed / empty never throw, return nulls", () => {
    expect(() => extractInbound("line", null)).not.toThrow();
    expect(extractInbound("line", {}).conversation).toBeNull();
    expect(extractInbound("whatsapp", { entry: [] }).text).toBeNull();
    expect(extractInbound(null as never, "not json")).toBeTruthy();
  });
});
