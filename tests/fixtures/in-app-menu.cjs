const { app, BrowserWindow } = require('electron');
const { mkdirSync } = require('node:fs');

mkdirSync(process.argv[2], { recursive: true });
app.setPath('userData', process.argv[2]);
app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 1100, height: 700 });
  window.loadURL('about:blank');
});
app.on('window-all-closed', () => app.quit());
