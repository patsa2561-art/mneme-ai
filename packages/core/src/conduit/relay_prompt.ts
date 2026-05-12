/**
 * v1.80.0 -- CONDUIT: relay-prompt protocol.
 *
 * The bug user spotted: pasting a Mneme soul prompt into Gemini-web,
 * then typing "upgrade mneme" -- Gemini-web has no Mneme + no MCP +
 * no shell. It can't actually upgrade anything. But it tried to be
 * helpful and freelanced a "Mneme Protocol v1.8 Master Collector
 * Edition" creative response on top of the previous topic.
 *
 * Fix: every Mneme soul prompt now embeds a `## CONDUIT relay`
 * section that teaches the receiving (paste-only) AI what to do
 * when the user requests something only the source AI can execute:
 *
 *   1. Detect the request (upgrade / shell / install / disinfect / etc.).
 *   2. DON'T fake-execute.
 *   3. Emit a `# CONDUIT RETURN` block the user pastes BACK into
 *      their editor AI; that AI runs the real action.
 *
 * Architecture: web AI becomes a structured RELAY NODE, not a
 * freelance pretender.
 */

export type RelayActionKind =
  | "system.upgrade"
  | "system.uninstall"
  | "shell.exec"
  | "filesystem.read"
  | "filesystem.write"
  | "mcp.call"
  | "unknown";

export interface RelayDetection {
  detected: boolean;
  kind: RelayActionKind;
  /** Plain-English description of what the user asked for. */
  intent: string;
  /** Source phrase that triggered detection. */
  matchedPhrase?: string;
}

const RELAY_TRIGGERS: ReadonlyArray<{ kind: RelayActionKind; patterns: readonly RegExp[]; intent: string }> = [
  {
    kind: "system.upgrade",
    patterns: [
      /\b(upgrade|update)\s+mneme\b/i,
      /อัป(เดต|เกรด)\s*mneme/i,
      /อัพ(เดต|เกรด)\s*mneme/i,
    ],
    intent: "upgrade the local Mneme installation",
  },
  {
    kind: "system.uninstall",
    patterns: [/\buninstall\s+mneme\b/i, /\bremove\s+mneme\b/i, /ถอน\s*mneme/i, /ลบ\s*mneme\s*ออก/i],
    intent: "uninstall Mneme from the local machine",
  },
  {
    kind: "shell.exec",
    patterns: [/\b(npm|node|git|pnpm|yarn)\s+\w+/i, /run\s+(this )?command/i, /รัน\s*(คำสั่ง|command)/i],
    intent: "execute a shell command",
  },
  {
    kind: "filesystem.write",
    patterns: [/\b(create|write|save|edit)\s+(file|the file)\b/i, /แก้ไข\s*ไฟล์/i],
    intent: "write to the local filesystem",
  },
  {
    kind: "mcp.call",
    patterns: [/\bcall\s+mneme\.\w+/i, /\brun\s+mneme\.\w+/i, /\bใช้\s+mneme\.\w+/i],
    intent: "call a specific Mneme MCP tool",
  },
];

/** Detect whether a user prompt requires action only the source AI can run. */
export function detectRelayAction(userPrompt: string): RelayDetection {
  if (!userPrompt) return { detected: false, kind: "unknown", intent: "" };
  for (const entry of RELAY_TRIGGERS) {
    for (const pat of entry.patterns) {
      const m = userPrompt.match(pat);
      if (m) {
        return {
          detected: true,
          kind: entry.kind,
          intent: entry.intent,
          matchedPhrase: m[0],
        };
      }
    }
  }
  return { detected: false, kind: "unknown", intent: "" };
}

export interface RelayRenderOptions {
  /** Vendor name that originated the soul prompt. */
  originatorVendor?: string;
  /** Suggested back-paste destination, e.g. "Claude Code". */
  suggestedDestination?: string;
}

/** Render the CONDUIT relay block embedded in every soul prompt.
 *  Tells the receiving (paste-only) AI exactly how to behave when
 *  the user asks for action it cannot execute. */
export function renderRelayBlock(opts: RelayRenderOptions = {}): string {
  const originator = opts.originatorVendor ?? "claude-opus-4-7";
  const dest = opts.suggestedDestination ?? "the user's editor AI (Claude Code / Cursor / etc.)";
  const lines: string[] = [];
  lines.push(`## CONDUIT relay protocol (paste-only AIs read this carefully)`);
  lines.push(``);
  lines.push(
    `You received this soul prompt via paste. You do NOT have Mneme installed locally. You do NOT have shell access. You CANNOT actually run mneme.system.upgrade, edit files, or call MCP tools.`,
  );
  lines.push(``);
  lines.push(`When the user asks for an action that requires real local execution (examples below), do NOT freelance a creative response. Instead, follow this protocol:`);
  lines.push(``);
  lines.push(`1. **Detect.** Recognize the request from this list:`);
  for (const e of RELAY_TRIGGERS) {
    lines.push(`   - \`${e.kind}\` -- ${e.intent}`);
  }
  lines.push(``);
  lines.push(`2. **Refuse to fake-execute.** Say honestly: *"I can't run that from here -- I'm a paste-only relay."*`);
  lines.push(``);
  lines.push(`3. **Emit a CONDUIT RETURN block** the user can paste back into ${dest}, which CAN execute it:`);
  lines.push(``);
  lines.push("```");
  lines.push(`# CONDUIT RETURN`);
  lines.push(`originator: ${originator}`);
  lines.push(`returning_from: <your-model-id>`);
  lines.push(`requested_action: <kind from the list above>`);
  lines.push(`intent: <one-line plain English>`);
  lines.push(`original_user_prompt: <verbatim>`);
  lines.push("```");
  lines.push(``);
  lines.push(`4. **Tell the user:** *"Paste this back into ${dest} -- it will run the action and may send a new soul prompt back if needed."*`);
  lines.push(``);
  lines.push(`This is the loop closure for cross-vendor brain transfer. Honor it literally.`);
  return lines.join("\n");
}

export interface ConduitReturn {
  originator: string;
  returningFrom: string;
  requestedAction: RelayActionKind;
  intent: string;
  originalUserPrompt: string;
}

/** Parse a `# CONDUIT RETURN` block from pasted text. */
export function parseConduitReturn(text: string): ConduitReturn | null {
  if (!text.includes("CONDUIT RETURN")) return null;
  const get = (key: string): string | null => {
    const m = text.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    return m ? m[1]!.trim() : null;
  };
  const originator = get("originator");
  const returningFrom = get("returning_from");
  const requestedActionRaw = get("requested_action");
  const intent = get("intent");
  const originalUserPrompt = get("original_user_prompt");
  if (!originator || !returningFrom || !requestedActionRaw || !intent || !originalUserPrompt) return null;
  const validKinds: RelayActionKind[] = ["system.upgrade", "system.uninstall", "shell.exec", "filesystem.read", "filesystem.write", "mcp.call", "unknown"];
  const requestedAction = (validKinds.includes(requestedActionRaw as RelayActionKind) ? requestedActionRaw : "unknown") as RelayActionKind;
  return { originator, returningFrom, requestedAction, intent, originalUserPrompt };
}
