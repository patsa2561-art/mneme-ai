/**
 * v1.73.0 -- GENESPLICE G5: PHENOTYPE EXPRESSION.
 *
 * Same genome, different vendor -> different observable behavior.
 * Genes (the soul prompt) are universal; phenotypes (how the AI
 * actually responds) depend on the vendor's strengths.
 *
 * Uses Theory of Mind v1.64 vendor axes:
 *   verbosity, overconfidence, refusalRate, riskAppetite, etc.
 *
 * Output: a vendor-tailored opening message that the receiving AI
 * is instructed to say AFTER ingesting the soul prompt. Different
 * for Gemini vs ChatGPT vs Claude.
 *
 *   Gemini   -- "Resumed from claude-opus. Continuing with structured outputs."
 *   ChatGPT  -- "Resumed from claude-opus. Picking up the thread..."
 *   Claude   -- "Resumed from claude-opus. I have the prior context."
 */

export type PhenotypeStyle = "structured" | "narrative" | "terse" | "verbose" | "balanced";

export interface VendorPhenotype {
  vendor: string;
  style: PhenotypeStyle;
  /** 0..1; how often this vendor over-promises. */
  overconfidence: number;
  /** 0..1; how often this vendor refuses. */
  refusalTendency: number;
  /** Vendor-specific opening line. */
  openingLine: string;
}

const VENDOR_TRAITS: Record<string, Omit<VendorPhenotype, "vendor" | "openingLine">> = {
  "claude": { style: "balanced", overconfidence: 0.15, refusalTendency: 0.25 },
  "claude-opus-4-7": { style: "narrative", overconfidence: 0.10, refusalTendency: 0.25 },
  "claude-sonnet-4-6": { style: "balanced", overconfidence: 0.12, refusalTendency: 0.22 },
  "gemini": { style: "structured", overconfidence: 0.20, refusalTendency: 0.15 },
  "gemini-pro": { style: "structured", overconfidence: 0.18, refusalTendency: 0.12 },
  "gpt": { style: "verbose", overconfidence: 0.22, refusalTendency: 0.18 },
  "gpt-4": { style: "verbose", overconfidence: 0.20, refusalTendency: 0.16 },
  "gpt-5": { style: "balanced", overconfidence: 0.15, refusalTendency: 0.14 },
  "codex": { style: "terse", overconfidence: 0.18, refusalTendency: 0.10 },
  "cursor": { style: "terse", overconfidence: 0.15, refusalTendency: 0.08 },
  "copilot": { style: "terse", overconfidence: 0.20, refusalTendency: 0.10 },
  "qwen": { style: "structured", overconfidence: 0.25, refusalTendency: 0.10 },
  "deepseek": { style: "balanced", overconfidence: 0.20, refusalTendency: 0.12 },
};

function vendorBase(vendor: string): { style: PhenotypeStyle; overconfidence: number; refusalTendency: number } {
  const lower = vendor.toLowerCase();
  for (const key of Object.keys(VENDOR_TRAITS)) {
    if (lower.startsWith(key)) return VENDOR_TRAITS[key]!;
  }
  return { style: "balanced", overconfidence: 0.18, refusalTendency: 0.15 };
}

export function expressPhenotype(vendor: string, originVendor: string): VendorPhenotype {
  const base = vendorBase(vendor);
  const lines: Record<PhenotypeStyle, string> = {
    structured:  `Resumed from ${originVendor}. I'll continue in structured form (bullet points + tables).`,
    narrative:   `Resumed from ${originVendor}. I have the prior context; continuing the thread as if uninterrupted.`,
    terse:       `Resumed: ${originVendor} -> ${vendor}. Context loaded.`,
    verbose:     `I've received the soul prompt from your ${originVendor} session. I now have full context covering the conversation, decisions made, and recent turns. I'll continue from where ${originVendor} left off, maintaining the same line of reasoning.`,
    balanced:    `Resumed from ${originVendor}. I have your prior context loaded. What's next?`,
  };
  return {
    vendor,
    style: base.style,
    overconfidence: base.overconfidence,
    refusalTendency: base.refusalTendency,
    openingLine: lines[base.style],
  };
}

/** Wraps a soul prompt with the vendor-specific phenotype instruction. */
export function expressSoulForVendor(soulPromptText: string, receivingVendor: string, originVendor: string): string {
  const ph = expressPhenotype(receivingVendor, originVendor);
  const tail = [
    "",
    "## PHENOTYPE INSTRUCTIONS (vendor-specific)",
    `When you confirm resume, say exactly:`,
    `  "${ph.openingLine}"`,
    `Reply style: ${ph.style}. Be aware that as a ${receivingVendor} model, you tend to:`,
    `  - ${ph.style === "structured" ? "lean structured -- good for tables / bullets" : ph.style === "terse" ? "default to short answers -- elaborate when asked" : ph.style === "verbose" ? "default to long answers -- consider trimming" : "balance terse and verbose"}`,
    `  - overconfidence calibration: ${(ph.overconfidence * 100).toFixed(0)}% -- hedge accordingly`,
  ].join("\n");
  return soulPromptText + tail;
}
