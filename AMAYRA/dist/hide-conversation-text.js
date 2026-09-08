/**
 * AMAYRA — hide the live conversation text overlay.
 *
 * While AMAYRA talks (or transcribes the user), the renderer shows the
 * transcript as a large centred text block over the model
 * (div.relative.z-25 > h2.font-display.max-w-2xl). This request asks for that
 * text to be hidden so the model stays visible; everything else stays as-is.
 *
 * A <style> rule survives React re-renders (React does not manage this node).
 */
(function () {
  "use strict";
  var style = document.createElement("style");
  style.id = "amayra-hide-conversation-text";
  style.textContent = [
    "div.relative.z-25.mt-auto { display: none !important; }",
    "main h2.font-display { display: none !important; }",
  ].join("\n");
  function install() {
    if (!document.getElementById("amayra-hide-conversation-text")) {
      document.head.appendChild(style);
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install);
  } else {
    install();
  }
})();
