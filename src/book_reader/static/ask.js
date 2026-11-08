(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const thread = $("thread");
  const form = $("ask-form");
  const input = $("ask-input");
  const send = $("ask-send");
  const errorBox = $("ask-error");
  const statusLine = $("ask-status");
  const title = $("ask-title");
  const subtitle = $("ask-subtitle");
  const pin = $("pin-chat");
  const projectSelect = $("project-select");
  const deleteButton = $("delete-chat");
  const sessionsBox = $("ask-sessions");
  const scopeLabel = $("scope-label");
  const scopeMenu = $("scope-menu");
  const newChatButton = $("new-chat");
  const dialog = $("delete-dialog");
  const deleteTitle = $("delete-title");
  const deleteCopy = $("delete-copy");
  const sidebar = $("ask-index");
  const backdrop = $("ask-backdrop");

  const params = new URLSearchParams(window.location.search);
  const state = {
    sessions: [],
    projects: [],
    categories: [],
    current: null,
    draft: {
      book: params.get("book"),
      page: Number(params.get("page")) || null,
      categories: [],
    },
    available: true,
    busy: false,
    scopeBusy: false,
    deleteMode: "chat",
    deleteTarget: "",
    notice: params.get("expired") === "1" ? "This chat expired or was deleted." : "",
  };

  function api(url, options) {
    return fetch(url, {
      cache: "no-store",
      headers: { "content-type": "application/json", ...(options?.headers || {}) },
      ...options,
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data.detail || "The request failed.");
        error.status = response.status;
        throw error;
      }
      return data;
    });
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  function clearError() {
    errorBox.hidden = true;
    errorBox.textContent = "";
  }

  function baseName(rel) {
    return String(rel || "").split("/").pop();
  }

  function updatedLabel(timestamp) {
    const seconds = Math.max(0, Date.now() / 1000 - Number(timestamp || 0));
    if (seconds < 60) return "now";
    if (seconds < 3600) return Math.floor(seconds / 60) + "m";
    if (seconds < 86400) return Math.floor(seconds / 3600) + "h";
    if (seconds < 7 * 86400) return Math.floor(seconds / 86400) + "d";
    return new Date(Number(timestamp) * 1000).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }

  function closeSidebar() {
    sidebar.classList.remove("open");
    backdrop.hidden = true;
    $("ask-menu").setAttribute("aria-expanded", "false");
  }

  function openSidebar() {
    sidebar.classList.add("open");
    backdrop.hidden = false;
    $("ask-menu").setAttribute("aria-expanded", "true");
  }

  function sessionButton(session) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ask-session";
    button.dataset.chat = session.id;
    if (state.current?.id === session.id) button.setAttribute("aria-current", "true");
    const label = document.createElement("span");
    label.className = "t";
    label.textContent = session.title || "New chat";
    button.append(label);
    if (session.pinned) {
      const mark = document.createElement("span");
      mark.className = "pin";
      mark.textContent = "Pin";
      button.append(mark);
    }
    const meta = document.createElement("span");
    meta.className = "m";
    meta.textContent = updatedLabel(session.updated);
    button.append(meta);
    return button;
  }

  function group(label, sessions) {
    const section = document.createElement("section");
    section.className = "ask-group";
    const head = document.createElement("div");
    head.className = "ask-group-head";
    const heading = document.createElement("h2");
    heading.textContent = label;
    const count = document.createElement("span");
    count.textContent = String(sessions.length);
    head.append(heading, count);
    section.append(head);
    for (const session of sessions) section.append(sessionButton(session));
    return section;
  }

  function renderSessions() {
    sessionsBox.replaceChildren();
    const pinned = state.sessions.filter((session) => session.pinned);
    if (pinned.length) sessionsBox.append(group("Pinned", pinned));
    for (const project of state.projects) {
      const allAssigned = state.sessions.filter((session) => session.project_id === project.id);
      const assigned = allAssigned.filter((session) => !session.pinned);
      const section = group("Project", assigned);
      section.querySelector("h2").textContent = project.name;
      const projectCount = section.querySelector(".ask-group-head span");
      if (projectCount) projectCount.textContent = String(allAssigned.length);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "x";
      remove.dataset.projectDelete = project.id;
      remove.setAttribute("aria-label", "Delete project " + project.name);
      remove.textContent = "×";
      section.querySelector(".ask-group-head").append(remove);
      if (!assigned.length) {
        const empty = document.createElement("p");
        empty.className = "ask-project-empty";
        empty.textContent = allAssigned.length
          ? `${allAssigned.length} pinned chat${allAssigned.length === 1 ? "" : "s"} in Pinned.`
          : "No chats yet";
        section.append(empty);
      }
      sessionsBox.append(section);
    }
    const recent = state.sessions.filter(
      (session) => !session.pinned && !session.project_id,
    );
    if (recent.length) sessionsBox.append(group("Recent", recent));
    if (!state.sessions.length) {
      const empty = document.createElement("p");
      empty.className = "ask-side-empty";
      empty.textContent = "No chats yet. Ask a question to start one.";
      sessionsBox.append(empty);
    }
  }

  function renderProjectOptions() {
    projectSelect.replaceChildren();
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "No project";
    projectSelect.append(none);
    for (const project of state.projects) {
      const option = document.createElement("option");
      option.value = project.id;
      option.textContent = project.name;
      projectSelect.append(option);
    }
    projectSelect.value = state.current?.project_id || "";
    syncControls();
  }

  function selectedCategories() {
    return state.current ? state.current.categories || [] : state.draft.categories;
  }

  function renderScope() {
    const known = new Set(state.categories.map((category) => category.id));
    const selected = new Set(selectedCategories().filter((category) => known.has(category)));
    scopeMenu.replaceChildren();
    const all = document.createElement("label");
    all.className = "all";
    const allBox = document.createElement("input");
    allBox.type = "checkbox";
    allBox.value = "";
    allBox.checked = selected.size === 0;
    all.append(allBox, document.createTextNode("All books"));
    scopeMenu.append(all);
    for (const category of state.categories) {
      const label = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.value = category.id;
      box.checked = selected.has(category.id);
      label.append(box, document.createTextNode(category.name));
      scopeMenu.append(label);
    }
    if (!state.categories.length) {
      const note = document.createElement("p");
      note.className = "ask-side-empty";
      note.textContent = "No categories yet. All books are searched.";
      scopeMenu.append(note);
      scopeLabel.textContent = "All books";
      return;
    }
    const names = state.categories
      .filter((category) => selected.has(category.id))
      .map((category) => category.name);
    scopeLabel.textContent = names.length ? names.join(", ") : "All books";
    scopeLabel.title = scopeLabel.textContent;
  }

  function emptyState() {
    const box = document.createElement("div");
    box.className = "ask-empty";
    const heading = document.createElement("h2");
    heading.textContent = "Ask the library";
    const copy = document.createElement("p");
    const book = state.current?.book || state.draft.book;
    copy.textContent = book
      ? "Questions use this book and cite the pages they draw from."
      : "Answers search your books and cite the page or line they used.";
    box.append(heading, copy);
    if (state.notice) {
      const notice = document.createElement("p");
      notice.textContent = state.notice;
      box.append(notice);
    }
    const prompts = document.createElement("div");
    prompts.className = "ask-prompts";
    const labels = book
      ? ["Summarize this page", "Find related passages in this book", "What does this section argue?"]
      : ["Find passages about a topic", "Compare two books", "Trace an idea across the library"];
    for (const text of labels) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = text;
      button.addEventListener("click", () => {
        input.value = text;
        input.focus();
      });
      prompts.append(button);
    }
    box.append(prompts);
    return box;
  }

  function addMessage(role, text, sources, pending) {
    const node = window.ChatRender.messageNode(role, text, sources);
    if (pending) node.classList.add("pending");
    thread.append(node);
    thread.scrollTop = thread.scrollHeight;
    return node;
  }

  function renderCurrent() {
    title.textContent = state.current?.title || "New chat";
    const book = state.current?.book || state.draft.book;
    const page = state.current?.page || state.draft.page;
    subtitle.textContent = book
      ? baseName(book) + (page ? " · p." + page : "") + " · RAG"
      : "Library-wide · RAG";
    pin.textContent = state.current?.pinned ? "Pinned" : "Pin";
    pin.setAttribute("aria-pressed", String(Boolean(state.current?.pinned)));
    renderProjectOptions();
    renderScope();
    thread.replaceChildren();
    if (!state.current || !state.current.messages?.length) {
      thread.append(emptyState());
      return;
    }
    for (const message of state.current.messages) {
      addMessage(message.role, message.content, message.sources);
    }
    thread.scrollTop = thread.scrollHeight;
  }

  async function loadSessions() {
    const data = await api("/api/chat/sessions");
    state.sessions = data.sessions || [];
    state.projects = data.projects || [];
    state.categories = data.categories || [];
    renderSessions();
    renderScope();
    renderProjectOptions();
  }

  async function loadSession(id) {
    try {
      state.current = await api("/api/chat/sessions/" + encodeURIComponent(id));
      state.draft.book = null;
      state.draft.page = null;
      state.notice = "";
      window.history.replaceState(null, "", "/ask?chat=" + encodeURIComponent(id));
      renderCurrent();
      renderSessions();
      closeSidebar();
    } catch (error) {
      state.current = null;
      state.notice =
        error.status === 404
          ? "This chat expired or was deleted."
          : "That chat could not be opened.";
      window.history.replaceState(null, "", "/ask");
      renderSessions();
      renderCurrent();
    }
  }

  function newChat() {
    if (state.busy || state.scopeBusy) return;
    state.current = null;
    state.draft.book = null;
    state.draft.page = null;
    state.draft.categories = [];
    state.notice = "";
    window.history.replaceState(null, "", "/ask");
    renderSessions();
    renderCurrent();
    closeSidebar();
    input.focus();
  }

  async function setCategories(categories) {
    if (!state.current) {
      state.draft.categories = categories;
      renderScope();
      return;
    }
    state.scopeBusy = true;
    syncControls();
    try {
      state.current = await api(
        "/api/chat/sessions/" + encodeURIComponent(state.current.id),
        { method: "PATCH", body: JSON.stringify({ categories }) },
      );
      await loadSessions();
      renderCurrent();
    } catch (error) {
      showError(error.message);
      renderScope();
    } finally {
      state.scopeBusy = false;
      syncControls();
    }
  }

  function syncControls() {
    const locked = state.busy || state.scopeBusy;
    send.disabled = locked || !state.available;
    newChatButton.disabled = locked;
    pin.disabled = locked || !state.current;
    projectSelect.disabled = locked || !state.current;
    deleteButton.disabled = locked || !state.current;
  }

  function setBusy(busy) {
    state.busy = busy;
    send.textContent = busy ? "Thinking…" : "Send";
    syncControls();
  }

  async function sendMessage() {
    const text = input.value.trim();
    if (!text || state.busy || state.scopeBusy || !state.available) return;
    clearError();
    setBusy(true);
    const typed = input.value;
    input.value = "";
    let session = state.current;
    thread.querySelector(".ask-empty")?.remove();
    addMessage("user", text);
    const pending = addMessage("assistant", "Searching the library…", [], true);
    try {
      if (!session) {
        const body = { categories: state.draft.categories };
        if (state.draft.book) {
          body.book = state.draft.book;
          if (state.draft.page) body.page = state.draft.page;
        }
        session = await api("/api/chat/sessions", {
          method: "POST",
          body: JSON.stringify(body),
        });
        state.current = session;
        window.history.replaceState(null, "", "/ask?chat=" + encodeURIComponent(session.id));
      }
      const data = await api(
        "/api/chat/sessions/" + encodeURIComponent(session.id) + "/messages",
        { method: "POST", body: JSON.stringify({ content: text }) },
      );
      state.current = data.session;
      await loadSessions();
      renderCurrent();
    } catch (error) {
      pending.remove();
      if (!input.value.trim()) input.value = typed;
      showError(error.message);
      if (state.current) {
        await loadSession(state.current.id);
      } else {
        renderCurrent();
      }
    } finally {
      setBusy(false);
      input.focus();
    }
  }

  async function loadStatus() {
    try {
      const data = await api("/api/chat/status");
      state.available = Boolean(data.available);
      if (!data.available) {
        statusLine.textContent =
          data.reason || "Chat is not configured — add a provider key.";
      } else {
        const selected = data.selected || "auto";
        statusLine.textContent =
          selected === "auto" ? "Ready · RAG · Auto model" : "Ready · RAG · " + selected;
      }
      syncControls();
    } catch (_error) {
      statusLine.textContent = "Chat status unavailable.";
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  newChatButton.addEventListener("click", newChat);
  $("ask-menu").addEventListener("click", openSidebar);
  $("ask-side-close").addEventListener("click", closeSidebar);
  backdrop.addEventListener("click", closeSidebar);

  sessionsBox.addEventListener("click", async (event) => {
    if (state.busy || state.scopeBusy) return;
    const chat = event.target.closest("[data-chat]");
    if (chat) {
      await loadSession(chat.dataset.chat);
      return;
    }
    const removeProject = event.target.closest("[data-project-delete]");
    if (!removeProject) return;
    const project = state.projects.find((item) => item.id === removeProject.dataset.projectDelete);
    if (!project) return;
    state.deleteMode = "project";
    state.deleteTarget = project.id;
    deleteTitle.textContent = "Delete this project?";
    deleteCopy.textContent = `“${project.name}” will be removed. Its chats stay in Recent.`;
    dialog.showModal();
  });

  $("project-toggle").addEventListener("click", () => {
    const projectForm = $("project-form");
    projectForm.hidden = !projectForm.hidden;
    if (!projectForm.hidden) $("project-name").focus();
  });
  $("project-cancel").addEventListener("click", () => {
    $("project-form").hidden = true;
  });
  $("project-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = $("project-name").value.trim();
    if (!name) return;
    try {
      await api("/api/chat/projects", { method: "POST", body: JSON.stringify({ name }) });
      $("project-name").value = "";
      $("project-form").hidden = true;
      await loadSessions();
    } catch (error) {
      showError(error.message);
    }
  });

  scopeMenu.addEventListener("change", (event) => {
    if (state.busy || state.scopeBusy) {
      renderScope();
      return;
    }
    const boxes = Array.from(scopeMenu.querySelectorAll("input[type=checkbox]"));
    const all = boxes.find((box) => !box.value);
    if (event.target === all && all.checked) {
      for (const box of boxes) if (box !== all) box.checked = false;
      setCategories([]);
      return;
    }
    if (event.target !== all && event.target.checked && all) all.checked = false;
    setCategories(boxes.filter((box) => box.value && box.checked).map((box) => box.value));
  });

  pin.addEventListener("click", async () => {
    if (!state.current) return;
    try {
      state.current = await api(
        "/api/chat/sessions/" + encodeURIComponent(state.current.id),
        { method: "PATCH", body: JSON.stringify({ pinned: !state.current.pinned }) },
      );
      await loadSessions();
      renderCurrent();
    } catch (error) {
      showError(error.message);
    }
  });

  projectSelect.addEventListener("change", async () => {
    if (!state.current) return;
    try {
      state.current = await api(
        "/api/chat/sessions/" + encodeURIComponent(state.current.id),
        {
          method: "PATCH",
          body: JSON.stringify({ project_id: projectSelect.value || null }),
        },
      );
      await loadSessions();
      renderCurrent();
    } catch (error) {
      showError(error.message);
    }
  });

  deleteButton.addEventListener("click", () => {
    if (!state.current) return;
    state.deleteMode = "chat";
    state.deleteTarget = state.current.id;
    deleteTitle.textContent = "Delete this chat?";
    deleteCopy.textContent =
      "This removes the transcript from this device. It cannot be undone.";
    dialog.showModal();
  });
  $("delete-cancel").addEventListener("click", () => dialog.close());
  $("delete-confirm").addEventListener("click", async () => {
    const mode = state.deleteMode;
    const target = state.deleteTarget;
    if (!target) return;
    try {
      if (mode === "project") {
        await api("/api/chat/projects/" + encodeURIComponent(target), { method: "DELETE" });
        await loadSessions();
        renderProjectOptions();
        renderCurrent();
      } else {
        await api("/api/chat/sessions/" + encodeURIComponent(target), { method: "DELETE" });
        await loadSessions();
        newChat();
      }
      dialog.close();
    } catch (error) {
      dialog.close();
      showError(error.message);
    }
  });

  window.addEventListener("chat-options-changed", loadStatus);
  syncControls();

  Promise.all([loadSessions(), loadStatus()])
    .then(() => {
      if (params.get("chat")) return loadSession(params.get("chat"));
      if (params.get("book")) {
        state.draft.book = params.get("book");
        state.draft.page = Number(params.get("page")) || null;
      }
      renderCurrent();
      return null;
    })
    .catch((error) => {
      showError(error.message);
      renderCurrent();
    });
})();
