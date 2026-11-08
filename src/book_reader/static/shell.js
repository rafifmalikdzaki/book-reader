(() => {
  "use strict";

  const PANELS = ["contents", "notepad", "chat"];
  let lastFocus = null;

  function panel(id) {
    return document.getElementById(id);
  }

  function isMobile() {
    return window.matchMedia("(max-width: 900px)").matches;
  }

  function syncBodyClass() {
    const open = PANELS.some((id) => {
      const element = panel(id);
      return element && !element.hidden;
    });
    document.body.classList.toggle("panel-open", open && isMobile());
  }

  function focusables(element) {
    return Array.from(
      element.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"),
    ).filter((node) => !node.disabled && node.offsetParent !== null);
  }

  function open(id, toggleId) {
    const element = panel(id);
    if (!element) return;
    if (element.hidden) {
      lastFocus = document.activeElement;
      for (const other of PANELS) {
        if (other !== id) close(other, true);
      }
      element.hidden = false;
      const toggle = toggleId ? document.getElementById(toggleId) : null;
      if (toggle) toggle.setAttribute("aria-expanded", "true");
      const target = element.querySelector("input, textarea, select, button");
      if (target) target.focus({ preventScroll: true });
      element.dispatchEvent(new CustomEvent("panel-open"));
    }
    syncBodyClass();
  }

  function close(id, silent) {
    const element = panel(id);
    if (!element || element.hidden) {
      syncBodyClass();
      return;
    }
    element.hidden = true;
    for (const button of document.querySelectorAll(`[aria-controls="${id}"]`)) {
      button.setAttribute("aria-expanded", "false");
    }
    if (!silent) {
      const previous = lastFocus;
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    }
    syncBodyClass();
  }

  function toggle(id, toggleId) {
    const element = panel(id);
    if (!element) return;
    if (element.hidden) open(id, toggleId);
    else close(id);
  }

  document.addEventListener("click", (event) => {
    const closer = event.target.closest("[data-close]");
    if (closer) close(closer.dataset.close);
  });

  document.getElementById("notepad-toggle")?.addEventListener("click", () => toggle("notepad"));
  document.getElementById("chat-toggle")?.addEventListener("click", () => toggle("chat"));

  /* ---- resizable chat rail ---- */
  const chatRail = document.getElementById("chat");
  const railHandle = document.getElementById("chat-rail-handle");
  const RAIL_KEY = "br-chat-rail-width";
  const RAIL_MIN = 300;
  const RAIL_MAX = 640;
  const RAIL_DEFAULT = 360;
  const railDesktop = window.matchMedia("(min-width: 901px)");

  function clampRail(value) {
    return Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(value)));
  }

  function storedRailWidth() {
    const stored = Number.parseFloat(localStorage.getItem(RAIL_KEY));
    return Number.isFinite(stored) ? clampRail(stored) : RAIL_DEFAULT;
  }

  function setRailWidth(value, persist) {
    if (!chatRail) return;
    const width = clampRail(value);
    if (railDesktop.matches) {
      chatRail.style.width = `${width}px`;
      chatRail.style.flexBasis = `${width}px`;
    } else {
      chatRail.style.width = "";
      chatRail.style.flexBasis = "";
    }
    railHandle?.setAttribute("aria-valuenow", String(width));
    if (persist) localStorage.setItem(RAIL_KEY, String(width));
  }

  if (chatRail && railHandle) {
    setRailWidth(storedRailWidth(), false);
    let dragStartX = 0;
    let dragStartWidth = 0;
    let dragging = false;

    railHandle.addEventListener("pointerdown", (event) => {
      if (!railDesktop.matches) return;
      event.preventDefault();
      dragging = true;
      dragStartX = event.clientX;
      dragStartWidth = chatRail.getBoundingClientRect().width;
      railHandle.setPointerCapture(event.pointerId);
      document.body.classList.add("rail-resizing");
    });
    railHandle.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      setRailWidth(dragStartWidth + dragStartX - event.clientX, false);
    });
    function endRailDrag(event) {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("rail-resizing");
      if (railHandle.hasPointerCapture(event.pointerId)) {
        railHandle.releasePointerCapture(event.pointerId);
      }
      setRailWidth(Number.parseFloat(chatRail.style.width) || storedRailWidth(), true);
    }
    railHandle.addEventListener("pointerup", endRailDrag);
    railHandle.addEventListener("pointercancel", endRailDrag);
    railHandle.addEventListener("keydown", (event) => {
      let next = null;
      if (event.key === "ArrowLeft") next = storedRailWidth() + 16;
      else if (event.key === "ArrowRight") next = storedRailWidth() - 16;
      else if (event.key === "Home") next = RAIL_MIN;
      else if (event.key === "End") next = RAIL_MAX;
      if (next === null) return;
      event.preventDefault();
      setRailWidth(next, true);
    });
    railDesktop.addEventListener("change", () => setRailWidth(storedRailWidth(), false));
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const openPanels = PANELS.filter((id) => panel(id) && !panel(id).hidden);
      if (openPanels.length) {
        event.preventDefault();
        close(openPanels[openPanels.length - 1]);
        return;
      }
    }
    if (event.key !== "Tab") return;
    const active = PANELS.map(panel).find((element) => element && !element.hidden);
    if (!active) return;
    const list = focusables(active);
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  /* ---- lamp ---- */
  const lamp = document.getElementById("lamp-toggle");
  const lampOn = localStorage.getItem("br-lamp") === "on";
  document.body.classList.toggle("lamp-off", lampOn);
  if (lamp) {
    lamp.setAttribute("aria-pressed", String(lampOn));
    lamp.addEventListener("click", () => {
      const next = !document.body.classList.contains("lamp-off");
      document.body.classList.toggle("lamp-off", next);
      localStorage.setItem("br-lamp", next ? "on" : "off");
      lamp.setAttribute("aria-pressed", String(next));
    });
  }

  /* ---- one library search field ---- */
  const input = document.getElementById("global-search");
  if (input && window.matchMedia("(max-width: 900px)").matches) {
    input.placeholder = "Search…";
  }
  let searchTimer = null;
  function emitSearch(inside) {
    if (!input) return;
    const term = input.value.trim();
    clearTimeout(searchTimer);
    window.dispatchEvent(
      new CustomEvent("library-search", { detail: { term, inside } }),
    );
  }
  input?.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => emitSearch(false), 200);
  });
  input?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const term = input.value.trim();
    if (!term) return;
    if (window.location.pathname !== "/") {
      window.location.href = "/?q=" + encodeURIComponent(term) + "&inside=1";
    } else {
      searchTimer = null;
      emitSearch(true);
    }
  });

  const params = new URLSearchParams(window.location.search);
  const arrivingQ = params.get("q")?.trim() || "";
  if (input && arrivingQ) {
    input.value = arrivingQ;
    const inside = params.get("inside") === "1";
    const replay = () => emitSearch(inside);
    if (document.readyState === "loading") {
      window.addEventListener("DOMContentLoaded", replay, { once: true });
    } else {
      replay();
    }
  }

  /* ---- options dialog (model choice) ---- */
  const dialog = document.getElementById("options-dialog");
  const select = document.getElementById("options-model");
  const form = document.getElementById("options-form");
  document.getElementById("options-toggle")?.addEventListener("click", async () => {
    try {
      const data = await fetch("/api/chat/options").then((response) => response.json());
      select.replaceChildren();
      const auto = document.createElement("option");
      auto.value = "auto";
      auto.textContent = "Auto — follow the provider chain";
      select.append(auto);
      for (const model of data.models || []) {
        const option = document.createElement("option");
        option.value = model.id;
        option.textContent = model.provider + " · " + model.model;
        select.append(option);
      }
      select.value = data.selected || "auto";
      dialog.showModal();
    } catch (error) {
      window.dispatchEvent(new CustomEvent("chat-error", { detail: "Options unavailable." }));
    }
  });
  document.getElementById("options-cancel")?.addEventListener("click", () => dialog.close());
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const response = await fetch("/api/chat/options", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: select.value }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Cannot save the selection");
      dialog.close();
      window.dispatchEvent(new CustomEvent("chat-options-changed", { detail: data.selected }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent("chat-error", { detail: error.message }));
    }
  });

  const reindex = document.getElementById("reindex-library");
  const reindexStatus = document.getElementById("reindex-status");
  reindex?.addEventListener("click", async () => {
    reindex.disabled = true;
    reindexStatus.textContent = "Reindexing…";
    try {
      const response = await fetch("/api/library/reindex", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Reindex failed");
      reindexStatus.textContent = data.notice || "Everything is up to date.";
      window.Shell.toast(data.notice || "Reindex complete.");
    } catch (error) {
      reindexStatus.textContent = error.message;
    } finally {
      reindex.disabled = false;
    }
  });

  let toastTimer = null;
  window.Shell = {
    open,
    close,
    toggle,
    toast(message) {
      const node = document.getElementById("toast");
      if (!node) return;
      node.textContent = message;
      node.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { node.hidden = true; }, 2600);
    },
    get searchMode() { return mode; },
  };
})();
