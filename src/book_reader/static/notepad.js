(() => {
  "use strict";

  const body = document.getElementById("notepad-body");
  if (!body) return;

  const compose = document.getElementById("compose");
  const composeQuote = document.getElementById("compose-quote");
  const composeLocator = document.getElementById("compose-locator");
  const composeComment = document.getElementById("compose-comment");
  const composeGroup = document.getElementById("compose-group");

  const state = { groups: [], notes: [], pending: null };

  async function api(path, options) {
    const response = await fetch(path, options);
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.detail || response.statusText);
    }
    return response.json();
  }

  function locatorText(note) {
    const parts = [];
    if (note.kind === "pdf" && note.page) parts.push("p." + note.page);
    else if (note.line_start) {
      parts.push(
        "lines " + note.line_start +
          (note.line_end && note.line_end !== note.line_start ? "–" + note.line_end : ""),
      );
    } else parts.push("unlocated");
    if (note.section) parts.push("§ " + note.section);
    if (note.paragraph) parts.push("¶ " + note.paragraph);
    return parts.join(" · ");
  }

  function sourceHref(note) {
    const base = "/book/" + String(note.book || "").split("/").map(encodeURIComponent).join("/");
    if (note.kind === "pdf" && note.page) return base + "#p" + note.page;
    if (note.line_start) return base + "#L" + note.line_start;
    return base;
  }

  function noteCard(note) {
    const card = document.createElement("div");
    card.className = "note-card";

    const quote = document.createElement("blockquote");
    quote.textContent = note.quote;

    const locator = document.createElement("span");
    locator.className = "locator";
    const link = document.createElement("a");
    link.href = sourceHref(note);
    link.textContent = String(note.book || "").split("/").pop() + " · " + locatorText(note);
    locator.append(link);

    const comment = document.createElement("textarea");
    comment.value = note.comment || "";
    comment.placeholder = "Annotation…";
    comment.setAttribute("aria-label", "Annotation");
    let timer = null;
    const save = () => {
      api("/api/notepad/notes/" + encodeURIComponent(note.id), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ comment: comment.value }),
      }).catch(() => window.Shell.toast("Annotation not saved."));
    };
    comment.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(save, 700);
    });
    comment.addEventListener("blur", () => {
      clearTimeout(timer);
      save();
    });

    const actions = document.createElement("div");
    actions.className = "note-actions";
    const move = document.createElement("select");
    move.setAttribute("aria-label", "Move note to group");
    for (const group of state.groups) {
      const option = document.createElement("option");
      option.value = group.id;
      option.textContent = group.name;
      if (group.id === note.group) option.selected = true;
      move.append(option);
    }
    move.addEventListener("change", () => {
      api("/api/notepad/notes/" + encodeURIComponent(note.id), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ group: move.value }),
      }).then(load).catch(() => window.Shell.toast("Could not move the note."));
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => {
      if (!window.confirm("Delete this note?")) return;
      api("/api/notepad/notes/" + encodeURIComponent(note.id), { method: "DELETE" })
        .then(() => { window.Shell.toast("Note deleted."); return load(); })
        .catch(() => window.Shell.toast("Could not delete the note."));
    });
    actions.append(move, remove);

    card.append(quote, locator, comment, actions);
    return card;
  }

  function render() {
    body.replaceChildren();
    if (!state.groups.length) {
      const empty = document.createElement("p");
      empty.className = "side-empty";
      empty.textContent = "No groups yet.";
      body.append(empty);
      return;
    }
    for (const group of state.groups) {
      const section = document.createElement("section");
      section.className = "note-group";
      const head = document.createElement("header");
      const title = document.createElement("h3");
      const notes = state.notes.filter((note) => note.group === group.id);
      title.textContent = group.name + " (" + notes.length + ")";
      head.append(title);
      if (group.id !== "inbox") {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "remove";
        remove.textContent = "Delete";
        remove.addEventListener("click", () => {
          const question = "Delete group \"" + group.name + "\" and its " + notes.length + " notes?";
          if (!window.confirm(question)) return;
          api("/api/notepad/groups/" + encodeURIComponent(group.id), { method: "DELETE" })
            .then(load)
            .catch(() => window.Shell.toast("Could not delete the group."));
        });
        head.append(remove);
      }
      section.append(head);
      for (const note of notes) section.append(noteCard(note));
      body.append(section);
    }
  }

  async function load() {
    try {
      const data = await api("/api/notepad");
      state.groups = data.groups || [];
      state.notes = data.notes || [];
      render();
    } catch (error) {
      body.textContent = "Cannot load notes: " + error.message;
    }
  }

  function fillGroupSelect() {
    composeGroup.replaceChildren();
    for (const group of state.groups) {
      const option = document.createElement("option");
      option.value = group.id;
      option.textContent = group.name;
      composeGroup.append(option);
    }
  }

  function startCompose(info) {
    state.pending = info;
    compose.hidden = false;
    fillGroupSelect();
    composeQuote.textContent = String(info.quote || "").replace(/\s+/g, " ").slice(0, 600);
    const parts = [String(info.book || "").split("/").pop()];
    if (info.page) parts.push("p." + info.page);
    if (info.section) parts.push("§ " + info.section);
    if (info.paragraph) parts.push("¶ " + info.paragraph);
    composeLocator.textContent = parts.filter(Boolean).join(" · ");
    composeComment.value = "";
    composeComment.focus();
  }

  document.getElementById("group-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.getElementById("group-name");
    const name = input.value.trim();
    if (!name) return;
    api("/api/notepad/groups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    })
      .then(() => { input.value = ""; return load(); })
      .catch((error) => window.Shell.toast(error.message));
  });

  document.getElementById("compose-cancel").addEventListener("click", () => {
    state.pending = null;
    compose.hidden = true;
    const selection = window.getSelection();
    if (selection) selection.removeAllRanges();
  });

  document.getElementById("compose-save").addEventListener("click", () => {
    if (!state.pending) return;
    const payload = Object.assign({}, state.pending, {
      group: composeGroup.value,
      comment: composeComment.value,
    });
    api("/api/notepad/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(() => {
        state.pending = null;
        compose.hidden = true;
        const selection = window.getSelection();
        if (selection) selection.removeAllRanges();
        window.Shell.toast("Note saved.");
        return load();
      })
      .catch((error) => window.Shell.toast(error.message));
  });

  composeComment.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      document.getElementById("compose-save").click();
    }
  });

  window.Notepad = { compose: startCompose, refresh: load };
  load();
})();
