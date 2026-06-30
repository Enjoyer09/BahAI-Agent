const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  pickDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  onAuthCallback: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('auth:callback', listener);
    return () => ipcRenderer.removeListener('auth:callback', listener);
  }
});
