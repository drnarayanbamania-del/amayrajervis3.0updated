/**
 * AMAYRA — API Keys panel (appended to the built renderer bundle).
 *
 * Adds an "API KEYS" section inside the SETTINGS panel's VOICE tab (the tab
 * where the Gemini key is introduced) so Groq / DeepSeek / OpenAI keys can be
 * added manually, exactly like the Gemini key. Fallback order:
 *   1. Gemini  2. Groq  3. DeepSeek  4. OpenAI
 *
 * Implementation notes:
 *  - The bundle is minified React (jsx runtime `b`, framer-motion `mn`).
 *  - A MutationObserver on <body> injects the section into the VOICE tab
 *    whenever the settings panel opens (the panel is recreated on open).
 *  - The Gemini card links to the existing onboarding flow ("Connect Memory
 *    Core"); the other three cards save through /api/config/providers/:id/key.
 */
(function () {
  "use strict";

  var PROVIDERS = [
    { id: "gemini", label: "Google Gemini", model: "gemini-3.5-flash", order: 1, note: "Primary brain + live voice", link: true },
    { id: "groq", label: "Groq", model: "llama-3.3-70b-versatile", order: 2, note: "Fallback 1 — free tier, very fast", url: "https://console.groq.com/keys" },
    { id: "deepseek", label: "DeepSeek", model: "deepseek-chat", order: 3, note: "Fallback 2", url: "https://platform.deepseek.com/api_keys" },
    { id: "openai", label: "OpenAI", model: "gpt-4o-mini", order: 4, note: "Fallback 3", url: "https://platform.openai.com/api-keys" },
  ];

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "style" && typeof attrs[k] === "object") {
          Object.keys(attrs[k]).forEach(function (s) { el.style[s] = attrs[k][s]; });
        } else if (k === "className") {
          el.className = attrs[k];
        } else if (k.indexOf("on") === 0 && typeof attrs[k] === "function") {
          el.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else if (attrs[k] !== undefined && attrs[k] !== null) {
          el.setAttribute(k, String(attrs[k]));
        }
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return el;
  }

  function fetchJson(url, opts) {
    return fetch(url, opts).then(function (r) {
      return r.text().then(function (t) {
        var data = {};
        try { data = t ? JSON.parse(t) : {}; } catch (e) { data = { error: t }; }
        if (!r.ok) throw new Error(data.error || ("HTTP " + r.status));
        return data;
      });
    });
  }

  var statusCache = null;

  function loadStatus() {
    return fetchJson("/api/config/providers").then(function (data) {
      statusCache = data.providers || [];
      return statusCache;
    });
  }

  function providerRow(p, refresh) {
    var st = (statusCache || []).filter(function (s) { return s.id === p.id; })[0] || {};
    var hasKey = !!st.hasKey;
    var cooldown = st.cooldownRemainingMs > 0;

    var badge = h("span", {
      className: "text-[9px] font-mono px-2 py-0.5 rounded-full border " +
        (hasKey
          ? (cooldown ? "border-amber-400/40 text-amber-300 bg-amber-400/10" : "border-emerald-400/40 text-emerald-300 bg-emerald-400/10")
          : "border-slate-500/40 text-slate-400 bg-slate-500/10"),
    }, [hasKey ? (cooldown ? "COOLDOWN" : "ACTIVE") : "NOT SET"]);

    var header = h("div", { className: "flex items-center justify-between gap-2" }, [
      h("div", { className: "flex items-center gap-2" }, [
        h("span", { className: "text-[9px] font-mono text-cyan-400" }, ["#" + p.order]),
        h("span", { className: "text-xs font-mono text-white" }, [p.label]),
        badge,
      ]),
      hasKey
        ? h("button", {
            className: "text-[9px] font-mono text-rose-300 hover:text-rose-200 uppercase tracking-wider",
            onclick: function () {
              if (!window.confirm("Remove the saved " + p.label + " API key from this PC?")) return;
              fetchJson("/api/config/providers/" + p.id + "/key", { method: "DELETE" })
                .then(refresh)["catch"](function () {});
            },
          }, ["Remove"])
        : null,
    ]);

    var modelLine = h("div", { className: "text-[9px] font-mono text-slate-500" }, [
      p.note + " · model: " + p.model + (cooldown ? " · quota cooldown active, skipped in fallback" : ""),
    ]);

    var body;
    if (p.link) {
      body = h("div", { className: "text-[10px] font-mono text-slate-400 leading-relaxed" }, [
        "Primary provider. Manage it with the CONNECT MEMORY CORE button on the main screen — ",
        "the same key powers voice, memory and tools. If its daily quota runs out, AMAYRA ",
        "automatically continues on the fallback providers below.",
      ]);
    } else {
      var input = h("input", {
        type: "password",
        placeholder: "Paste " + p.label + " API key…",
        className: "flex-1 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-xs text-white font-mono focus:outline-none focus:border-cyan-400/50 transition",
        style: { minWidth: "0" },
      });
      var saveBtn = h("button", {
        className: "px-3 py-1.5 rounded-lg border border-cyan-400/30 bg-cyan-400/10 text-[10px] font-mono uppercase tracking-wider text-cyan-200 hover:bg-cyan-400/20 transition",
      }, ["Save"]);
      var msg = h("span", { className: "text-[9px] font-mono" }, []);

      function setMsg(text, ok) {
        msg.textContent = text;
        msg.className = "text-[9px] font-mono " + (ok ? "text-emerald-300" : "text-rose-300");
      }

      saveBtn.addEventListener("click", function () {
        var key = input.value.trim();
        if (!key) { setMsg("Paste a key first.", false); return; }
        saveBtn.textContent = "Saving…";
        saveBtn.setAttribute("disabled", "true");
        setMsg("Validating…", true);
        fetchJson("/api/config/providers/" + p.id + "/key", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: key }),
        })
          .then(function () {
            input.value = "";
            setMsg("Saved ✓ fallback ready", true);
            return loadStatus().then(refresh);
          })
          ["catch"](function (e) { setMsg(String(e.message || e).slice(0, 90), false); })
          .then(function () {
            saveBtn.textContent = "Save";
            saveBtn.removeAttribute("disabled");
          });
      });

      body = h("div", { className: "space-y-1.5" }, [
        h("div", { className: "flex gap-2 items-center" }, [input, saveBtn]),
        h("div", { className: "flex items-center gap-2" }, [
          msg,
          p.url ? h("a", {
            href: p.url,
            target: "_blank",
            rel: "noreferrer",
            className: "text-[9px] font-mono text-indigo-300 hover:text-indigo-200",
          }, ["Get a key ↗"]) : null,
        ]),
      ]);
    }

    return h("div", { className: "p-3 rounded-xl border border-white/5 bg-white/5 space-y-2" }, [
      header, modelLine, body,
    ]);
  }

  function buildSection(refresh) {
    var grid = h("div", { className: "space-y-2" }, []);
    function renderAll() {
      grid.replaceChildren.apply(grid, PROVIDERS.map(function (p) { return providerRow(p, renderAll); }));
    }
    renderAll();
    return h("div", { className: "space-y-3" }, [
      h("div", { className: "text-[10px] font-mono uppercase tracking-widest text-slate-500" }, [
        "Model API Keys — Fallback Chain",
      ]),
      h("div", { className: "p-3 rounded-xl border border-cyan-400/15 bg-cyan-400/5" }, [
        h("div", { className: "text-[10px] font-mono text-cyan-200 leading-relaxed" }, [
          "AMAYRA thinks on Gemini first. If its quota is exhausted (or the key fails), she automatically ",
          "switches to the next provider with a saved key — Groq → DeepSeek → OpenAI — so voice chat, ",
          "memory and Telegram keep working. Failing providers rest for 1 hour, then retry.",
        ]),
      ]),
      grid,
    ]);
  }

  function injectIntoVoiceTab() {
    if (document.getElementById("amayra-apikeys-section")) return;
    // The VOICE tab is the one containing the "Wake Phrase" input.
    var labels = Array.prototype.slice.call(document.querySelectorAll("label"));
    var wakeLabel = labels.filter(function (l) { return /wake phrase/i.test(l.textContent || ""); })[0];
    if (!wakeLabel) return;
    var tab = wakeLabel.closest("div.space-y-4") || wakeLabel.closest("div");
    if (!tab) return;

    var section = h("div", { id: "amayra-apikeys-section", className: "space-y-3" }, []);
    function refresh() { loadStatus().then(function () { section.replaceChildren(buildSection(refresh)); })["catch"](function () {}); }
    refresh();
    // API Keys go at the TOP of the voice tab so they are immediately visible.
    tab.insertBefore(section, tab.firstChild);
  }

  // The VOICE tab re-renders under React (mic device list, sliders), which can
  // discard a node we injected once. Watch for mutations AND re-inject on a
  // low-frequency tick so the section reliably stays visible while the panel
  // is open, and stops as soon as the panel closes.
  var watchdog = null;
  function wakeLabel() {
    return Array.prototype.slice.call(document.querySelectorAll("label"))
      .filter(function (l) { return /wake phrase/i.test(l.textContent || ""); })[0];
  }
  function ensure() {
    // Stop once the settings panel closes (no VOICE tab any more).
    if (!wakeLabel()) {
      if (watchdog) { clearInterval(watchdog); watchdog = null; }
      return;
    }
    try { injectIntoVoiceTab(); } catch (e) { /* keep the panel functional */ }
  }
  function startWatchdog() {
    if (watchdog) return;
    watchdog = setInterval(ensure, 700);
  }
  function init() {
    // The settings panel may already be open when this script first runs.
    ensure();
    var observer = new MutationObserver(function () {
      // Re-arm when the panel content changes; keep the section topped-up.
      if (wakeLabel() && !document.getElementById("amayra-apikeys-section")) {
        startWatchdog();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  // This script is loaded from <head>, before <body> exists — defer the
  // observer setup until the DOM is ready, or the IIFE throws on null body
  // and the whole panel never injects.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
