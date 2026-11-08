(() => {
  "use strict";

  const panel = document.getElementById("chat");
  if (!panel) return;

  const toggle = document.getElementById("chat-toggle");
  const closeButton = document.getElementById("chat-close");
  const log = document.getElementById("chat-log");
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const send = document.getElementById("chat-send");
  const status = document.getElementById("chat-status");
  const optionsToggle = document.getElementById("options-toggle");
  const optionsDialog = document.getElementById("options-dialog");
  const optionsForm = document.getElementById("options-form");
  const optionsSelect = document.getElementById("options-model");
  const history = [];
  let busy = false;
  let selectedModel = "auto";

  function fillModels(models) {
    optionsSelect.replaceChildren();
    const auto = document.createElement("option");
    auto.value = "auto";
    auto.textContent = "Auto (priority chain)";
    optionsSelect.append(auto);
    for (const model of models) {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.provider + " / " + model.model;
      optionsSelect.append(option);
    }
    optionsSelect.value = selectedModel;
  }

  function describeBackend(data) {
    if (!data.available) {
      return data.reason || "chat unavailable — set a provider key";
    }
    if (selectedModel === "auto") {
      const models = (data.models || data.providers || []).map((m) => m.id || m.provider);
      return "auto: " + models.join(" → ");
    }
    return "model: " + selectedModel;
  }

  function applyOptions(data) {
    selectedModel = data.selected || "auto";
    fillModels(data.models || []);
    status.textContent = describeBackend(data);
  }

  function closeNotepad() {
    const notepad = document.getElementById("notepad");
    if (!notepad || notepad.hidden) return;
    notepad.hidden = true;
    document.body.classList.remove("notepad-open");
    const notesToggle = document.getElementById("notepad-toggle");
    if (notesToggle) notesToggle.setAttribute("aria-expanded", "false");
  }

  function setOpen(open) {
    panel.hidden = !open;
    document.body.classList.toggle("chat-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    if (open) {
      closeNotepad();
      input.focus();
    }
  }

  toggle.addEventListener("click", () => setOpen(panel.hidden));
  closeButton.addEventListener("click", () => setOpen(false));

  const notesToggle = document.getElementById("notepad-toggle");
  if (notesToggle) notesToggle.addEventListener("click", () => setOpen(false));

  function bookHref(source) {
    const base =
      "/book/" +
      String(source.book || "")
        .split("/")
        .map(encodeURIComponent)
        .join("/");
    if (source.page) return base + "#p" + source.page;
    if (source.line) return base + "#L" + source.line;
    return base;
  }

  function sourceLabel(source) {
    const parts = [String(source.book || "").split("/").pop()];
    if (source.page) parts.push("p." + source.page);
    if (source.line) {
      const end = source.line_end && source.line_end !== source.line ? "-" + source.line_end : "";
      parts.push("lines " + source.line + end);
    }
    if (source.section) parts.push("§ " + source.section);
    return parts.filter(Boolean).join(" · ");
  }

  function addMessage(role, text, sources) {
    const node = document.createElement("div");
    node.className = "msg " + role;
    node.textContent = text;
    if (sources && sources.length) {
      const list = document.createElement("div");
      list.className = "sources";
      for (const source of sources) {
        const link = document.createElement("a");
        link.href = bookHref(source);
        link.textContent = sourceLabel(source);
        list.append(link);
      }
      node.append(list);
    }
    log.append(node);
    log.scrollTop = log.scrollHeight;
    return node;
  }

  async function ask(text) {
    const question = text.trim();
    if (busy || !question) return;
    busy = true;
    send.disabled = true;
    history.push({ role: "user", content: question });
    addMessage("user", question);
    input.value = "";
    const pending = addMessage("assistant", "…thinking");
    pending.classList.add("pending");
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: history,
          book: window.BookContext && window.BookContext.book,
          page: window.BookContext && window.BookContext.page,
          model: selectedModel,
        }),
      });
      const data = await response.json().catch(() => ({}));
      pending.remove();
      if (!response.ok) {
        history.pop();
        addMessage("assistant", "Error: " + (data.detail || response.statusText));
        return;
      }
      history.push({ role: "assistant", content: data.answer });
      addMessage("assistant", data.answer, data.sources);
      status.textContent = "answered by " + data.provider + "/" + data.model;
    } catch (error) {
      pending.remove();
      history.pop();
      addMessage("assistant", "Request failed.");
    } finally {
      busy = false;
      send.disabled = false;
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    ask(input.value);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      ask(input.value);
    }
  });

  optionsToggle.addEventListener("click", async () => {
    try {
      const data = await fetch("/api/chat/options").then((response) => response.json());
      selectedModel = data.selected || "auto";
      fillModels(data.models || []);
      optionsDialog.showModal();
    } catch (error) {
      status.textContent = "options unavailable";
    }
  });

  document.getElementById("options-cancel").addEventListener("click", () => {
    optionsDialog.close();
  });

  optionsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const response = await fetch("/api/chat/options", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: optionsSelect.value }),
      });
      const data = await response.json();
      if (!response.ok) {
        window.alert(data.detail || "cannot save the selection");
        return;
      }
      selectedModel = data.selected;
      optionsDialog.close();
      const refreshed = await fetch("/api/chat/status").then((r) => r.json());
      status.textContent = describeBackend(refreshed);
    } catch (error) {
      window.alert("cannot save the selection");
    }
  });

  fetch("/api/chat/options")
    .then((response) => response.json())
    .then(applyOptions)
    .catch(() => {
      status.textContent = "chat status unavailable";
    });
})();
