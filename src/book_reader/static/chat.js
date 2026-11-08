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

  function bookHref(source) {
    const base = "/book/" + String(source.book || "").split("/").map(encodeURIComponent).join("/");
    if (source.page) return base + "#p" + source.page;
    if (source.line) return base + "#L" + source.line;
    return base;
  }

  function sourceLabel(source) {
    const parts = [String(source.book || "").split("/").pop()];
    if (source.page) parts.push("p." + source.page);
    if (source.line) {
      parts.push("lines " + source.line + (source.line_end && source.line_end !== source.line ? "–" + source.line_end : ""));
    }
    if (source.section) parts.push("§ " + source.section);
    return parts.filter(Boolean).join(" · ");
  }

  const SAFE_HREF = /^(https?:|\/|#)/i;

  function inlineNodes(text) {
    const frag = document.createDocumentFragment();
    const pattern = /(\*\*|__)(.+?)\1|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/;
    let rest = text;
    while (rest) {
      const match = pattern.exec(rest);
      if (!match) {
        frag.append(document.createTextNode(rest));
        break;
      }
      if (match.index) frag.append(document.createTextNode(rest.slice(0, match.index)));
      if (match[2] !== undefined) {
        const strong = document.createElement("strong");
        strong.append(inlineNodes(match[2]));
        frag.append(strong);
      } else if (match[3] !== undefined) {
        const code = document.createElement("code");
        code.textContent = match[3];
        frag.append(code);
      } else if (match[4] !== undefined) {
        if (SAFE_HREF.test(match[5])) {
          const link = document.createElement("a");
          link.href = match[5];
          link.rel = "noreferrer";
          link.textContent = match[4];
          frag.append(link);
        } else {
          frag.append(document.createTextNode(match[4]));
        }
      }
      rest = rest.slice(match.index + match[0].length);
    }
    return frag;
  }

  function renderAnswer(text) {
    const root = document.createElement("div");
    root.className = "rich";
    const blocks = String(text).split(/\n{2,}/);
    for (const block of blocks) {
      const lines = block.split("\n");
      const fence = lines[0].match(/^\s*```(\w*)\s*$/);
      if (fence) {
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.textContent = lines.slice(1, lines.at(-1)?.trim() === "```" ? -1 : undefined).join("\n");
        pre.append(code);
        root.append(pre);
        continue;
      }
      if (/\$\$|\\\[/.test(block)) {
        const mathParagraph = document.createElement("p");
        mathParagraph.textContent = block;
        root.append(mathParagraph);
        continue;
      }
      const bulleted = lines.every((line) => /^\s*[-*]\s+/.test(line));
      const numbered = lines.every((line) => /^\s*\d+[.)]\s+/.test(line));
      if (bulleted || numbered) {
        const list = document.createElement(bulleted ? "ul" : "ol");
        for (const line of lines) {
          const item = document.createElement("li");
          item.append(inlineNodes(line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "")));
          list.append(item);
        }
        root.append(list);
        continue;
      }
      const paragraph = document.createElement("p");
      lines.forEach((line, index) => {
        if (index) paragraph.append(document.createElement("br"));
        paragraph.append(inlineNodes(line));
      });
      root.append(paragraph);
    }
    return root;
  }

  let mathLoader = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Cannot load " + src));
      document.head.append(script);
    });
  }

  function ensureMath() {
    if (typeof window.renderMathInElement === "function") return Promise.resolve();
    if (mathLoader) return mathLoader;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/static/vendor/katex/katex.min.css";
    document.head.append(link);
    mathLoader = loadScript("/static/vendor/katex/katex.min.js")
      .then(() => loadScript("/static/vendor/katex/contrib/auto-render.min.js"))
      .catch((error) => {
        mathLoader = null;
        throw error;
      });
    return mathLoader;
  }

  function renderMath(root) {
    if (!root) return;
    if (typeof window.renderMathInElement !== "function") {
      ensureMath()
        .then(() => renderMath(root))
        .catch(() => {});
      return;
    }
    try {
      window.renderMathInElement(root, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "\\[", right: "\\]", display: true },
          { left: "$", right: "$", display: false },
          { left: "\\(", right: "\\)", display: false },
        ],
        throwOnError: false,
        errorColor: "#8A4B2A",
        strict: "ignore",
        trust: false,
        ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"],
      });
    } catch (_error) {
      /* Leave the raw LaTeX readable if this answer cannot be rendered. */
    }
  }

  function addMessage(role, text, sources) {
    const node = document.createElement("div");
    node.className = "msg " + role;
    if (role === "assistant") node.append(renderAnswer(text));
    else node.textContent = text;
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
    if (role === "assistant") renderMath(node.querySelector(".rich"));
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
    } catch (error) {
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
    } catch (error) {
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
  panel.addEventListener("panel-open", () => {
    ensureMath().catch(() => {});
  });

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
    updateContext();
    loadStatus();
    input.focus();
  });
  window.addEventListener("chat-options-changed", () => loadStatus());
  window.addEventListener("chat-error", (event) => showError(event.detail));
  updateContext();
  loadStatus();
})();
