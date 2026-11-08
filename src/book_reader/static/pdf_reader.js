(() => {
  "use strict";

  const frame = document.getElementById("pdf-frame");
  if (!frame) return;

  const frameShell = document.getElementById("pdf-shell");
  const fallback = document.getElementById("pdf-fallback");
  const bubble = document.getElementById("note-capture");
  const REL = frame.dataset.book || "";
  const hashPage = Number((window.location.hash.match(/#p(\d+)/) || [])[1]) || 0;
  const INITIAL = hashPage || Number(frame.dataset.page) || 1;
  let viewerApp = null;
  let currentPage = INITIAL;
  let pendingCapture = null;
  let progressTimer = null;
  let selectionTimer = null;
  let resizeTimer = null;

  window.BookContext = { book: REL, page: INITIAL };

  function showFallback() {
    if (!fallback) return;
    fallback.hidden = false;
    frame.style.display = "none";
  }

  function hideBubble() {
    if (!bubble) return;
    bubble.hidden = true;
    pendingCapture = null;
  }

  function postProgress(page) {
    clearTimeout(progressTimer);
    progressTimer = setTimeout(() => {
      fetch("/api/progress", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: REL, page }),
      }).catch(() => {});
    }, 250);
  }

  function setPage(number, record = true) {
    const page = Math.max(1, Math.floor(Number(number) || 1));
    currentPage = page;
    window.BookContext = { book: REL, page };
    history.replaceState(null, "", "#p" + page);
    window.dispatchEvent(new CustomEvent("book-context-changed"));
    if (record) postProgress(page);
  }

  function pageFromSelection(range) {
    const node = range.commonAncestorContainer;
    const element = node.nodeType === 1 ? node : node.parentElement;
    const pageElement = element?.closest?.(".page[data-page-number]");
    if (pageElement) {
      const page = Number(pageElement.dataset.pageNumber);
      if (Number.isFinite(page) && page > 0) return page;
    }
    return viewerApp?.pdfViewer?.currentPageNumber || currentPage;
  }

  function placeBubble(rect) {
    if (!bubble) return;
    const frameRect = frame.getBoundingClientRect();
    const width = bubble.offsetWidth || 74;
    const left = Math.min(
      window.innerWidth - width - 10,
      Math.max(10, frameRect.left + rect.left + rect.width / 2 - width / 2),
    );
    const top = Math.max(10, frameRect.top + rect.top - 42);
    bubble.style.left = left + "px";
    bubble.style.top = top + "px";
    bubble.hidden = false;
  }

  function captureSelection() {
    if (!viewerApp) return;
    const selection = frame.contentWindow?.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      hideBubble();
      return;
    }
    const range = selection.getRangeAt(0);
    const viewerContainer = frame.contentDocument?.getElementById("viewerContainer");
    if (!viewerContainer?.contains(range.commonAncestorContainer)) {
      hideBubble();
      return;
    }
    const quote = selection.toString().trim().slice(0, 7800);
    if (!quote) {
      hideBubble();
      return;
    }
    const page = pageFromSelection(range);
    pendingCapture = { book: REL, kind: "pdf", page, quote };
    placeBubble(range.getBoundingClientRect());
  }

  function bindSelection(document) {
    document.addEventListener("mouseup", () => setTimeout(captureSelection, 0));
    document.addEventListener("touchend", () => setTimeout(captureSelection, 250));
    document.addEventListener("selectionchange", () => {
      clearTimeout(selectionTimer);
      selectionTimer = setTimeout(captureSelection, 200);
    });
  }

  function bindViewer(app) {
    viewerApp = app;
    let ready = false;
    let applied = false;
    let attempts = 0;
    app.eventBus.on("pagechanging", (event) => {
      if (ready) setPage(event.pageNumber);
    });
    function applyInitialPage() {
      if (applied) return;
      if (!app.pdfViewer.pagesCount && attempts++ < 80) {
        setTimeout(applyInitialPage, 100);
        return;
      }
      applied = true;
      app.pdfViewer.currentPageNumber = INITIAL;
      setPage(INITIAL, false);
      setTimeout(() => { ready = true; }, 250);
    }
    app.eventBus.on("pagesinit", applyInitialPage);
    applyInitialPage();
    const closeInitialSidebar = () => {
      try {
        if (app.viewsManager?.isOpen) app.viewsManager.close();
      } catch (_error) {
        /* Older PDF.js builds may expose pdfSidebar instead. */
      }
    };
    app.eventBus.on("documentloaded", closeInitialSidebar);
    app.eventBus.on("outlineloaded", closeInitialSidebar);
    Promise.resolve(app.initializedPromise)
      .then(() => {
        closeInitialSidebar();
        applyInitialPage();
      })
      .catch(() => {});
    [0, 250, 750, 1500].forEach((delay) => setTimeout(closeInitialSidebar, delay));

    const document = frame.contentDocument;
    if (document) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "/static/pdf_room.css";
      document.head.append(link);
      bindSelection(document);
    }

    if (window.ResizeObserver) {
      new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          try {
            app.pdfViewer.update();
          } catch (_error) {
            /* PDF.js may be between documents during a resize */
          }
        }, 180);
      }).observe(frameShell || frame);
    }
  }

  function waitForViewer(attempt = 0) {
    const app = frame.contentWindow?.PDFViewerApplication;
    if (app?.pdfViewer && app.eventBus) {
      bindViewer(app);
      return;
    }
    if (attempt < 80) {
      setTimeout(() => waitForViewer(attempt + 1), 100);
    } else {
      console.error("PDF.js viewer did not initialize; showing the native fallback.");
      showFallback();
    }
  }

  if (bubble) {
    bubble.addEventListener("click", () => {
      if (pendingCapture && window.Notepad && window.Shell) {
        window.Shell.open("notepad");
        window.Notepad.compose(pendingCapture);
      }
      hideBubble();
    });
  }

  document.addEventListener("mousedown", (event) => {
    if (bubble && !bubble.hidden && event.target !== bubble) hideBubble();
  });

  window.addEventListener("hashchange", () => {
    const match = window.location.hash.match(/#p(\d+)/);
    if (!match || !viewerApp) return;
    const requested = Number(match[1]);
    if (requested && viewerApp.pdfViewer.currentPageNumber !== requested) {
      viewerApp.pdfViewer.currentPageNumber = requested;
    }
  });

  frame.addEventListener("load", () => waitForViewer());
})();
