# Things To Do

## COMPLETED (2026-04-15)

### Hover Mini-Player Fixes
- [x] Fix: 2 next buttons (left and right of stop) — Previous button SVG was broken, fixed with correct path
- [x] Fix: Hover element doesn't register mouse-over — Switched from HTML event IPC to main-process cursor polling (150ms interval checking `screen.getCursorScreenPoint()`)
- [x] Fix: Clicking next/prev on hover popup triggers the toast notification behind it — Added `isHoverPopupVisible()` check in `interactive.ts` to suppress toasts while popup is active
- [x] Fix: Buttons don't respond to clicks — Switched from `onclick` + `console.log` IPC to `onmousedown` + `document.title` IPC (`page-title-updated` event), which works regardless of window focus state

### Three tiers of tray interaction now working:
1. **Hover** — Quick glance + controls via mini-player popup
2. **Single click** — Toggle the toast notification
3. **Double click** — Open the full app window

## FUTURE IDEAS
- Progress bar in hover popup (elapsed time / duration)
- Volume slider in hover popup
- Keyboard shortcuts for hover popup (show/dismiss)
- Contribute features individually as separate PRs to upstream
