/**
 * v1.74.0 -- PERMEATE P4: CROSS-MACHINE TRANSPORT MENU.
 *
 * Answers the user's question: "How do I move a soul prompt across
 * two computers?" Returns 4 ranked options with concrete steps.
 */

export type TransportMethod = "clipboard-relay" | "gist" | "wanderer-mwt" | "qr-code-svg";

export interface TransportOption {
  method: TransportMethod;
  /** Human-friendly title. */
  title: string;
  /** What this enables. */
  whatItDoes: string;
  /** Step-by-step instructions in plain Thai+English. */
  steps: string[];
  /** Pros + cons. */
  pros: string[];
  /** Friction level 1..5 (1 = effortless). */
  friction: number;
}

export const TRANSPORT_OPTIONS: TransportOption[] = [
  {
    method: "clipboard-relay",
    title: "Copy-paste via clipboard (messenger / email / Slack)",
    whatItDoes: "Move soul prompt as plain text from machine A to machine B using any chat / email / Slack DM.",
    steps: [
      "Machine A: AI runs mneme.genesplice.transmit -> outputs ~500-token soul prompt",
      "Machine A: highlight + copy the soul prompt",
      "Machine A: paste into your messenger of choice (Telegram / Slack / Email to yourself)",
      "Machine B: open the message, copy the soul prompt",
      "Machine B: paste into ChatGPT / Gemini / Claude.ai chat input",
      "Receiving AI replies: 'Resumed from claude-opus-4-7...' — context transferred",
    ],
    pros: ["Works on every OS", "No accounts needed", "Plain text, future-proof"],
    friction: 1,
  },
  {
    method: "gist",
    title: "GitHub Gist (user-owned cloud)",
    whatItDoes: "Upload soul prompt to your own GitHub Gist; share URL with yourself; receiving AI fetches it.",
    steps: [
      "Machine A: AI runs mneme.genesplice.transmit with includeGistPackage=true",
      "Machine A: copy the wrapped content; open https://gist.github.com/new",
      "Machine A: paste content, set visibility to 'secret', click Create gist",
      "Machine A: copy the gist URL",
      "Machine B: tell the AI: 'Resume Mneme soul from this gist: <URL>'",
      "Receiving AI fetches the URL, ingests the soul, continues",
    ],
    pros: ["Persistent URL works across all your machines", "Secret gist is private but accessible by you", "Version history if you create new gist revisions"],
    friction: 2,
  },
  {
    method: "wanderer-mwt",
    title: "Wanderer .mwt portable bundle (USB / email attachment)",
    whatItDoes: "Pack entire Mneme state (capsules, vaccines, genome) into a single signed .mwt file; transport via USB / email attachment / cloud storage.",
    steps: [
      "Machine A: AI runs mneme wanderer pack -> .mwt file",
      "Move the .mwt to machine B (USB / email / Dropbox / WhatsApp file)",
      "Machine B: AI runs mneme wanderer unpack <file>.mwt",
      "Machine B: Mneme state restored; capsules + vaccines + genome merged",
      "Both machines now share full Mneme history; cross-vendor handover works locally on each",
    ],
    pros: ["Full state transfer (not just current session)", "HMAC-signed = tamper-evident", "Works offline"],
    friction: 3,
  },
  {
    method: "qr-code-svg",
    title: "QR code (laptop -> phone -> any AI app)",
    whatItDoes: "Encode the soul prompt as a QR code; scan with phone; paste into a mobile AI app or share back.",
    steps: [
      "Machine A: AI runs mneme.permeate.qr-encode <soul-prompt>",
      "Machine A: display the SVG QR code on screen",
      "Machine B (phone): scan QR with camera app",
      "Phone: copy the decoded text",
      "Phone: paste into ChatGPT mobile app / Gemini app",
      "Receiving AI replies with resumed context",
    ],
    pros: ["No accounts needed", "Works between laptop + phone instantly", "No cloud / network needed"],
    friction: 2,
  },
];

export interface ScoredTransport {
  option: TransportOption;
  /** 0..100 fitness score for the given context. */
  score: number;
  /** Why this score (positive AND negative factors). */
  reasons: string[];
}

export interface TransportRecommendation {
  /** Best fit given the user's situation. */
  recommended: TransportMethod;
  /** Why this won. */
  rationale: string;
  /** All options scored + ranked. Bug #3 (v1.74) -- previously every
   *  scenario flattened to clipboard-relay because the laddered
   *  if-chain ignored the rest of the menu. Now every transport has
   *  its own score so the AI can present a true ranked fallback list. */
  rankedOptions: TransportOption[];
  /** Full ranked + scored list (highest fitness first). The top entry's
   *  option.method == `recommended`. */
  scored: ScoredTransport[];
}

interface ScoringContext {
  hasGithubAccount: boolean;
  preferOffline: boolean;
  laptopToPhone: boolean;
}

function scoreTransport(opt: TransportOption, ctx: ScoringContext): ScoredTransport {
  let score = 50;
  const reasons: string[] = [];

  // Universal friction penalty -- lower friction always slightly better.
  score += (6 - opt.friction) * 4;
  reasons.push(`base score 50 + friction bonus ${(6 - opt.friction) * 4} (friction ${opt.friction}/5)`);

  switch (opt.method) {
    case "clipboard-relay":
      reasons.push("clipboard: universal fallback that works in every browser + OS");
      if (!ctx.hasGithubAccount && !ctx.preferOffline && !ctx.laptopToPhone) {
        score += 25;
        reasons.push("+25 universal default (no other signal given)");
      }
      if (ctx.laptopToPhone) {
        score -= 20;
        reasons.push("-20 clipboard rarely syncs laptop<->phone");
      }
      if (ctx.preferOffline) {
        score -= 5;
        reasons.push("-5 requires a messenger to relay, which may be online");
      }
      break;
    case "gist":
      if (ctx.hasGithubAccount) {
        score += 35;
        reasons.push("+35 GitHub account present, gist gives persistent URL");
      } else {
        score -= 30;
        reasons.push("-30 requires GitHub account, none reported");
      }
      if (ctx.preferOffline) {
        score -= 50;
        reasons.push("-50 needs network");
      }
      break;
    case "wanderer-mwt":
      if (ctx.preferOffline) {
        score += 40;
        reasons.push("+40 fully offline, USB-portable");
      } else {
        score -= 5;
        reasons.push("-5 heavier than a paste when network is available");
      }
      if (ctx.laptopToPhone) {
        score -= 15;
        reasons.push("-15 phone rarely accepts .mwt files");
      }
      break;
    case "qr-code-svg":
      if (ctx.laptopToPhone) {
        score += 40;
        reasons.push("+40 laptop->phone transfer, QR is the canonical bridge");
      } else {
        score -= 5;
        reasons.push("-5 QR not the most natural for laptop<->laptop");
      }
      if (ctx.preferOffline) {
        score += 10;
        reasons.push("+10 works without any network");
      }
      break;
  }

  // Clamp.
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { option: opt, score, reasons };
}

export function recommendTransport(opts: {
  hasGithubAccount?: boolean;
  preferOffline?: boolean;
  laptopToPhone?: boolean;
} = {}): TransportRecommendation {
  const ctx: ScoringContext = {
    hasGithubAccount: Boolean(opts.hasGithubAccount),
    preferOffline: Boolean(opts.preferOffline),
    laptopToPhone: Boolean(opts.laptopToPhone),
  };
  const scored = TRANSPORT_OPTIONS
    .map((opt) => scoreTransport(opt, ctx))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.option.friction - b.option.friction; // tie-break: less friction wins
    });
  const top = scored[0]!;
  const rationale = top.reasons.join(" · ");
  const rankedOptions = scored.map((s) => s.option);
  return {
    recommended: top.option.method,
    rationale,
    rankedOptions,
    scored,
  };
}
