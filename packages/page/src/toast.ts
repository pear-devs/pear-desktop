// YTM's own toast (bottom left), as pear-desktop's plugins show messages.

import { selectors } from "@pear/sdk/selectors";

interface ToastApp extends HTMLElement {
  toastService?: { show(message: string): void };
  handleAddToToastAction?(action: unknown): void;
}

/** pear-desktop used `toastService`, which newer YTM no longer has; its toast action does the same. */
export function showToast(message: string) {
  const app = document.querySelector<ToastApp>(selectors.app);
  if (app?.toastService) return app.toastService.show(message);
  app?.handleAddToToastAction?.({
    addToToastAction: { item: { notificationTextRenderer: { successResponseText: { runs: [{ text: message }] } } } },
  });
}
