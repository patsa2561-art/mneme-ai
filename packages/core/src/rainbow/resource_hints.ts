/**
 * v1.90.0 -- RAINBOW: mobile resource hints.
 *
 * The mobile page detects the visiting device's constraints via
 * standard browser APIs and adapts UI accordingly. We emit the JS
 * snippet that runs on the phone; this module is a pure renderer
 * (no Node-side detection).
 *
 * Detected:
 *   - navigator.connection.effectiveType   (4g / 3g / 2g / slow-2g)
 *   - navigator.deviceMemory                (GB, may be undefined on iOS)
 *   - navigator.hardwareConcurrency         (logical CPU cores)
 *   - screen.width × screen.height          (viewport)
 *   - navigator.userAgent                   (rough OS sniff)
 *
 * Decisions the page makes from these:
 *   - slow network → DON'T fetch soul eagerly; show "Tap to load" button
 *   - low memory   → split soul into chunks before Share
 *   - small screen → bigger font, less spacing
 *   - iOS Safari   → use clipboard API differently (some restrictions)
 */

export interface ResourceHintsScriptOptions {
  /** Threshold below which we treat the network as slow. Default "3g". */
  slowNetworkThreshold?: "slow-2g" | "2g" | "3g" | "4g";
}

export function renderResourceHintsScript(_opts: ResourceHintsScriptOptions = {}): string {
  return `
  (function() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection || {};
    const slow = conn.effectiveType && /(slow-2g|2g)/.test(conn.effectiveType);
    const lowMem = (navigator.deviceMemory || 4) < 2;
    const smallScreen = Math.min(screen.width, screen.height) < 360;
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    window.__mnemeHints = { slow, lowMem, smallScreen, isIOS, effectiveType: conn.effectiveType || "unknown", deviceMemory: navigator.deviceMemory || null, cores: navigator.hardwareConcurrency || null };
    if (smallScreen) document.documentElement.style.fontSize = "20px";
    if (lowMem || slow) {
      const banner = document.createElement("div");
      banner.style.cssText = "background:#e67e22;color:#fff;padding:12px;border-radius:8px;margin:12px 0;text-align:center;font-size:14px";
      banner.textContent = slow ? "Slow network detected — tapping a button starts the fetch" : "Low memory device — using lightweight mode";
      const wrap = document.querySelector(".wrap") || document.body;
      wrap.insertBefore(banner, wrap.firstChild);
    }
  })();
  `.trim();
}

/** JS-safe quote: JSON.stringify does NOT escape `/` (the spec allows
 *  forward slash unescaped), so `</script>` could break out of an
 *  inline `<script>` tag. We post-process to escape `/` after `<`. */
function jsSafeString(s: string): string {
  return JSON.stringify(s).replace(/<\/(script)/gi, "<\\/$1");
}

/** JS snippet that LAZY-LOADS the soul from a URL when user taps Share.
 *  Avoids embedding the full soul in the page (saves memory + network). */
export function renderLazyShareScript(soulUrl: string): string {
  return `
  (function() {
    const btn = document.getElementById("s");
    const ok = document.getElementById("ok");
    if (!btn) return;
    let cached = null;
    async function fetchSoul() {
      if (cached) return cached;
      btn.textContent = "Loading soul...";
      btn.disabled = true;
      const r = await fetch(${jsSafeString(soulUrl)});
      cached = await r.text();
      btn.disabled = false;
      btn.textContent = "📤 Send to AI app";
      return cached;
    }
    btn.onclick = async () => {
      try {
        const soul = await fetchSoul();
        if (navigator.share) {
          await navigator.share({ text: soul, title: "Mneme" });
          if (ok) ok.style.display = "block";
        } else {
          await navigator.clipboard.writeText(soul);
          btn.textContent = "✓ Copied! Open AI and paste.";
        }
      } catch (e) {
        btn.textContent = "❌ " + (e && e.message ? e.message : "Error");
      }
    };
  })();
  `.trim();
}
