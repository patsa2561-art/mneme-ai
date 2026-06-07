import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleKeryxRelay } from "../gephyra/index.js";
import { mintPairingCode } from "./rendezvous.js";

describe("RELAY KEY ROTATION — compromise recovery", () => {
  it("rotate with the right old key kills the old + activates the new; wrong old key → 401", async () => {
    const repo = mkdtempSync(join(tmpdir(), "relay-rot-"));
    const oldKey = "old-key", did = "d-rot";
    const { record } = mintPairingCode(did, "line", { now: Date.now(), secret: oldKey });
    await handleKeryxRelay(repo, "pair-register", { daemonId: did, record, key: oldKey }, {});

    // wrong old key cannot rotate
    const bad = await handleKeryxRelay(repo, "rotate-key", { daemonId: did, oldKey: "guess", newKey: "n" }, {});
    expect(bad.status).toBe(401);

    // correct old key rotates
    const newKey = "new-key";
    const ok = await handleKeryxRelay(repo, "rotate-key", { daemonId: did, oldKey, newKey }, {});
    expect((ok.body as { rotated?: boolean }).rotated).toBe(true);

    // OLD key can no longer drain; NEW key can
    const oldDrain = await handleKeryxRelay(repo, "drain", "", { daemon: did }, { "x-keryx-key": oldKey });
    expect((oldDrain.body as { auth?: boolean }).auth).toBe(false);
    const newDrain = await handleKeryxRelay(repo, "drain", "", { daemon: did }, { "x-keryx-key": newKey });
    expect((newDrain.body as { auth?: boolean }).auth).not.toBe(false);
  });
});
