/**
 * Shows a window on the current virtual desktop instead of switching
 * to the desktop where the window was originally created.
 *
 * Works by temporarily pinning the window to all workspaces,
 * then unpinning it — leaving it on the current one.
 */
export const showOnCurrentDesktop = (win: Electron.BrowserWindow) => {
  win.setVisibleOnAllWorkspaces(true);
  win.show();
  win.setVisibleOnAllWorkspaces(false);
};
