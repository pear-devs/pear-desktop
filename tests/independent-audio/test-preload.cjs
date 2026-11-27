const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('independentTestPCM', (frame) =>
  ipcRenderer.invoke('independent-audio:test-pcm', frame),
);
