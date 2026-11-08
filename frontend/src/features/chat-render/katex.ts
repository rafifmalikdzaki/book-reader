import { useEffect, useState } from 'react';

/*
 * Lazy KaTeX loader. KaTeX stays vendored (AGENTS.md): the stylesheet and the two
 * scripts are injected as tags from /static/vendor/katex, exactly like the legacy
 * chat_render.js. Never import KaTeX from npm and never point these at a CDN.
 */
const KATEX_BASE = '/static/vendor/katex/';

export interface KatexRenderOptions {
  delimiters: { left: string; right: string; display: boolean }[];
  throwOnError: boolean;
  errorColor: string;
  strict: string;
  trust: boolean;
  ignoredTags: string[];
  maxSize: number;
  maxExpand: number;
}

declare global {
  interface Window {
    renderMathInElement?: (root: HTMLElement, options: KatexRenderOptions) => void;
  }
}

export const KATEX_OPTIONS: KatexRenderOptions = {
  delimiters: [
    { left: '$$', right: '$$', display: true },
    { left: '\\[', right: '\\]', display: true },
    { left: '$', right: '$', display: false },
    { left: '\\(', right: '\\)', display: false },
  ],
  throwOnError: false,
  errorColor: '#8A4B2A', // legacy literal; KaTeX takes it as an inline style
  strict: 'ignore',
  trust: false,
  ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
  maxSize: 10,
  maxExpand: 1000,
};

let loader: Promise<void> | null = null;
let stylesheetAdded = false;

export function isKatexReady(): boolean {
  return typeof window.renderMathInElement === 'function';
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Cannot load ${src}`));
    document.head.append(script);
  });
}

/** Loads KaTeX once; resolves immediately when `renderMathInElement` already exists. */
export function ensureKatex(): Promise<void> {
  if (isKatexReady()) return Promise.resolve();
  if (loader) return loader;
  if (!stylesheetAdded) {
    stylesheetAdded = true;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${KATEX_BASE}katex.min.css`;
    document.head.append(link);
  }
  loader = loadScript(`${KATEX_BASE}katex.min.js`)
    .then(() => loadScript(`${KATEX_BASE}contrib/auto-render.min.js`))
    .catch((error: unknown) => {
      loader = null;
      throw error;
    });
  return loader;
}

function apply(root: HTMLElement): void {
  try {
    window.renderMathInElement?.(root, KATEX_OPTIONS);
  } catch {
    // Leave the raw LaTeX readable if this answer cannot be rendered.
  }
}

/** Typesets `$..$`, `$$..$$`, `\(..\)` and `\[..\]` inside `root` (loading KaTeX first if needed). */
export function renderMath(root: HTMLElement | null): void {
  if (!root) return;
  if (isKatexReady()) {
    apply(root);
    return;
  }
  ensureKatex()
    .then(() => {
      if (root.isConnected) apply(root);
    })
    .catch(() => {});
}

/** Starts loading KaTeX on mount; `ready` flips once `renderMathInElement` exists. */
export function useKatex(): { ready: boolean; failed: boolean } {
  const [state, setState] = useState({ ready: isKatexReady(), failed: false });
  useEffect(() => {
    let live = true;
    ensureKatex().then(
      () => live && setState({ ready: true, failed: false }),
      () => live && setState({ ready: false, failed: true }),
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}
