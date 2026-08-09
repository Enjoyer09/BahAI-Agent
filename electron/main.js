const { app, BrowserWindow, shell, dialog, Menu, Tray, nativeImage, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const net = require('net');
const ipcHandlers = require('./ipcHandlers');
const ptyManager = require('./ptyManager');

ipcMain.handle('dialog:openDirectory', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Layihə qovluğunu seçin'
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

let mainWindow = null;
let backendProcess = null;
let tray = null;
const BACKEND_PORT = 3001;
const verboseDesktopLogs = process.env.BAHAI_DESKTOP_DEBUG === 'true';
// Detect dev mode: either --dev flag or not packaged (no asar)
const isDev = process.argv.includes('--dev') || !app.isPackaged;
const useBackendUiInDev = process.argv.includes('--backend-ui');

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

// Set app name for Dock and menu bar
if (app.dock) {
  app.dock.setBadge('');
}
app.setName('bahAI');

// Register custom protocol for OAuth callback
if (process.defaultApp) {
  app.setAsDefaultProtocolClient('bahai', process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient('bahai');
}

// Handle OAuth callback URL (bahai://auth/callback?token=xxx)
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (verboseDesktopLogs) console.log('🔑 OAuth callback received:', url);
  
  try {
    const parsed = new URL(url);
    const token = parsed.searchParams.get('token');
    const userJson = parsed.searchParams.get('user');
    
    if (token && mainWindow) {
      mainWindow.webContents.send('auth:callback', {
        token,
        user: userJson || null
      });
      mainWindow.focus();
    }
  } catch (err) {
    console.error('OAuth callback error:', err);
  }
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function getBackendPath() {
  if (isDev) {
    return path.join(__dirname, '..', 'backend', 'index.js');
  }
  // In packaged app, backend is in resources
  return path.join(process.resourcesPath, 'backend', 'index.js');
}

function getEnvPath() {
  if (isDev) {
    return path.join(__dirname, '..', '.env');
  }
  const userDataPath = app.getPath('userData');
  const userEnv = path.join(userDataPath, '.env');
  if (fs.existsSync(userEnv)) return userEnv;

  const resourcesEnv = path.join(process.resourcesPath, '.env');
  if (fs.existsSync(resourcesEnv)) return resourcesEnv;

  const rootEnv = path.join(__dirname, '..', '.env');
  if (fs.existsSync(rootEnv)) return rootEnv;

  try {
    const defaultEnvContent = `PORT=3001\nLOCAL_MODE=true\nNODE_ENV=development\nOPENAI_BASE_URL=http://localhost:11434/v1\nOPENAI_API_KEY=ollama\nOPENAI_MODEL=qwen2.5-coder:latest\n`;
    fs.writeFileSync(userEnv, defaultEnvContent, 'utf-8');
    return userEnv;
  } catch {
    return userEnv;
  }
}

function waitForPort(port, timeout = 25000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const socket = new net.Socket();
      socket.setTimeout(500);
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - start > timeout) {
          reject(new Error(`Backend did not start within ${timeout}ms`));
        } else {
          setTimeout(check, 300);
        }
      });
      socket.on('timeout', () => {
        socket.destroy();
        setTimeout(check, 300);
      });
      socket.connect(port, '127.0.0.1');
    };
    check();
  });
}

async function startBackend() {
  // Check if port is already active
  try {
    await waitForPort(BACKEND_PORT, 1200);
    console.log('✅ Existing backend server detected on port', BACKEND_PORT);
    return;
  } catch {
    // Proceed to spawn backend process
  }

  return new Promise((resolve, reject) => {
    const backendPath = getBackendPath();
    const envPath = getEnvPath();
    const localDbPath = path.join(app.getPath('userData'), 'local_db.json');
    const backendDir = path.dirname(backendPath);
    const backendNodeModules = path.join(backendDir, 'node_modules');
    const resourcesNodeModules = app.isPackaged ? path.join(process.resourcesPath, 'node_modules') : '';
    const rootNodeModules = path.join(backendDir, '..', 'node_modules');

    const nodePath = [
      backendNodeModules,
      resourcesNodeModules,
      rootNodeModules,
      process.env.NODE_PATH
    ].filter((p) => p && fs.existsSync(p)).join(path.delimiter);

    const env = {
      ...process.env,
      NODE_PATH: nodePath,
      PORT: String(BACKEND_PORT),
      HOST: '127.0.0.1',
      LOCAL_MODE: 'true',
      NODE_ENV: 'development',
      DOTENV_CONFIG_PATH: envPath,
      LOCAL_DB_PATH: localDbPath,
      ALLOWED_DIRECTORIES: [
        path.join(__dirname, '..'),
        path.join(process.env.HOME || '', 'Documents'),
      ].join(','),
      PATH: `/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:${process.env.PATH || ''}`
    };

    const nodeCandidates = [
      '/usr/local/bin/node',
      '/opt/homebrew/bin/node',
      '/usr/bin/node',
      process.env.NODE_PATH,
      path.join(process.env.HOME || '', '.nvm/versions/node', 'current', 'bin', 'node'),
      app.isPackaged ? process.execPath : null,
    ].filter(Boolean);

    let selectedNode = null;
    for (const candidate of nodeCandidates) {
      try {
        if (fs.existsSync(candidate)) {
          selectedNode = candidate;
          break;
        }
      } catch {}
    }

    if (!selectedNode) {
      selectedNode = 'node';
    }
    if (app.isPackaged && selectedNode === process.execPath) {
      env.ELECTRON_RUN_AS_NODE = '1';
    }

    const backendLogs = [];
    backendProcess = spawn(selectedNode, [backendPath], {
      cwd: path.dirname(backendPath),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: !selectedNode.startsWith('/')
    });

    backendProcess.stdout.on('data', (data) => {
      const str = data.toString().trim();
      backendLogs.push(`[stdout] ${str}`);
      console.log(`[backend] ${str}`);
    });

    backendProcess.stderr.on('data', (data) => {
      const str = data.toString().trim();
      backendLogs.push(`[stderr] ${str}`);
      console.error(`[backend:err] ${str}`);
    });

    backendProcess.on('error', (err) => {
      console.error('Backend process error:', err);
      reject(err);
    });

    backendProcess.on('exit', (code) => {
      if (verboseDesktopLogs) console.log(`Backend exited with code ${code}`);
      backendProcess = null;
    });

    // Wait for backend port
    waitForPort(BACKEND_PORT, 25000)
      .then(() => {
        console.log('✅ Backend is ready on port', BACKEND_PORT);
        resolve();
      })
      .catch((err) => {
        const lastErrLog = backendLogs.slice(-10).join('\n');
        const detailMsg = lastErrLog ? `\n\nLog təfərrüatları:\n${lastErrLog}` : '';
        reject(new Error(`Backend serveri 25 saniyə ərzində başlamadı (${BACKEND_PORT}).${detailMsg}`));
      });
  });
}

function stopBackend() {
  if (backendProcess) {
    backendProcess.kill('SIGTERM');
    backendProcess = null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0f0f0f',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js')
    },
    show: false,
    icon: path.join(__dirname, 'icons', 'icon.png')
  });

  // Load the app
  if (process.argv.includes('--dev') && !useBackendUiInDev) {
    // Dev mode: use Vite dev server
    mainWindow.loadURL('http://localhost:5173');
    if (process.env.BAHAI_DESKTOP_DEVTOOLS === 'true') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    // Production/desktop mode: use backend-served frontend build so the app
    // is not coupled to a stale or conflicting Vite dev server.
    mainWindow.loadURL(`http://localhost:${BACKEND_PORT}`);
    if (process.argv.includes('--dev') && process.env.BAHAI_DESKTOP_DEVTOOLS === 'true') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Retry loading if page fails (backend might not be fully ready)
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    if (verboseDesktopLogs) console.log('Page load failed, retrying in 1s...', errorDescription);
    setTimeout(() => {
      mainWindow.loadURL(`http://localhost:${BACKEND_PORT}/chat`);
    }, 1000);
  });

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createMenu() {
  const template = [
    {
      label: 'bahAI',
      submenu: [
        { 
          label: 'bahAI haqqında',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'bahAI haqqında',
              message: 'bahAI',
              detail: `Versiya: 1.0.0\nAI Coding Agent\n\nNode.js: ${process.versions.node}\nElectron: ${process.versions.electron}\nChromium: ${process.versions.chrome}\n\n© 2024 bahAI Team`,
              buttons: ['OK']
            });
          }
        },
        { type: 'separator' },
        { label: 'Parametrlər...', accelerator: 'Cmd+,', click: () => mainWindow?.webContents.send('open-settings') },
        { type: 'separator' },
        { label: 'bahAI-ı gizlə', role: 'hide' },
        { label: 'Digərlərini gizlə', role: 'hideOthers' },
        { label: 'Hamısını göstər', role: 'unhide' },
        { type: 'separator' },
        { label: 'Çıxış', accelerator: 'Cmd+Q', role: 'quit' }
      ]
    },
    {
      label: 'Redaktə',
      submenu: [
        { label: 'Geri al', role: 'undo' },
        { label: 'Yenidən et', role: 'redo' },
        { type: 'separator' },
        { label: 'Kəs', role: 'cut' },
        { label: 'Kopyala', role: 'copy' },
        { label: 'Yapışdır', role: 'paste' },
        { label: 'Hamısını seç', role: 'selectAll' }
      ]
    },
    {
      label: 'Görünüş',
      submenu: [
        { label: 'Yenilə', role: 'reload' },
        { label: 'Tam ekran', role: 'togglefullscreen' },
        { type: 'separator' },
        { label: 'Böyüt', role: 'zoomIn' },
        { label: 'Kiçilt', role: 'zoomOut' },
        { label: 'Normal ölçü', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Developer Tools', role: 'toggleDevTools', accelerator: 'Alt+Cmd+I' }
      ]
    },
    {
      label: 'Pəncərə',
      submenu: [
        { label: 'Kiçilt', role: 'minimize' },
        { label: 'Böyüt', role: 'zoom' },
        { type: 'separator' },
        { label: 'Yeni söhbət', accelerator: 'Cmd+N', click: () => mainWindow?.webContents.send('new-chat') }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// App lifecycle
app.whenReady().then(async () => {
  // The current product has no voice workflow. Never grant camera or
  // microphone access silently.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(false);
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission, origin) => {
    return false;
  });

  // Set app name
  app.setName('bahAI');
  
  createMenu();

  try {
    await startBackend();
    createWindow();
    // Register Desktop App Builder IPC handlers
    const allowedDirs = [
      path.join(__dirname, '..'),
      path.join(process.env.HOME || '', 'Documents'),
      path.join(process.env.HOME || '', 'Desktop'),
    ].filter(d => fs.existsSync(d));
    ipcHandlers.register(mainWindow, allowedDirs);
  } catch (err) {
    console.error('Failed to start:', err);
    dialog.showErrorBox(
      'bahAI başlaya bilmədi',
      `Backend serveri işə düşmədi:\n${err.message}\n\n.env faylını yoxlayın.`
    );
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  ipcHandlers.cleanup();
  stopBackend();
});

app.on('quit', () => {
  stopBackend();
});
