# Mneme Browser Extension (Path 6 -- design notes)

> Status: scaffold-only. v1.26.0 ships the CLI + Notifier infrastructure
> the extension would call into; the actual browser extension is intentionally
> out-of-scope for the npm package (extensions ship via Chrome Web Store /
> Firefox Add-ons, not npm).

## Goal

Bridge Mneme's pulse into web-based AI tools (claude.ai, chatgpt.com,
cursor.sh, Continue web, etc.) so users get the same `[AUTO-ACTION]`
behaviour as native CLI.

## Architecture

Manifest V3 extension with two main paths:

1. **Content script** detects when the user is on an AI tool URL
   (claude.ai/chats/*, chat.openai.com/*, etc.) and finds the
   chat textarea.

2. **Background service worker** polls a local Mneme daemon endpoint
   (`http://localhost:11436/pulse` -- not yet implemented; would be a
   thin HTTP wrapper around `mneme nucleus pulse --json`) every 5
   seconds. When it gets a notable pulse:
   - Inject a banner above the chat textarea: "Mneme: v1.26.x available".
   - Optionally auto-fill the textarea with a templated prompt asking
     the AI to upgrade.

## Why ship as separate distribution

- npm packages can't auto-install browser extensions.
- Chrome Web Store / Firefox AMO have their own review pipeline.
- Extension requires per-vendor permissions (host_permissions for each
  AI tool's domain).
- Signing + auto-update is store-specific.

## Bootstrapping

When this lands, it'll live at `packages/browser-extension/` and
publish to the Chrome Web Store + Firefox AMO under the name
"Mneme Pulse". The npm CLI gains a `mneme browser-extension install`
command that opens the right store page.

## Local-dev pulse HTTP endpoint (when added)

```ts
// packages/cli/src/commands/pulse-server.ts (future)
import http from "node:http";
import { pulse } from "@mneme-ai/core";

const server = http.createServer((req, res) => {
  if (req.url === "/pulse") {
    const status = pulse.collectPulseStatus(process.cwd());
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(status));
    return;
  }
  res.statusCode = 404;
  res.end();
});
server.listen(11436, "127.0.0.1");
```

The extension would CORS-allowlist `http://127.0.0.1:11436` and poll it.
