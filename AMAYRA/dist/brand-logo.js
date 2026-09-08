/**
 * Bamania's Tech brand logo — stacked above the AMAYRA title in the top
 * header, plus a small mark beside the footer's "powered by" line.
 * React re-renders wipe arbitrary nodes, so light watchdogs re-insert both
 * brand blocks whenever the header/footer exist without them (same pattern
 * as api-keys-panel.js).
 */
(function () {
  "use strict";

  const MARKER = "data-brand-logo";

  function makeLogo(heightPx) {
    const img = document.createElement("img");
    img.src = "/bamanias-tech-logo.png";
    img.alt = "Bamania's Tech";
    img.style.cssText = [
      `height:${heightPx}px`,
      "width:auto",
      "display:block",
      "filter:drop-shadow(0 2px 6px rgba(0,0,0,0.55))",
      "pointer-events:none",
      "-webkit-user-drag:none",
      "user-select:none",
    ].join(";");
    img.draggable = false;
    return img;
  }

  function buildHeaderBrand() {
    const wrap = document.createElement("div");
    wrap.setAttribute(MARKER, "");
    wrap.style.cssText = [
      "display:flex",
      "flex-direction:column",
      "align-items:flex-start",
      "gap:6px",
      "pointer-events:none",
    ].join(";");

    wrap.appendChild(makeLogo(48));

    const label = document.createElement("span");
    label.textContent = "AMAYRA";
    label.style.cssText = [
      "font-size:0.875rem",
      "font-weight:600",
      "letter-spacing:0.4em",
      "text-transform:uppercase",
      "color:rgba(255,255,255,0.5)",
      "font-family:inherit",
      "line-height:1",
    ].join(";");
    wrap.appendChild(label);
    return wrap;
  }

  function injectHeader() {
    const header = document.querySelector("header");
    if (!header || header.querySelector(`[${MARKER}]`)) return;
    // The AMAYRA title is the header's first span; its parent is the left group.
    const span = header.querySelector("span");
    const group = span ? span.parentElement : header.firstChild;
    if (!group || !group.parentElement) return;
    group.replaceWith(buildHeaderBrand());
  }

  function injectFooter() {
    const footer = document.querySelector("footer");
    if (!footer) return;
    if (footer.querySelector(`[${MARKER}]`)) return;
    if (!/powered by/i.test(footer.textContent || "")) return;
    const img = makeLogo(16);
    img.setAttribute(MARKER, "");
    // Inline beside the powered-by text, sized to the text line so the
    // footer's height (and its overlap with the hint bar) never changes.
    img.style.display = "inline-block";
    img.style.verticalAlign = "middle";
    img.style.margin = "0 7px 2px 0";
    img.style.filter = "drop-shadow(0 1px 3px rgba(0,0,0,0.5))";
    footer.insertBefore(img, footer.firstChild);
  }

  /**
   * Collision guard: the app's WASD hint bar and the powered-by line are
   * both bottom-anchored; at short window heights they share the same band
   * and the inline logo pokes into the hint text. When they would overlap,
   * fade the hint bar out (it comes back automatically at taller sizes).
   */
  function layoutGuard() {
    const footer = Array.from(document.querySelectorAll("footer"))
      .find((f) => /powered by/i.test(f.textContent || ""));
    if (!footer) return;
    const hint = Array.from(document.querySelectorAll("div, p, section"))
      .filter((el) => {
        const t = el.textContent || "";
        return t.includes("WASD rotate") && t.length < 200 && !t.includes("powered by");
      })
      .sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height)[0];
    if (!hint) return;
    const fb = footer.getBoundingClientRect();
    const hb = hint.getBoundingClientRect();
    const overlaps =
      fb.left < hb.right && hb.left < fb.right &&
      fb.top < hb.bottom && hb.top < fb.bottom;
    hint.style.transition = "opacity 0.3s ease";
    hint.style.opacity = overlaps ? "0" : "";
    hint.style.pointerEvents = overlaps ? "none" : "";
  }

  // Watch for React re-renders that remove the brand blocks.
  const obs = new MutationObserver(() => {
    injectHeader();
    injectFooter();
  });
  function boot() {
    injectHeader();
    injectFooter();
    layoutGuard();
    const header = document.querySelector("header");
    if (header) {
      obs.observe(header, { childList: true, subtree: true });
    } else {
      requestAnimationFrame(boot);
      return;
    }
    const footer = document.querySelector("footer");
    if (footer) obs.observe(footer, { childList: true, subtree: false });
  }
  boot();
  setInterval(() => {
    injectHeader();
    injectFooter();
    layoutGuard();
  }, 4000); // cheap safety net for late swaps
  window.addEventListener("resize", layoutGuard);
})();
