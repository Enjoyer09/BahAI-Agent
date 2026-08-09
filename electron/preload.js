// ==========================================
// Preload — contextBridge API for renderer
// ==========================================
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  isDesktop: true,

  // ─── Existing ──────────────────────────────────
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
  },

  // ─── File System ───────────────────────────────
  fs: {
    readDirectory: (dirPath, depth) => ipcRenderer.invoke('fs:readDirectory', dirPath, depth),
    readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
    writeFile: (filePath, content) => ipcRenderer.invoke('fs:writeFile', filePath, content),
    deleteFile: (filePath) => ipcRenderer.invoke('fs:deleteFile', filePath),
    rename: (oldPath, newPath) => ipcRenderer.invoke('fs:rename', oldPath, newPath),
    createDirectory: (dirPath) => ipcRenderer.invoke('fs:createDirectory', dirPath),
    watchStart: (dirPath) => ipcRenderer.invoke('fs:watchStart', dirPath),
    watchStop: () => ipcRenderer.invoke('fs:watchStop'),
    onBatchChanged: (callback) => {
      const listener = (_event, batch) => callback(batch);
      ipcRenderer.on('fs:batch-changed', listener);
      return () => ipcRenderer.removeListener('fs:batch-changed', listener);
    },
  },

  // ─── Terminal (PTY) ────────────────────────────
  terminal: {
    create: (cwd) => ipcRenderer.invoke('pty:create', cwd),
    write: (terminalId, data) => ipcRenderer.send('pty:write', { id: terminalId, data }),
    resize: (terminalId, cols, rows) => ipcRenderer.send('pty:resize', { id: terminalId, cols, rows }),
    kill: (terminalId) => ipcRenderer.invoke('pty:kill', terminalId),
    list: () => ipcRenderer.invoke('pty:list'),
    onData: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('pty:data', listener);
      return () => ipcRenderer.removeListener('pty:data', listener);
    },
    onExit: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('pty:exit', listener);
      return () => ipcRenderer.removeListener('pty:exit', listener);
    },
  },

  // ─── Git ───────────────────────────────────────
  git: {
    status: (cwd) => ipcRenderer.invoke('git:status', cwd),
    log: (cwd, limit) => ipcRenderer.invoke('git:log', cwd, limit),
    branch: (cwd) => ipcRenderer.invoke('git:branch', cwd),
  },

  // ─── Shell ─────────────────────────────────────
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
    showItemInFolder: (filePath) => ipcRenderer.invoke('shell:showItemInFolder', filePath),
  },
});
