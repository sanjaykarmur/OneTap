(() => {
  "use strict";

  /* ---------- Storage keys ---------- */
  const K_COUNT = "onetap.count";
  const K_THEME = "onetap.theme";        // "light" | "dark" | "system"
  const K_GLASS = "onetap.glass";        // "on" | "off"
  const K_SOUND = "onetap.sound";        // "on" | "off"
  const K_HAPTIC = "onetap.haptic";      // "on" | "off"
  const K_FULLSCREEN = "onetap.fullscreen"; // "on" | "off"
  const K_WAKELOCK = "onetap.wakelock";  // "on" | "off"

  /* ---------- Elements ---------- */
  const els = {
    app: document.getElementById("app"),
    tapBtn: document.getElementById("tapBtn"),
    countDisplay: document.getElementById("countDisplay"),
    countAnnounce: document.getElementById("countAnnounce"),
    ripple: document.getElementById("ripple"),
    hint: document.getElementById("tapHint"),

    settingsBtn: document.getElementById("settingsBtn"),
    closeSettingsBtn: document.getElementById("closeSettingsBtn"),
    settingsSheet: document.getElementById("settingsSheet"),
    overlay: document.getElementById("overlay"),

    resetBtn: document.getElementById("resetBtn"),
    resetFromSettingsBtn: document.getElementById("resetFromSettingsBtn"),

    confirmOverlay: document.getElementById("confirmOverlay"),
    confirmDialog: document.getElementById("confirmDialog"),
    confirmCancelBtn: document.getElementById("confirmCancelBtn"),
    confirmOkBtn: document.getElementById("confirmOkBtn"),

    themeOpts: Array.from(document.querySelectorAll(".segmented__opt")),
    glassToggle: document.getElementById("glassToggle"),
    soundToggle: document.getElementById("soundToggle"),
    hapticToggle: document.getElementById("hapticToggle"),
    fullscreenToggle: document.getElementById("fullscreenToggle"),
    wakeLockToggle: document.getElementById("wakeLockToggle"),

    exportBtn: document.getElementById("exportBtn"),
    importBtn: document.getElementById("importBtn"),
    importFile: document.getElementById("importFile"),

    toast: document.getElementById("toast"),
  };

  /* ---------- Safe storage helpers ---------- */
  // localStorage can throw (private mode, quota, disabled). Never let that
  // crash a tap. We keep an in-memory fallback so the session still works.
  const memFallback = {};
  let storageOk = true;
  try {
    localStorage.setItem("__onetap_test__", "1");
    localStorage.removeItem("__onetap_test__");
  } catch (e) {
    storageOk = false;
  }

  function getItem(key, fallback) {
    if (storageOk) {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    }
    return key in memFallback ? memFallback[key] : fallback;
  }

  function setItem(key, value) {
    if (storageOk) {
      try {
        localStorage.setItem(key, value);
        return;
      } catch (e) {
        storageOk = false; // fall through to memory
      }
    }
    memFallback[key] = value;
  }

  /* ---------- Counter state ---------- */
  // Stored as a string to avoid float precision loss at very large values,
  // parsed as BigInt for math so "very large counter values" stay exact.
  function loadCount() {
    const raw = getItem(K_COUNT, "0");
    try {
      return BigInt(raw);
    } catch (e) {
      return 0n;
    }
  }

  let count = loadCount();
  let saveScheduled = false;

  function formatCount(n) {
    return n.toLocaleString("en-US");
  }

  function renderCount() {
    els.countDisplay.textContent = formatCount(count);
  }

  function persistCount() {
    // Writing a small string to localStorage is cheap; still batch with
    // requestAnimationFrame so a burst of rapid taps only writes once per
    // frame instead of once per tap, keeping taps snappy.
    if (saveScheduled) return;
    saveScheduled = true;
    requestAnimationFrame(() => {
      setItem(K_COUNT, count.toString());
      saveScheduled = false;
    });
  }

  function increment() {
    count += 1n;
    renderCount();
    persistCount();
    els.countAnnounce.textContent = formatCount(count);
    if (els.hint && count > 0n) {
      els.hint.style.visibility = "hidden";
    }
  }

  /* ---------- Tap interaction ---------- */
  function playTap() {
    increment();
    pulseButton();
    playSoundIfEnabled();
    hapticIfEnabled();
  }

  function pulseButton() {
    els.tapBtn.classList.remove("is-pressed");
    // force reflow so the class can be re-applied on rapid taps
    void els.tapBtn.offsetWidth;
    els.tapBtn.classList.add("is-pressed");
    els.ripple.classList.remove("animate");
    void els.ripple.offsetWidth;
    els.ripple.classList.add("animate");
    window.clearTimeout(pulseButton._t);
    pulseButton._t = window.setTimeout(() => {
      els.tapBtn.classList.remove("is-pressed");
    }, 160);
  }

  // Pointer events give us one clean signal per physical touch/click,
  // avoiding the double-fire of touchstart+click on mobile browsers.
  els.tapBtn.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button > 0) return; // ignore right/middle click
    playTap();
  });

  // Keyboard activation (Enter/Space) is handled natively for a <button>,
  // but we guard against double counting from the pointerdown above by
  // only listening to "click" for keyboard-originated activations.
  els.tapBtn.addEventListener("click", (e) => {
    if (e.detail === 0) {
      // detail === 0 means it was not triggered by a real mouse/touch click
      // (i.e. keyboard or assistive tech) — pointerdown won't have fired.
      playTap();
    }
  });

  // Desktop: Spacebar increases the count, unless focus is in a text field
  // or a dialog is open (settings / confirm), per spec.
  window.addEventListener("keydown", (e) => {
    if (e.code !== "Space" && e.key !== " ") return;
    const target = e.target;
    const tag = (target && target.tagName || "").toLowerCase();
    const isTyping = tag === "input" || tag === "textarea" || target?.isContentEditable;
    const dialogOpen = !els.settingsSheet.hidden || !els.confirmDialog.hidden;
    if (isTyping || dialogOpen) return;
    if (tag === "button") return; // avoid double-trigger if a button has focus (native Space already fires click)
    e.preventDefault();
    playTap();
  });

  /* ---------- Sound (Web Audio, no external file needed) ---------- */
  let audioCtx = null;
  function playSoundIfEnabled() {
    if (getItem(K_SOUND, "off") !== "on") return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = 720;
      gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, audioCtx.currentTime + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.09);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.1);
    } catch (e) {
      /* audio not available; fail silently */
    }
  }

  function hapticIfEnabled() {
    if (getItem(K_HAPTIC, "off") !== "on") return;
    if (navigator.vibrate) {
      try { navigator.vibrate(12); } catch (e) { /* ignore */ }
    }
  }

  /* ---------- Theme ---------- */
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

  function applyTheme(pref) {
    let effective = pref;
    if (pref === "system") {
      effective = systemDark.matches ? "dark" : "light";
    }
    document.documentElement.setAttribute("data-theme", effective);
    els.themeOpts.forEach((btn) => {
      const checked = btn.dataset.theme === pref;
      btn.setAttribute("aria-checked", String(checked));
    });
  }

  function setTheme(pref) {
    setItem(K_THEME, pref);
    applyTheme(pref);
  }

  systemDark.addEventListener?.("change", () => {
    if (getItem(K_THEME, "system") === "system") applyTheme("system");
  });

  els.themeOpts.forEach((btn) => {
    btn.addEventListener("click", () => setTheme(btn.dataset.theme));
  });

  /* ---------- Frosted glass toggle ---------- */
  function applyGlass(state) {
    document.documentElement.setAttribute("data-glass", state);
    els.glassToggle.setAttribute("aria-checked", String(state === "on"));
  }
  function setGlass(state) {
    setItem(K_GLASS, state);
    applyGlass(state);
  }
  els.glassToggle.addEventListener("click", () => {
    const current = getItem(K_GLASS, "on");
    setGlass(current === "on" ? "off" : "on");
  });

  /* ---------- Generic toggle helper ---------- */
  function wireToggle(btn, key, defaultVal, onChange) {
    function apply(v) {
      btn.setAttribute("aria-checked", String(v === "on"));
    }
    apply(getItem(key, defaultVal));
    btn.addEventListener("click", () => {
      const next = getItem(key, defaultVal) === "on" ? "off" : "on";
      setItem(key, next);
      apply(next);
      onChange?.(next);
    });
  }

  wireToggle(els.soundToggle, K_SOUND, "off");
  wireToggle(els.hapticToggle, K_HAPTIC, "off");

  /* ---------- Fullscreen ---------- */
  function updateFullscreenToggleUI() {
    const isFs = !!document.fullscreenElement;
    els.fullscreenToggle.setAttribute("aria-checked", String(isFs));
  }
  els.fullscreenToggle.addEventListener("click", async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        setItem(K_FULLSCREEN, "on");
      } else {
        await document.exitFullscreen();
        setItem(K_FULLSCREEN, "off");
      }
    } catch (e) {
      showToast("Fullscreen isn't available right now");
    }
    updateFullscreenToggleUI();
  });
  document.addEventListener("fullscreenchange", updateFullscreenToggleUI);

  /* ---------- Wake Lock ---------- */
  let wakeLock = null;
  async function requestWakeLock() {
    if (!("wakeLock" in navigator)) {
      showToast("Keep screen on isn't supported on this device");
      return false;
    }
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => {
        els.wakeLockToggle.setAttribute("aria-checked", "false");
      });
      return true;
    } catch (e) {
      return false;
    }
  }
  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }
  els.wakeLockToggle.addEventListener("click", async () => {
    const wantOn = els.wakeLockToggle.getAttribute("aria-checked") !== "true";
    if (wantOn) {
      const ok = await requestWakeLock();
      els.wakeLockToggle.setAttribute("aria-checked", String(ok));
      setItem(K_WAKELOCK, ok ? "on" : "off");
    } else {
      releaseWakeLock();
      els.wakeLockToggle.setAttribute("aria-checked", "false");
      setItem(K_WAKELOCK, "off");
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && getItem(K_WAKELOCK, "off") === "on" && !wakeLock) {
      requestWakeLock();
    }
  });

  /* ---------- Settings sheet open/close ---------- */
  let lastFocused = null;

  function openSettings() {
    lastFocused = document.activeElement;
    els.overlay.hidden = false;
    els.settingsSheet.hidden = false;
    requestAnimationFrame(() => {
      els.overlay.classList.add("show");
      els.settingsSheet.classList.add("show");
    });
    els.closeSettingsBtn.focus();
    document.addEventListener("keydown", onSettingsKeydown);
  }

  function closeSettings() {
    els.overlay.classList.remove("show");
    els.settingsSheet.classList.remove("show");
    document.removeEventListener("keydown", onSettingsKeydown);
    window.setTimeout(() => {
      els.overlay.hidden = true;
      els.settingsSheet.hidden = true;
    }, 260);
    (lastFocused || els.settingsBtn).focus();
  }

  function onSettingsKeydown(e) {
    if (e.key === "Escape") {
      closeSettings();
      return;
    }
    if (e.key === "Tab") trapFocus(e, els.settingsSheet);
  }

  function trapFocus(e, container) {
    const focusables = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  els.settingsBtn.addEventListener("click", openSettings);
  els.closeSettingsBtn.addEventListener("click", closeSettings);
  els.overlay.addEventListener("click", closeSettings);

  /* ---------- Confirm dialog (reset) ---------- */
  let confirmLastFocused = null;

  function openConfirm() {
    confirmLastFocused = document.activeElement;
    els.confirmOverlay.hidden = false;
    els.confirmDialog.hidden = false;
    requestAnimationFrame(() => {
      els.confirmOverlay.classList.add("show");
      els.confirmDialog.classList.add("show");
    });
    els.confirmCancelBtn.focus();
    document.addEventListener("keydown", onConfirmKeydown);
  }

  function closeConfirm() {
    els.confirmOverlay.classList.remove("show");
    els.confirmDialog.classList.remove("show");
    document.removeEventListener("keydown", onConfirmKeydown);
    window.setTimeout(() => {
      els.confirmOverlay.hidden = true;
      els.confirmDialog.hidden = true;
    }, 200);
    (confirmLastFocused || els.resetBtn).focus();
  }

  function onConfirmKeydown(e) {
    if (e.key === "Escape") closeConfirm();
    if (e.key === "Tab") trapFocus(e, els.confirmDialog);
  }

  function doReset() {
    count = 0n;
    renderCount();
    persistCount();
    els.countAnnounce.textContent = "Count reset to 0";
    if (els.hint) els.hint.style.visibility = "visible";
    closeConfirm();
    showToast("Count reset to 0");
  }

  els.resetBtn.addEventListener("click", openConfirm);
  els.resetFromSettingsBtn.addEventListener("click", () => {
    closeSettings();
    window.setTimeout(openConfirm, 220);
  });
  els.confirmCancelBtn.addEventListener("click", closeConfirm);
  els.confirmOkBtn.addEventListener("click", doReset);
  els.confirmOverlay.addEventListener("click", closeConfirm);

  /* ---------- Export / Import ---------- */
  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    requestAnimationFrame(() => els.toast.classList.add("show"));
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => {
      els.toast.classList.remove("show");
      window.setTimeout(() => { els.toast.hidden = true; }, 260);
    }, 2400);
  }

  els.exportBtn.addEventListener("click", () => {
    const payload = {
      app: "OneTap Counter",
      version: 1,
      count: count.toString(),
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = payload.exportedAt.slice(0, 10);
    a.href = url;
    a.download = `onetap-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast("Backup file saved");
  });

  els.importBtn.addEventListener("click", () => els.importFile.click());

  els.importFile.addEventListener("change", async () => {
    const file = els.importFile.files?.[0];
    els.importFile.value = ""; // allow re-selecting the same file later
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data == null || typeof data.count === "undefined") {
        throw new Error("Missing count field");
      }
      const restored = BigInt(String(data.count).replace(/[^0-9-]/g, ""));
      if (restored < 0n) throw new Error("Negative count");
      count = restored;
      renderCount();
      persistCount();
      if (els.hint) els.hint.style.visibility = count > 0n ? "hidden" : "visible";
      showToast("Count restored from backup");
    } catch (e) {
      showToast("That file couldn't be read as a backup");
    }
  });

  /* ---------- Init ---------- */
  function init() {
    renderCount();
    if (count > 0n && els.hint) els.hint.style.visibility = "hidden";

    applyTheme(getItem(K_THEME, "system"));
    els.themeOpts.forEach((btn) => {
      btn.setAttribute("aria-checked", String(btn.dataset.theme === getItem(K_THEME, "system")));
    });

    applyGlass(getItem(K_GLASS, "on"));
    wireToggle(els.soundToggle, K_SOUND, "off");
    wireToggle(els.hapticToggle, K_HAPTIC, "off");
    els.fullscreenToggle.setAttribute("aria-checked", "false");
    els.wakeLockToggle.setAttribute("aria-checked", String(getItem(K_WAKELOCK, "off") === "on"));
    if (getItem(K_WAKELOCK, "off") === "on") requestWakeLock();

    if (!storageOk) {
      showToast("Your browser is blocking saved data, so counts won't survive a restart");
    }

    // Register service worker for offline support.
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("service-worker.js").catch(() => {
          /* offline support unavailable; core app still works */
        });
      });
    }
  }

  // Persist immediately if the page is being hidden/closed mid-tap-burst,
  // in case the rAF-batched save hasn't flushed yet.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      setItem(K_COUNT, count.toString());
    }
  });
  window.addEventListener("pagehide", () => {
    setItem(K_COUNT, count.toString());
  });

  init();
})();
