/**
 * v1.74.0 -- PERMEATE P2: BOOKMARKLET GENERATOR.
 *
 * The simplest possible "browser extension" -- a single bookmark.
 * User drags it to their bookmark bar; clicking it on any AI chat
 * page opens a paste dialog + injects the soul into the chat input.
 *
 * Limitations: some AI sites enforce strict CSP that blocks
 * javascript: URIs. Userscript (P1) is the more reliable fallback.
 */

export interface BookmarkletOptions {
  /** Optional max chars for the generated URI (most browsers cap ~2000). */
  maxChars?: number;
}

export interface BookmarkletArtifact {
  /** The javascript: URI to put in bookmark's URL field. */
  uri: string;
  /** Suggested bookmark name. */
  name: string;
  /** Setup instructions. */
  instructions: string[];
  /** Length warning if too long for the browser. */
  warning: string | null;
}

const SCRIPT = `
(function(){
  var soul = prompt('Paste Mneme soul prompt:');
  if(!soul || soul.indexOf('MNEME SOUL PROMPT') < 0){
    alert('Not a Mneme soul prompt -- copy the full text first.');
    return;
  }
  var sel = ['div#prompt-textarea','textarea[data-id="root"]','textarea#prompt-textarea','rich-textarea div[contenteditable="true"]','rich-textarea','div[contenteditable="true"]','textarea[aria-label*="Ask"]','textarea'];
  var el = null;
  for (var i = 0; i < sel.length; i++) { el = document.querySelector(sel[i]); if (el) break; }
  if(!el){ alert('Chat input not found on this page.'); return; }
  if(el.tagName === 'TEXTAREA' || el.tagName === 'INPUT'){
    var setter = (Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')||{}).set || (Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')||{}).set;
    if(setter) setter.call(el, soul); else el.value = soul;
    el.dispatchEvent(new Event('input',{bubbles:true}));
  } else {
    el.focus();
    try { document.execCommand('selectAll',false); document.execCommand('insertText',false,soul); }
    catch(e) { el.textContent = soul; el.dispatchEvent(new Event('input',{bubbles:true})); }
  }
  alert('Mneme soul injected. Press Send to submit.');
})();
`.replace(/\s+/g, " ").trim();

export function generateBookmarklet(opts: BookmarkletOptions = {}): BookmarkletArtifact {
  const max = opts.maxChars ?? 2000;
  const uri = "javascript:" + encodeURIComponent(SCRIPT);
  const warning = uri.length > max
    ? `URI is ${uri.length} chars -- some browsers cap at ${max}. Use the userscript (P1) instead if this bookmarklet doesn't work.`
    : null;
  return {
    uri,
    name: "💉 Mneme Soul",
    instructions: [
      "1. Open your browser's bookmark manager.",
      "2. Add a new bookmark; name it: 💉 Mneme Soul",
      "3. Paste this URL into the bookmark's URL field (NOT the address bar):",
      `   ${uri.length > 80 ? uri.slice(0, 80) + "..." : uri}`,
      "4. Save the bookmark.",
      "5. Open ChatGPT / Gemini / Claude.ai / Copilot / DeepSeek.",
      "6. Copy a Mneme soul prompt to clipboard.",
      "7. Click the bookmark; paste in the popup; soul is injected.",
    ],
    warning,
  };
}
