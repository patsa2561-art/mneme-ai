/**
 * The local agent's side of the bridge. After building a signed, raw-free
 * report on a PRIVATE repo locally, publish ONLY that report to a Lighthouse
 * server. The source never leaves the machine — only metrics + a signature go.
 */
import { xrayLeaksRaw } from "./privacy.js";
import type { SignedXRay } from "./types.js";

export interface PublishResult { ok: boolean; profileId?: string; fingerprint?: string; error?: string }

export async function publishReport(server: string, token: string, signed: SignedXRay): Promise<PublishResult> {
  // belt-and-braces: refuse to transmit anything that isn't raw-free
  const leak = xrayLeaksRaw(signed.report);
  if (leak.leaks) return { ok: false, error: "refusing to publish: report is not raw-free (" + leak.reasons.join("; ") + ")" };
  const base = server.replace(/\/+$/, "");
  try {
    const res = await fetch(base + "/api/ingest", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + token },
      body: JSON.stringify(signed),
    });
    const data = (await res.json().catch(() => ({}))) as PublishResult & { error?: string };
    if (!res.ok) return { ok: false, error: data.error || `server returned ${res.status}` };
    return { ok: true, profileId: data.profileId, fingerprint: data.fingerprint };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
