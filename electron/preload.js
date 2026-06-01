const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  pickDirectory: () => ipcRenderer.invoke('dialog:openDirectory')
});
