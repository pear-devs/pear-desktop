const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('discord', {
  init: (clientId) => ipcRenderer.invoke('discord:init', clientId),
  connect: () => ipcRenderer.invoke('discord:connect'),
  disconnect: () => ipcRenderer.invoke('discord:disconnect'),
  updateActivity: (activity) => ipcRenderer.invoke('discord:updateActivity', activity),
  clearActivity: () => ipcRenderer.invoke('discord:clearActivity'),
  isConnected: () => ipcRenderer.invoke('discord:isConnected'),
  onStatus: (callback) => {
    ipcRenderer.on('discord:status', (_, status) => callback(status));
  },
});
