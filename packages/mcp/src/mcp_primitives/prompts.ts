/**
 * MCP `prompts` primitive — pre-baked workflow templates clients
 * surface as slash-commands. Mneme ships 4:
 *
 *   • /refactor-safety            — ai_commit_check before merge
 *   • /incident-postmortem        — premortem + drawdown + chronicle
 *   • /onboarding-pack            — mirror + nervous-system for new hire
 *   • /code-review-with-history   — memory.why + telepathy + premortem
 *
 * Each prompt resolves to a Mneme molecule (a named atom combination).
 * Clients call `prompts/get` with arguments → we render a templated
 * message that lists the molecule's atoms + how to compose them.
 */

export interface McpPromptListItem {
  name: string;
  description: string;
  arguments?: Array<{ name: string; description: string; required?: boolean }>;
}

export interface McpPromptMessage {
  role: "user" | "assistant";
  content: { type: "text"; text: string };
}

export interface McpPromptResult {
  description: string;
  messages: McpPromptMessage[];
}

const PROMPTS: McpPromptListItem[] = [
  {
    name: "refactor-safety",
    description: "Before merging an AI-written refactor, run a safety bundle: certify + verify + cross-examine.",
    arguments: [{ name: "commit", description: "Commit hash to gate (defaults to HEAD).", required: false }],
  },
  {
    name: "incident-postmortem",
    description: "Reconstruct an incident: drawdown + premortem + chronicle + replay fingerprint.",
    arguments: [{ name: "since", description: "Window start (ISO date).", required: false }],
  },
  {
    name: "onboarding-pack",
    description: "Generate an onboarding bundle: mirror + nervous-system + atrophy heatmap + voice fingerprints.",
    arguments: [{ name: "topic", description: "Area to onboard into (e.g. 'auth', 'payments').", required: true }],
  },
  {
    name: "code-review-with-history",
    description: "Review code with full historical context: memory.why for the file, telepathy for invisible owners, premortem for risk.",
    arguments: [{ name: "file", description: "File path under review.", required: true }],
  },
];

export function listPrompts(): McpPromptListItem[] {
  return PROMPTS;
}

export function getPrompt(name: string, args: Record<string, string>): McpPromptResult {
  switch (name) {
    case "refactor-safety": {
      const commit = args["commit"] ?? "HEAD";
      return {
        description: "Refactor-safety gate — bundle 3 Mneme calls before merging.",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `I'm about to merge commit ${commit}. Run the refactor-safety bundle:`,
                ``,
                `1. mneme.audit.certify({ explain: true })  → 5-axis trust verdict`,
                `2. mneme.verify_claims({ draft: <my PR description> })  → catch hallucinated hashes`,
                `3. mneme.adversary.cross_examine({ claim: "this refactor is safe to merge" })  → red-team`,
                ``,
                `Then summarize: PASS / WARN / FAIL across all three. If any warn or fail, list the specific findings + recommended next step.`,
              ].join("\n"),
            },
          },
        ],
      };
    }
    case "incident-postmortem": {
      const since = args["since"] ?? "(last 14 days)";
      return {
        description: "Incident postmortem — pull together drawdown + chronicle + replay evidence.",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `Reconstruct the incident from ${since}. Compose:`,
                ``,
                `1. mneme.quant.drawdown  → the worst losing-streak in the window`,
                `2. mneme.insights.story({ topic: "<incident topic>" })  → what happened, in narrative`,
                `3. mneme.insights.regret({ windowDays: 14 })  → ship-then-fix patterns`,
                `4. mneme.replay.fingerprint  → tamper-evident root for the AI session`,
                ``,
                `Output a postmortem doc with sections: timeline, root cause, what we knew, what we missed, action items.`,
              ].join("\n"),
            },
          },
        ],
      };
    }
    case "onboarding-pack": {
      const topic = args["topic"] ?? "<topic>";
      return {
        description: `Onboarding pack — produce a curated dossier for someone joining the ${topic} area.`,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `Build an onboarding pack for the ${topic} area. Compose:`,
                ``,
                `1. mneme.insights.mirror({ topic: "${topic}" })  → 5 PRs, 3 people, 2 incidents`,
                `2. mneme.people.nervous_system  → flagship report`,
                `3. mneme.people.atrophy  → who knows what (and is forgetting it)`,
                `4. mneme.quality.cognitive_twin({ authorEmail: "<top owner>" })  → voice fingerprint`,
                ``,
                `Output a Markdown dossier with sections: people to ask, key PRs, recent incidents, the codebase's voice.`,
              ].join("\n"),
            },
          },
        ],
      };
    }
    case "code-review-with-history": {
      const file = args["file"] ?? "<path>";
      return {
        description: "Code review with full historical context.",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `Review ${file} with full historical context. Compose:`,
                ``,
                `1. mneme.memory.why({ file: "${file}" })  → why does this file exist`,
                `2. mneme.people.telepathy  → who pairs invisibly on adjacent files`,
                `3. mneme.insights.premortem({ intent: "modify ${file}" })  → regret risk`,
                `4. mneme.aletheia.lint({ target: "<modification>" })  → security scan`,
                ``,
                `Output: should we proceed? what should reviewers focus on?`,
              ].join("\n"),
            },
          },
        ],
      };
    }
    default:
      throw new Error(`unknown prompt: ${name}`);
  }
}
