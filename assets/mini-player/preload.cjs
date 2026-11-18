// Preload for the mini player window.
// Kept as a plain CommonJS asset so it can be loaded straight from `assets`
// without being part of the main preload bundle.
const { contextBridge, ipcRenderer } = require('electron');

const INCOMING = ['mini-player:state', 'mini-player:config'];

contextBridge.exposeInMainWorld('miniPlayer', {
  on: (channel, listener) => {
    if (!INCOMING.includes(channel)) {
      return;
    }

    ipcRenderer.on(channel, (_event, ...args) => listener(...args));
  },
  ready: () => ipcRenderer.send('mini-player:ready'),
  hover: (isHovered) => ipcRenderer.send('mini-player:hover', isHovered),
  control: (action, value) =>
    ipcRenderer.send('mini-player:control', action, value),
});
