import { join } from "node:path";
import { app, BrowserWindow, session } from "electron";
import { seedConsent } from "./consent.ts";
import { setupIpc } from "./ipc.ts";
import { setupNet } from "./net.ts";
import { chromeUserAgent, isGoogleAuth } from "../shared/user-agent.ts";

const YTM_URL = "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/";

// Separate profile (and single-instance lock) for tests and parallel dev runs.
if (process.env.PEAR_USER_DATA) app.setPath("userData", process.env.PEAR_USER_DATA);

// Same identity as pear-desktop. The data folder follows productName, so pin it
// before renaming the app to its id, which X11/Wayland use as the window class
// and Windows as the AppUserModelId.
const APP_ID = "com.github.th-ch.\u0079\u006f\u0075\u0074\u0075\u0062\u0065\u002d\u006d\u0075\u0073\u0069\u0063";
app.setPath("userData", app.getPath("userData"));
app.setName(APP_ID);
app.commandLine.appendSwitch("class", APP_ID);
if (process.platform === "win32") app.setAppUserModelId(APP_ID);

if (!app.requestSingleInstanceLock()) app.quit();

let mainWindow: BrowserWindow | undefined;
let electronUserAgent = "";
let ytmUserAgent = "";

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: "#030303",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  // Keep navigator.userAgent consistent with the UA header per destination.
  window.webContents.on("did-start-navigation", ({ url, isMainFrame }) => {
    if (!isMainFrame) return;
    const userAgent = isGoogleAuth(url) ? electronUserAgent : ytmUserAgent;
    if (window.webContents.getUserAgent() !== userAgent) window.webContents.setUserAgent(userAgent);
  });
  window.loadURL(YTM_URL);
  return window;
}

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  electronUserAgent = app.userAgentFallback;
  ytmUserAgent = chromeUserAgent(electronUserAgent);
  app.userAgentFallback = ytmUserAgent;
  setupNet(session.defaultSession, { electronUserAgent });
  setupIpc();
  await seedConsent(session.defaultSession);
  mainWindow = createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
});
