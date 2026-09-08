/**
 * Professional UI polish — a layered stylesheet over the app's Tailwind
 * surfaces. Targets only the chrome (chat bar, power button, view chips,
 * header nav, scrollbars); the 3D scene and panel layouts are untouched.
 * The <style> tag survives React re-renders and is re-added if wiped.
 */
(function () {
  "use strict";

  const ID = "professional-ui";

  const CSS = `
/* ================= Professional UI polish ================= */

::selection { background: rgba(56,189,248,.35); color: #fff; }

button:focus-visible, input:focus-visible {
  outline: 2px solid rgba(56,189,248,.55);
  outline-offset: 2px;
  border-radius: 8px;
}

/* ---- Chat bar: deep glass with a lit top edge ---- */
footer form:has(> input),
footer div:has(> input) {
  background: linear-gradient(180deg, rgba(10,14,22,.74), rgba(6,9,16,.68)) !important;
  border: 1px solid rgba(255,255,255,.14) !important;
  border-radius: 18px !important;
  box-shadow:
    0 14px 34px -14px rgba(0,0,0,.65),
    inset 0 1px 0 rgba(255,255,255,.07) !important;
  backdrop-filter: blur(18px) saturate(1.25);
  transition: border-color .25s ease, box-shadow .25s ease;
}
footer form:has(> input):focus-within,
footer div:has(> input):focus-within {
  border-color: rgba(56,189,248,.45) !important;
  box-shadow:
    0 14px 38px -14px rgba(0,0,0,.7),
    0 0 0 3px rgba(56,189,248,.10),
    inset 0 1px 0 rgba(255,255,255,.08) !important;
}
footer input::placeholder { color: rgba(255,255,255,.34) !important; }

/* ---- Send button: unified cyan identity, honest disabled state ---- */
footer button[aria-label*="send message" i] {
  border-radius: 12px !important;
  background: linear-gradient(180deg, rgba(34,211,238,.28), rgba(14,165,233,.20)) !important;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.18),
    0 4px 14px -4px rgba(34,211,238,.45) !important;
  transition: transform .15s ease, filter .2s ease, opacity .2s ease;
}
footer button[aria-label*="send message" i]:hover:not(:disabled) { filter: brightness(1.12); }
footer button[aria-label*="send message" i]:active:not(:disabled) { transform: scale(.94); }
footer button[aria-label*="send message" i]:disabled {
  opacity: .35;
  filter: saturate(.4);
  box-shadow: none !important;
}

/* ---- Power button: layered presence + glow ---- */
button[class*="w-20"][class*="h-20"] {
  background: radial-gradient(circle at 35% 30%, rgba(255,255,255,.16), rgba(255,255,255,.06) 60%) !important;
  border: 1px solid rgba(255,255,255,.18) !important;
  box-shadow:
    0 12px 36px -12px rgba(0,0,0,.75),
    inset 0 1px 0 rgba(255,255,255,.14) !important;
  backdrop-filter: blur(8px);
  transition: transform .25s cubic-bezier(.2,.8,.3,1.2), box-shadow .3s ease, background .3s ease !important;
}
button[class*="w-20"][class*="h-20"]:hover {
  box-shadow:
    0 16px 42px -12px rgba(0,0,0,.8),
    inset 0 1px 0 rgba(255,255,255,.18),
    0 0 26px -6px rgba(56,189,248,.35) !important;
}
button[class*="w-20"][class*="h-20"]:active { transform: scale(.93); }

/* ---- View chips: one consistent glass language ---- */
button[class*="text-[9px]"] {
  background: rgba(255,255,255,.055) !important;
  border-color: rgba(255,255,255,.12) !important;
  border-radius: 8px !important;
  color: rgba(203,213,225,.85) !important;
  transition: background .2s ease, color .2s ease, border-color .2s ease, transform .2s ease !important;
}
button[class*="text-[9px]"]:hover {
  background: rgba(255,255,255,.10) !important;
  color: #fff !important;
  border-color: rgba(56,189,248,.40) !important;
  transform: translateY(-1px);
}

/* ---- Header nav: legible at rest, alive on hover ---- */
header button { opacity: .5; transition: opacity .25s ease; }
header button:hover { opacity: 1; }

/* ---- Scrollbars: thin, dark, unobtrusive ---- */
*::-webkit-scrollbar { width: 8px; height: 8px; }
*::-webkit-scrollbar-track { background: transparent; }
*::-webkit-scrollbar-thumb { background: rgba(255,255,255,.14); border-radius: 99px; }
*::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.24); }
`;

  function ensure() {
    if (document.getElementById(ID)) return;
    const style = document.createElement("style");
    style.id = ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  ensure();
  new MutationObserver(ensure).observe(document.documentElement, { childList: true, subtree: false });
  setInterval(ensure, 4000);
})();
