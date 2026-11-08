(() => {
  "use strict";

  const panel = document.getElementById("chat");
  if (!panel) return;

  const log = document.getElementById("chat-log");
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const send = document.getElementById("chat-send");
  const status = document.getElementById("chat-status");
  const errorBox = document.getElementById("chat-error");
  const contextChip = document.getElementById("chat-context");
  const history = [];
  let busy = false;

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  function clearError() {
    errorBox.hidden = true;
    errorBox.textContent = "";
  }

  function addMessage(role, text, sources) {
    const node = window.ChatRender.messageNode(role, text, sources);
    log.append(node);
    log.scrollTop = log.scrollHeight;
    return node;
  }

  function updateContext() {
    const context = window.BookContext;
    if (context && context.book) {
      const name = String(context.book).split("/").pop();
      contextChip.hidden = false;
      contextChip.replaceChildren();
      const label = document.createElement("span");
      label.textContent = "Asking about";
      const book = document.createElement("b");
      book.textContent = name;
      contextChip.append(label, book);
      if (context.page) {
        const page = document.createElement("b");
        page.textContent = "p." + context.page;
        contextChip.append(page);
      }
    } else {
      contextChip.hidden = true;
    }
  }

  async function loadStatus() {
    try {
      const data = await fetch("/api/chat/status").then((response) => response.json());
      if (!data.available) {
        status.textContent = data.reason || "Chat is not configured — add a provider key.";
        return;
      }
      const selected = data.selected || "auto";
      if (selected === "auto") {
        const chain = (data.providers || []).map((model) => model.provider + " · " + model.model);
        status.textContent = chain.length ? "Auto: " + chain.join(" → ") : "Auto";
        status.title = status.textContent;
      } else {
        status.textContent = "Model: " + selected;
        status.title = selected;
      }
    } catch (_error) {
      status.textContent = "Chat status unavailable.";
    }
  }

  async function ask(text) {
    const question = text.trim();
    if (busy || !question) return;
    busy = true;
    send.disabled = true;
    clearError();
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
        }),
      });
      const data = await response.json().catch(() => ({}));
      pending.remove();
      if (!response.ok) {
        history.pop();
        showError(data.detail || "The request failed. Try again, or pick another model in Options.");
        return;
      }
      history.push({ role: "assistant", content: data.answer });
      addMessage("assistant", data.answer, data.sources);
      status.textContent = "Answered by " + data.provider + " · " + data.model;
      status.title = status.textContent;
    } catch (_error) {
      pending.remove();
      history.pop();
      showError("The request failed. Check the provider key or try another model in Options.");
    } finally {
      busy = false;
      send.disabled = false;
      input.focus();
    }
  }

  window.addEventListener("book-context-changed", updateContext);
  window.addEventListener("chat-options-changed", () => loadStatus());
  window.addEventListener("chat-error", (event) => showError(event.detail));

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

  panel.addEventListener("panel-open", () => {
    window.ChatRender.ensureMath().catch(() => {});
    updateContext();
    loadStatus();
    input.focus();
  });
  updateContext();
  loadStatus();
})();
