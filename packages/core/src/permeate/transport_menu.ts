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

export interface TransportRecommendation {
  /** Best fit given the user's situation. */
  recommended: TransportMethod;
  /** Why. */
  rationale: string;
  /** All options ranked by friction. */
  rankedOptions: TransportOption[];
}

export function recommendTransport(opts: {
  hasGithubAccount?: boolean;
  preferOffline?: boolean;
  laptopToPhone?: boolean;
} = {}): TransportRecommendation {
  if (opts.laptopToPhone) {
    return {
      recommended: "qr-code-svg",
      rationale: "Laptop->phone transfer; QR is instant + no accounts needed.",
      rankedOptions: [...TRANSPORT_OPTIONS].sort((a, b) => a.friction - b.friction),
    };
  }
  if (opts.preferOffline) {
    return {
      recommended: "wanderer-mwt",
      rationale: "Offline preference; .mwt bundle works over USB without any network.",
      rankedOptions: [...TRANSPORT_OPTIONS].sort((a, b) => a.friction - b.friction),
    };
  }
  if (opts.hasGithubAccount) {
    return {
      recommended: "gist",
      rationale: "GitHub account present; Gist gives persistent URL across all machines.",
      rankedOptions: [...TRANSPORT_OPTIONS].sort((a, b) => a.friction - b.friction),
    };
  }
  return {
    recommended: "clipboard-relay",
    rationale: "No account / setup required. Works for everyone via any messenger.",
    rankedOptions: [...TRANSPORT_OPTIONS].sort((a, b) => a.friction - b.friction),
  };
}
