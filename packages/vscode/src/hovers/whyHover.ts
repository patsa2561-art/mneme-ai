/**
 * Why-this-line hover provider.
 *
 * On every hover we compute the file's atrophy summary and surface it
 * as a Markdown hover with a link to the full "Why this line" panel.
 *
 * Cheap path: we re-use the AtrophyLens cache so hovering doesn't
 * trigger a fresh DB query. If the cache is empty, we skip — the hover
 * is a courtesy, not a critical surface.
 */

import * as vscode from "vscode";
import type { FileKnowledge } from "@mneme-ai/core/public";
import { humanDays } from "../util/iconText.js";

export interface WhyHoverDeps {
  /** Lookup the cached atrophy result; returns undefined when cold. */
  peekAtrophy: (relativeFilePath: string) => FileKnowledge | null | undefined;
  /** Resolves a vscode Uri.fsPath to a repo-relative path, or null. */
  toRelativePath: (fsPath: string) => string | null;
}

export function createWhyHoverProvider(deps: WhyHoverDeps): vscode.HoverProvider {
  return {
    provideHover(document, _position) {
      const rel = deps.toRelativePath(document.uri.fsPath);
      if (!rel) return undefined;
      const fk = deps.peekAtrophy(rel);
      if (fk === undefined) return undefined; // not warmed yet — silent
      if (fk === null) {
        return new vscode.Hover(
          new vscode.MarkdownString(
            `**Mneme** — no commit history for \`${rel}\` yet.`,
          ),
        );
      }
      const top = fk.allKnowers[0];
      const md = new vscode.MarkdownString();
      md.isTrusted = true;
      md.appendMarkdown(`### Mneme — \`${rel}\`\n\n`);
      if (top) {
        const pct = Math.round(top.knowledge * 100);
        md.appendMarkdown(
          `Top knower: **${top.name}** — ${pct}% fresh, last touched ${humanDays(top.lastTouchDaysAgo)}.\n\n`,
        );
      }
      md.appendMarkdown(
        `[Run "Why this line"](command:mneme.why) · [Open Nervous System](command:mneme.nervousSystem)`,
      );
      return new vscode.Hover(md);
    },
  };
}
