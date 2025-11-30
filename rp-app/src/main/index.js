const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { discordService } = require('./discord-service');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 500,
    height: 750,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#1a1a2e',
    title: 'Discord Rich Presence',
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Set up status change callback
  discordService.onStatusChange = (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('discord:status', status);
    }
  };
}

// IPC Handlers
ipcMain.handle('discord:init', (_, clientId) => {
  try {
    discordService.init(clientId);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('discord:connect', () => {
  try {
    discordService.connect();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('discord:disconnect', () => {
  try {
    discordService.disconnect();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('discord:updateActivity', (_, activity) => {
  try {
    discordService.updateActivity(activity);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('discord:clearActivity', () => {
  try {
    discordService.clearActivity();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('discord:isConnected', () => {
  return discordService.isConnected();
});

// App lifecycle
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  discordService.cleanup();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  discordService.cleanup();
});
