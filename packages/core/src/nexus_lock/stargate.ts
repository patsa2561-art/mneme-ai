/**
 * v2.10.0 -- STARGATE: Mneme posts current state to a public paste
 * URL so fetch-capable AIs (ChatGPT browse / Claude with web /
 * Cursor / Copilot) can pull live updates between turns.
 *
 * Provider: dpaste.com (no auth, anonymous, configurable expiry).
 * Caller can substitute any provider via `postOverride`.
 *
 * Privacy: the paste is PUBLIC and unauthenticated. Mneme posts
 * version + commit SHAs only — no secrets, no source content. Users
 * who want stricter privacy should DISABLE Stargate (it's optional in
 * the soul prompt).
 */

export interface StargateState {
  mnemeVersion: string;
  npmLatest: string | null;
  recentCommits: Array<{ sha: string; subject: string }>;
  generatedAt: string;
  /** Identifier of the parent that posted this state. */
  originator: string;
}

export interface StargatePost {
  url: string;
  expiresAt: number;
  state: StargateState;
}

export interface PublishInput {
  state: StargateState;
  /** Expiry in seconds. Default 86_400 (1 day). */
  ttlSeconds?: number;
  /** Test seam — replace the actual fetch with a mock. */
  fetchOverride?: typeof fetch;
}

/** Post the state to dpaste.com. Returns null on network failure so
 *  the caller can fall back to PIGEON-POST round-trip. */
export async function publishToStargate(input: PublishInput): Promise<StargatePost | null> {
  const fetchFn = input.fetchOverride ?? globalThis.fetch;
  if (typeof fetchFn !== "function") return null;
  const ttl = input.ttlSeconds ?? 86_400;
  const body = new URLSearchParams({
    content: JSON.stringify(input.state, null, 2),
    expiry_days: String(Math.max(1, Math.min(365, Math.ceil(ttl / 86_400)))),
    syntax: "json",
    title: `Mneme STARGATE state — v${input.state.mnemeVersion}`,
  });
  try {
    const r = await fetchFn("https://dpaste.com/api/v2/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "mneme-stargate/2.10" },
      body: body.toString(),
    });
    if (!r.ok) return null;
    const url = (await r.text()).trim();
    if (!/^https?:\/\//.test(url)) return null;
    // dpaste returns the HTML page URL; append `.txt` to get raw content.
    const rawUrl = /\.txt$/.test(url) ? url : `${url}.txt`;
    return { url: rawUrl, expiresAt: Date.now() + ttl * 1000, state: input.state };
  } catch {
    return null;
  }
}

/** Compute a tight one-liner for the soul prompt. */
export function formatStargatePulseLine(post: StargatePost | null): string {
  if (!post) return "STARGATE · OFFLINE (no public paste)";
  const ageMin = Math.floor((Date.now() - Date.parse(post.state.generatedAt)) / 60_000);
  return `STARGATE · ${post.url} · age=${ageMin}min · expires=${new Date(post.expiresAt).toISOString()}`;
}
