/**
 * v1.85.0 -- RELAY: anonymous public paste backends.
 *
 * The pain user surfaced: NEXUS code 6 ตัว ทำงานเฉพาะ PC↔PC ที่มี Mneme
 * ทั้งสองข้าง. Mobile AI apps (Gemini/Claude/ChatGPT) ไม่มี Mneme +
 * resolve code ไม่ได้ → hallucinate.
 *
 * RELAY fixes this WITHOUT deploying any cloud infrastructure: upload
 * the soul prompt to a PUBLIC ANONYMOUS paste service, return the
 * short URL. Mobile AI apps can fetch URLs (they have web access).
 *
 *   PC: AI mints soul → uploads to dpaste.com/<id> → returns URL
 *   PC: shows QR with the URL embedded
 *   Mobile: scans QR (or types URL) → AI fetches → reads soul → resumes
 *
 * Multiple backends so user has fallback:
 *   - dpaste.com   (anonymous, 7-day default expiry, raw URL)
 *   - paste.rs     (anonymous, 30-day, ultra-minimal)
 *   - 0x0.st       (anonymous, expires by size, raw)
 *
 * Privacy: combine with encrypted_payload.ts -- the URL serves the
 * ciphertext; only the user's NEXUS code (out-of-band) can decrypt.
 * Strangers fetching the URL get garbage bytes.
 */

export type RelayBackendId = "dpaste" | "pasters" | "zero-x-zero";

export interface RelayUploadResult {
  ok: boolean;
  url: string | null;
  backend: RelayBackendId;
  reason?: string;
  expiresIn: string;
}

export interface UploadInput {
  content: string;
  /** Test seam -- inject a stub fetcher for unit tests. */
  fetchImpl?: typeof fetch;
}

/** Upload to dpaste.com. */
export async function uploadToDpaste(input: UploadInput): Promise<RelayUploadResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const form = new URLSearchParams();
    form.set("content", input.content);
    form.set("syntax", "text");
    form.set("expiry_days", "7");
    const res = await fetchImpl("https://dpaste.com/api/v2/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (!res.ok) return { ok: false, url: null, backend: "dpaste", reason: `HTTP ${res.status}`, expiresIn: "7d" };
    const url = (await res.text()).trim();
    return { ok: true, url: url.endsWith(".txt") ? url : url + ".txt", backend: "dpaste", expiresIn: "7d" };
  } catch (e) {
    return { ok: false, url: null, backend: "dpaste", reason: (e as Error).message, expiresIn: "7d" };
  }
}

/** Upload to paste.rs (ultra-minimal, anonymous). */
export async function uploadToPasteRs(input: UploadInput): Promise<RelayUploadResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl("https://paste.rs/", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: input.content,
    });
    if (!res.ok) return { ok: false, url: null, backend: "pasters", reason: `HTTP ${res.status}`, expiresIn: "30d" };
    const url = (await res.text()).trim();
    return { ok: true, url, backend: "pasters", expiresIn: "30d" };
  } catch (e) {
    return { ok: false, url: null, backend: "pasters", reason: (e as Error).message, expiresIn: "30d" };
  }
}

/** Upload to 0x0.st (anonymous file drop). */
export async function uploadToZeroXZero(input: UploadInput): Promise<RelayUploadResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const form = new FormData();
    form.set("file", new Blob([input.content], { type: "text/plain" }), "soul.txt");
    const res = await fetchImpl("https://0x0.st/", { method: "POST", body: form });
    if (!res.ok) return { ok: false, url: null, backend: "zero-x-zero", reason: `HTTP ${res.status}`, expiresIn: "size-based" };
    const url = (await res.text()).trim();
    return { ok: true, url, backend: "zero-x-zero", expiresIn: "size-based" };
  } catch (e) {
    return { ok: false, url: null, backend: "zero-x-zero", reason: (e as Error).message, expiresIn: "size-based" };
  }
}

/** Try backends in order; return first success. Lets the user have a
 *  graceful fallback if any service is rate-limited or down. */
export async function uploadWithFallback(input: UploadInput, order: RelayBackendId[] = ["dpaste", "pasters", "zero-x-zero"]): Promise<RelayUploadResult> {
  const errors: string[] = [];
  for (const id of order) {
    const fn = id === "dpaste" ? uploadToDpaste : id === "pasters" ? uploadToPasteRs : uploadToZeroXZero;
    const r = await fn(input);
    if (r.ok) return r;
    errors.push(`${id}: ${r.reason ?? "unknown"}`);
  }
  return { ok: false, url: null, backend: order[order.length - 1]!, reason: `all backends failed: ${errors.join(" | ")}`, expiresIn: "n/a" };
}
