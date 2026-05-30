// Category — the test environment MUST be free of ambient AI-agent identity
// signals.
//
// ROOT CAUSE this guards (v2.110): when the suite runs INSIDE an AI agent
// (Claude Code / Cursor / Cline / Codex / Continue / Copilot / Devin), that
// host sets identity env vars (CLAUDECODE, CURSOR_TRACE_ID, …). Vendor-
// detection + isolation unit tests assume a clean environment, so the ambient
// host vars made them fail with false negatives that never happen on a clean
// CI runner. `tests/vitest-setup.ts` strips those vars in every worker; this
// test proves the strip stays effective (so the false-failure class can't
// silently return). API keys + OLLAMA_* are intentionally NOT stripped (other
// subsystems read them), so we don't assert on those.

import { describe, it, expect } from "vitest";

// The exact identity signals tests/vitest-setup.ts deletes. Keep in sync.
const STRIPPED_IDENTITY_VARS = [
  "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SESSION", "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_SSE_PORT", "CLAUDE_AGENT_SDK_VERSION", "CLAUDE_CODE_ENABLE_TASKS",
  "CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING", "CLAUDE_CODE_TMPDIR", "CLAUDE_EFFORT",
  "CURSOR_AGENT", "CURSOR_TRACE_ID", "CLINE_AGENT", "CLINE_TASK_ID",
  "CODEX_AGENT", "OPENAI_CODEX", "CONTINUE_DEV", "COPILOT_AGENT",
  "GITHUB_COPILOT_CLI", "GH_COPILOT_TOKEN", "DEVIN_AGENT", "DEVIN_SESSION",
  "AI_AGENT", "MNEME_AI_VENDOR",
] as const;

describe("test env isolation — ambient AI-agent identity signals are stripped", () => {
  for (const v of STRIPPED_IDENTITY_VARS) {
    it(`${v} is not set in the test process`, () => {
      expect(process.env[v]).toBeUndefined();
    });
  }
});
