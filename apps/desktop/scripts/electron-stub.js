// Host plugins import electron, which only exists inside Electron: scripts/i18n.ts
// loads them with this stub in its place. Every export is a stub; calling,
// constructing or reading from one gives the stub again.

const stub = new Proxy(function () {}, { get: () => stub, apply: () => stub, construct: () => stub });
export default stub;
export const { app, BrowserWindow, clipboard, contextBridge, dialog, globalShortcut, ipcMain, ipcRenderer, Menu,
  nativeImage, nativeTheme, net, Notification, protocol, screen, session, shell, TouchBar, Tray } = new Proxy({}, { get: () => stub });
