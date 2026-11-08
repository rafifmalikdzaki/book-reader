const FOCUSABLE =
  "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

/** Tabbable descendants, in DOM order, ignoring disabled and hidden ones. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (node) =>
      !(node as HTMLButtonElement).disabled &&
      !node.hidden &&
      node.closest('[hidden], [aria-hidden="true"]') === null,
  );
}

/** First control worth focusing when a panel opens (legacy shell.js selector). */
export function firstControl(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>('input, textarea, select, button');
}
