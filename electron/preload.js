const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  isDesktop: true,
  pickDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  onOpenSettings: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('open-settings', listener);
    return () => ipcRenderer.removeListener('open-settings', listener);
  },
  onNewChat: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('new-chat', listener);
    return () => ipcRenderer.removeListener('new-chat', listener);
  },
  onAuthCallback: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('auth:callback', listener);
    return () => ipcRenderer.removeListener('auth:callback', listener);
  }
});
