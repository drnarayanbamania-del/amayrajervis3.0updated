/**
 * AMAYRA — morning keep-awake client (appended to the built renderer).
 *
 * Two jobs:
 *  1. Poll /api/scheduler/morning every 30s; when a wake is due and AMAYRA
 *     is asleep, click her existing "Awake Amayra" power button so the Live
 *     session opens through the app's normal flow. The server then speaks
 *     the greeting into that session.
 *  2. Inject a "MORNING WAKE-UP" card into the SETTINGS → VOICE tab with an
 *     on/off toggle and the wake time (HH:MM), saved via the same endpoint.
 */
(function () {
  "use strict";

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

  // ---------------------------------------------------------------------------
  // 1. Auto-wake poller
  // ---------------------------------------------------------------------------
  var lastAutoWakeAttemptAt = 0;

  function tryAutoWake() {
    // One attempt per minute max, even if the poller says due.
    if (Date.now() - lastAutoWakeAttemptAt < 60_000) return;
    var wakeBtn = document.querySelector('button[title="Awake Amayra"]');
    if (!wakeBtn) return; // already awake, connecting, or button not rendered
    lastAutoWakeAttemptAt = Date.now();
    wakeBtn.click();
    console.log("[MorningScheduler] Wake due — auto-awakening AMAYRA.");
  }

  function poll() {
    fetchJson("/api/scheduler/morning")
      .then(function (s) {
        if (s && s.enabled && s.dueNow) return fetchJson("/api/config").then(function (c) {
          if (c && c.hasApiKey) tryAutoWake();
        });
      })
      .catch(function () { /* server briefly unavailable — retry next poll */ });
  }
  setInterval(poll, 30_000);
  setTimeout(poll, 5_000); // shortly after boot

  // ---------------------------------------------------------------------------
  // 2. SETTINGS → VOICE card
  // ---------------------------------------------------------------------------
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

  var state = { enabled: false, time: "08:00" };

  function renderCard(refresh) {
    var toggle = h("button", {
      className: "px-3 py-1.5 rounded-lg border text-[10px] font-mono uppercase tracking-wider transition " +
        (state.enabled
          ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
          : "border-slate-500/40 bg-slate-500/10 text-slate-300"),
      onclick: function () {
        toggle.textContent = "Saving…";
        fetchJson("/api/scheduler/morning", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: !state.enabled }),
        })
          .then(function (s) { state = s; })
          ["catch"](function () {})
          .then(refresh);
      },
    }, [state.enabled ? "ON — she'll wake herself" : "OFF"]);

    var timeInput = h("input", {
      type: "time",
      value: state.time,
      className: "px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-xs text-white font-mono focus:outline-none focus:border-cyan-400/50 transition",
      onchange: function () {
        var v = timeInput.value;
        if (!v) return;
        timeInput.setAttribute("disabled", "true");
        fetchJson("/api/scheduler/morning", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ time: v }),
        })
          .then(function (s) { state = s; })
          ["catch"](function (e) { console.warn("[MorningScheduler] time save failed:", e && e.message); })
          .then(function () {
            timeInput.removeAttribute("disabled");
            refresh();
          });
      },
    });

    return h("div", { className: "p-3 rounded-xl border border-white/5 bg-white/5 space-y-2" }, [
      h("div", { className: "flex items-center justify-between gap-2" }, [
        h("div", { className: "flex items-center gap-2" }, [
          h("span", { className: "text-xs font-mono text-white" }, ["Morning wake-up"]),
          h("span", {
            className: "text-[9px] font-mono px-2 py-0.5 rounded-full border " +
              (state.enabled
                ? "border-emerald-400/40 text-emerald-300 bg-emerald-400/10"
                : "border-slate-500/40 text-slate-400 bg-slate-500/10"),
          }, [state.enabled ? "SCHEDULED " + state.time : "DISABLED"]),
        ]),
        toggle,
      ]),
      h("div", { className: "flex items-center gap-3" }, [
        h("span", { className: "text-[9px] font-mono text-slate-500" }, ["Wake time"]),
        timeInput,
      ]),
      h("div", { className: "text-[10px] font-mono text-slate-400 leading-relaxed" }, [
        "At this time AMAYRA wakes on her own and greets you on the voice call. If the app wasn't open at wake time (PC was off), she sends the greeting to your Telegram instead the next time the app starts.",
      ]),
    ]);
  }

  function injectIntoVoiceTab() {
    if (document.getElementById("amayra-morning-section")) return;
    var labels = Array.prototype.slice.call(document.querySelectorAll("label"));
    var wakeLabel = labels.filter(function (l) { return /wake phrase/i.test(l.textContent || ""); })[0];
    if (!wakeLabel) return;
    var tab = wakeLabel.closest("div.space-y-4") || wakeLabel.closest("div");
    if (!tab) return;

    function refresh() {
      fetchJson("/api/scheduler/morning")
        .then(function (s) { state = s; })
        ["catch"](function () {})
        .then(function () {
          var existing = document.getElementById("amayra-morning-card");
          if (existing) existing.remove();
          section.replaceChildren(
            h("div", { className: "text-[10px] font-mono uppercase tracking-widest text-slate-500" }, ["Morning Keep-Awake"]),
            h("div", { id: "amayra-morning-card" }, [renderCard(refresh)]),
          );
        });
    }

    var section = h("div", { id: "amayra-morning-section", className: "space-y-3" }, []);
    refresh();
    // Below the API-keys section if present, else at the top.
    var apiKeys = document.getElementById("amayra-apikeys-section");
    if (apiKeys && apiKeys.nextSibling) tab.insertBefore(section, apiKeys.nextSibling);
    else if (apiKeys) tab.appendChild(section);
    else tab.insertBefore(section, tab.firstChild);
  }

  var watchdog = null;
  function voiceTabPresent() {
    return Array.prototype.slice.call(document.querySelectorAll("label"))
      .some(function (l) { return /wake phrase/i.test(l.textContent || ""); });
  }
  function ensure() {
    if (!voiceTabPresent()) {
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
    ensure();
    var observer = new MutationObserver(function () {
      if (voiceTabPresent() && !document.getElementById("amayra-morning-section")) {
        startWatchdog();
      }
    });
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
