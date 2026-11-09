/**
 * Minimal DOMMatrix polyfill for jsdom, where `pdfjs-dist` checks for `globalThis.DOMMatrix`
 * at module initialization time. Loaded by src/test/setup.ts only, never by the app bundle.
 */
if (typeof globalThis.DOMMatrix === 'undefined') {
  class DOMMatrixShim {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;
    multiplySelf() {
      return this;
    }
    preMultiplySelf() {
      return this;
    }
    translateSelf() {
      return this;
    }
    scaleSelf() {
      return this;
    }
    rotateSelf() {
      return this;
    }
    invertSelf() {
      return this;
    }
  }
  (globalThis as unknown as { DOMMatrix: unknown }).DOMMatrix = DOMMatrixShim;
}

export {};
