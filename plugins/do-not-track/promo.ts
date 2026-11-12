// YTM answers skipped ads with a Premium reminder in the bottom-left corner
// ("Don't skip a beat with Music Premium"). It is closed with its own dismiss
// button, so YTM records it as dismissed, and hidden meanwhile so it never flashes.

interface PaperDialog extends HTMLElement {
  opened?: boolean;
  close?: () => void;
}

/** Watches `container` (YTM's popup container) and dismisses every promo that opens in it. */
export function dismissPromos(container: Element, promo: string, dismiss: string, onDismiss: () => void) {
  const sweep = () => {
    for (const renderer of container.querySelectorAll(promo)) {
      const dialog = renderer.closest<PaperDialog>("tp-yt-paper-dialog");
      if (!dialog || dialog.opened === false || dialog.hasAttribute("pear-dismissing")) continue;
      dialog.setAttribute("pear-dismissing", "");
      renderer.querySelector<HTMLElement>(dismiss)?.click();
      // The button can change with YTM's markup; closing the dialog still works then.
      setTimeout(() => {
        if (dialog.opened) dialog.close?.();
        dialog.removeAttribute("pear-dismissing");
      }, 100);
      onDismiss();
    }
  };
  const observer = new MutationObserver(sweep);
  // The dialog is reused: it is reopened by attribute changes, not re-added.
  observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "aria-hidden"] });
  sweep();
  return () => observer.disconnect();
}

export const hidePromoCss = (promo: string) => `tp-yt-paper-dialog:has(> ${promo}) { display: none !important; }`;
