import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { renderSameShellPage } from "./same_shell.js";
import {
  createPhoenix,
  renderPhoenixSubscriberScript,
  formatUrlChangeSseFrame,
  type TunnelProbeResult,
} from "./phoenix.js";
import {
  openBoomerangInbox,
  handleReturnPost,
  formatPulseLine,
} from "./boomerang.js";

function freshInboxPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "mneme-boomerang-"));
  return join(dir, "homunculus-return.jsonl");
}

const VALID_RETURN = `
some preamble text from the Web AI

# HOMUNCULUS RETURN
originator: claude-opus-4-7
returning_from: gemini-2.5-pro
decisions: |
  - Use Postgres for v1
  - Skip Redis for now
reasoning: |
  - Postgres native JSONB handles the schema-less case
next_actions: |
  - bench typeorm vs prisma
  - settle on one ORM by Friday
`.trim();

// ============================== SAME-SHELL ==================================

describe("v1.92 RAINBOW · SAME-SHELL same-machine page", () => {
  it("emits a complete HTML document", () => {
    const html = renderSameShellPage({ soulText: "# SOUL\nbody", port: 7741 });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
    expect(html).toContain("Clone to another AI on this PC");
  });

  it("auto-copies soul to clipboard on load (no user click required)", () => {
    const html = renderSameShellPage({ soulText: "x", port: 7741 });
    // copySoul(false) called from top-level script -> auto-copy on load
    expect(html).toContain("copySoul(false)");
    expect(html).toContain("navigator.clipboard");
  });

  it("includes the full TH+EN capability matrix (paste-only truth)", () => {
    const html = renderSameShellPage({ soulText: "x", port: 7741 });
    // EN side
    expect(html).toContain("On a train, only have your phone");
    expect(html).toContain("Switch models for a second opinion");
    expect(html).toContain("Backup the whole conversation");
    expect(html).toContain("Call Mneme tools");
    expect(html).toContain("Modify your code");
    // TH side
    expect(html).toContain("อยู่บนรถไฟ มีแค่มือถือ");
    expect(html).toContain("Backup บทสนทนา");
    expect(html).toContain("เรียก Mneme tools");
    expect(html).toContain("แก้ code ของคุณ");
  });

  it("includes 4 AI deep-links that also re-copy clipboard on click", () => {
    const html = renderSameShellPage({ soulText: "x", port: 7741 });
    expect(html).toContain("chatgpt.com");
    expect(html).toContain("gemini.google.com");
    expect(html).toContain("claude.ai");
    expect(html).toContain("perplexity.ai");
    // Click handlers re-copy to defend against tab-switch clipboard wipe
    expect(html).toContain('document.getElementById("lk-cg").addEventListener("click"');
  });

  it("XSS-safe: </script> in soul is escaped", () => {
    const html = renderSameShellPage({ soulText: 'evil </script><img onerror=1>', port: 7741 });
    expect(html).toContain("<\\/script>");
    const start = html.indexOf("const SOUL = ");
    const end = html.indexOf(";", start);
    expect(html.slice(start, end)).not.toContain("</script>");
  });

  it("includes BOOMERANG return-pad when returnEndpoint is provided", () => {
    const html = renderSameShellPage({ soulText: "x", port: 7741, returnEndpoint: "http://localhost:7741/return" });
    expect(html).toContain("🪃 BOOMERANG");
    expect(html).toContain("textarea");
    expect(html).toContain('id="rp"');
    expect(html).toContain('id="rb"');
    expect(html).toContain("/return");
    // Submit handler does POST with body
    expect(html).toContain('method: "POST"');
  });

  it("omits BOOMERANG return-pad when returnEndpoint absent", () => {
    const html = renderSameShellPage({ soulText: "x", port: 7741 });
    expect(html).not.toContain("🪃 BOOMERANG");
    expect(html).not.toContain('id="rp"');
  });

  it("footer states 'no QR / no tunnel / no network' truth", () => {
    const html = renderSameShellPage({ soulText: "x", port: 7741 });
    expect(html).toContain("no QR, no tunnel, no network needed");
    expect(html).toContain("ไม่ต้องใช้ QR / tunnel / network");
  });
});

// ============================== PHOENIX =====================================

describe("v1.92 RAINBOW · PHOENIX tunnel watchdog", () => {
  function probeFnSeq(seq: Array<{ ok: boolean; status: number | null; reason?: string }>): (url: string) => Promise<TunnelProbeResult> {
    let i = 0;
    return async (url: string): Promise<TunnelProbeResult> => {
      const r = seq[Math.min(i, seq.length - 1)]!;
      i++;
      return { url, ok: r.ok, status: r.status, elapsedMs: 0, reason: r.reason };
    };
  }

  it("getUrl returns initial URL", () => {
    const h = createPhoenix({
      initialUrl: "https://a.trycloudflare.com",
      probeIntervalMs: 9_999_999,
      probeFn: probeFnSeq([{ ok: true, status: 200 }]),
      respawnFn: async () => null,
    });
    expect(h.getUrl()).toBe("https://a.trycloudflare.com");
    h.stop();
  });

  it("respawns + fires onUrlChange after N consecutive failures", async () => {
    let respawnCount = 0;
    const events: Array<[string, string]> = [];
    const h = createPhoenix({
      initialUrl: "https://dead.trycloudflare.com",
      probeIntervalMs: 5,
      failuresBeforeRespawn: 2,
      probeFn: probeFnSeq([
        { ok: false, status: 404, reason: "tunnel edge returned 404" },
        { ok: false, status: 404, reason: "tunnel edge returned 404" },
        { ok: true, status: 200 },
        { ok: true, status: 200 },
      ]),
      respawnFn: async () => {
        respawnCount++;
        return "https://alive.trycloudflare.com";
      },
    });
    h.onUrlChange((n, o) => events.push([o, n]));
    // Wait for two probe failures + respawn.
    await new Promise((res) => setTimeout(res, 200));
    h.stop();
    expect(respawnCount).toBeGreaterThanOrEqual(1);
    expect(h.getUrl()).toBe("https://alive.trycloudflare.com");
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]![0]).toBe("https://dead.trycloudflare.com");
    expect(events[0]![1]).toBe("https://alive.trycloudflare.com");
  });

  it("does not respawn on single transient failure", async () => {
    let respawnCount = 0;
    const h = createPhoenix({
      initialUrl: "https://x.trycloudflare.com",
      probeIntervalMs: 5,
      failuresBeforeRespawn: 3,
      probeFn: probeFnSeq([
        { ok: false, status: 404 },
        { ok: true, status: 200 },
        { ok: true, status: 200 },
        { ok: true, status: 200 },
      ]),
      respawnFn: async () => { respawnCount++; return "x"; },
    });
    await new Promise((res) => setTimeout(res, 80));
    h.stop();
    expect(respawnCount).toBe(0);
  });

  it("history records every probe + respawn", async () => {
    const h = createPhoenix({
      initialUrl: "https://q.trycloudflare.com",
      probeIntervalMs: 5,
      failuresBeforeRespawn: 1,
      probeFn: probeFnSeq([
        { ok: false, status: 404, reason: "edge 404" },
        { ok: true, status: 200 },
      ]),
      respawnFn: async () => "https://r.trycloudflare.com",
    });
    await new Promise((res) => setTimeout(res, 80));
    h.stop();
    const hist = h.getHistory();
    expect(hist.length).toBeGreaterThanOrEqual(2);
    expect(hist.some((e) => e.kind === "probe")).toBe(true);
    expect(hist.some((e) => e.kind === "respawn")).toBe(true);
  });

  it("renderPhoenixSubscriberScript emits an EventSource subscription IIFE", () => {
    const s = renderPhoenixSubscriberScript({ eventsUrl: "/events", qrImgId: "qr", urlTextId: "url" });
    expect(s).toContain("EventSource");
    expect(s).toContain('"/events"');
    expect(s).toContain('"qr"');
    expect(s).toContain('"url"');
    expect(s).toContain("url-change");
    expect(s).toContain("api.qrserver.com");
  });

  it("formatUrlChangeSseFrame returns valid SSE wire format", () => {
    const f = formatUrlChangeSseFrame("https://new.trycloudflare.com");
    expect(f).toBe("event: url-change\ndata: https://new.trycloudflare.com\n\n");
  });

  it("formatUrlChangeSseFrame strips newlines from input (defensive)", () => {
    const f = formatUrlChangeSseFrame("https://x.com\ninjected\nstuff");
    expect(f).not.toContain("\ninjected");
    expect(f).toContain("https://x.cominjectedstuff");
  });
});

// ============================== BOOMERANG ===================================

describe("v1.92 RAINBOW · BOOMERANG return-pad inbox", () => {
  it("ingests a valid HOMUNCULUS RETURN block + writes one JSONL line", () => {
    const path = freshInboxPath();
    const inbox = openBoomerangInbox(path);
    const r = inbox.ingest({ raw: VALID_RETURN, source: "same-shell" });
    expect(r.ok).toBe(true);
    expect(r.id).toMatch(/^[0-9a-f]{12}$/);
    expect(r.parsed?.decisions.length).toBe(2);
    expect(r.parsed?.nextActions.length).toBe(2);
    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines.length).toBe(1);
    const entry = JSON.parse(lines[0]!);
    expect(entry.id).toBe(r.id);
    expect(entry.source).toBe("same-shell");
    expect(entry.ingested).toBe(false);
    expect(entry.parsed.originator).toBe("claude-opus-4-7");
  });

  it("rejects body without HOMUNCULUS RETURN block", () => {
    const inbox = openBoomerangInbox(freshInboxPath());
    const r = inbox.ingest({ raw: "just a normal AI reply, no return block here" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("HOMUNCULUS RETURN block");
  });

  it("rejects empty body", () => {
    const inbox = openBoomerangInbox(freshInboxPath());
    const r = inbox.ingest({ raw: "" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("empty");
  });

  it("rejects body over 256KB", () => {
    const inbox = openBoomerangInbox(freshInboxPath());
    const huge = "x".repeat(300 * 1024);
    const r = inbox.ingest({ raw: huge });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("too large");
  });

  it("dedup: same body twice -> same id, single line in file", () => {
    const path = freshInboxPath();
    const inbox = openBoomerangInbox(path);
    const r1 = inbox.ingest({ raw: VALID_RETURN, source: "same-shell" });
    const r2 = inbox.ingest({ raw: VALID_RETURN, source: "tunnel" });
    expect(r1.id).toBe(r2.id);
    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines.length).toBe(1);
  });

  it("pending() returns un-ingested entries; markIngested moves them", () => {
    const path = freshInboxPath();
    const inbox = openBoomerangInbox(path);
    const a = inbox.ingest({ raw: VALID_RETURN }).id;
    expect(inbox.pending().length).toBe(1);
    const moved = inbox.markIngested([a], "applied via mneme.abyss.homunculus.ingest");
    expect(moved).toBe(1);
    expect(inbox.pending().length).toBe(0);
    const all = inbox.list();
    expect(all[0]!.ingested).toBe(true);
    expect(all[0]!.ingestNote).toContain("applied");
    // Second mark is idempotent.
    expect(inbox.markIngested([a])).toBe(0);
  });

  it("handleReturnPost returns 200 + {ok,id} on valid body", () => {
    const inbox = openBoomerangInbox(freshInboxPath());
    const r = handleReturnPost({ inbox, body: VALID_RETURN, source: "same-shell" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.id).toMatch(/^[0-9a-f]{12}$/);
  });

  it("handleReturnPost returns 400 + {ok:false,error} on garbage", () => {
    const inbox = openBoomerangInbox(freshInboxPath());
    const r = handleReturnPost({ inbox, body: "not a return block", source: "same-shell" });
    expect(r.status).toBe(400);
    expect(r.body.ok).toBe(false);
    expect(r.body.error).toBeTruthy();
  });

  it("formatPulseLine produces compact one-line summary", () => {
    const inbox = openBoomerangInbox(freshInboxPath());
    const r = inbox.ingest({ raw: VALID_RETURN });
    const entry = inbox.list()[0]!;
    const line = formatPulseLine(entry);
    expect(line).toContain("[BOOMERANG");
    expect(line).toContain(r.id);
    expect(line).toContain("gemini-2.5-pro");
    expect(line).toContain("d:2"); // 2 decisions
    expect(line).toContain("n:2"); // 2 next_actions
  });

  it("survives corrupt JSONL lines (forward-compat)", () => {
    const path = freshInboxPath();
    const inbox = openBoomerangInbox(path);
    inbox.ingest({ raw: VALID_RETURN });
    // Append a malformed line that future versions might write.
    readFileSync(path, "utf8");
    appendCorruptLine(path);
    expect(() => inbox.list()).not.toThrow();
    expect(inbox.list().length).toBe(1);
  });
});

function appendCorruptLine(path: string): void {
  const fs = require("node:fs") as typeof import("node:fs");
  fs.appendFileSync(path, "{not json}\n", "utf8");
}
