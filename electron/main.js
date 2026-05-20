const { app, BrowserWindow, shell, dialog, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');

let mainWindow = null;
let backendProcess = null;
let tray = null;
const BACKEND_PORT = 3001;
// Detect dev mode: either --dev flag or not packaged (no asar)
const isDev = process.argv.includes('--dev') || !app.isPackaged;

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
  console.log('🔑 OAuth callback received:', url);
  
  try {
    const parsed = new URL(url);
    const token = parsed.searchParams.get('token');
    const userJson = parsed.searchParams.get('user');
    
    if (token && mainWindow) {
      // Send token to renderer
      mainWindow.webContents.executeJavaScript(`
        localStorage.setItem('auth_token', '${token}');
        localStorage.removeItem('signed_out');
        ${userJson ? `localStorage.setItem('auth_user', '${userJson}');` : ''}
        window.location.href = '/chat';
      `);
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
  // User can place .env in app support directory
  const userDataPath = app.getPath('userData');
  const userEnv = path.join(userDataPath, '.env');
  const fs = require('fs');
  // Fallback to project root .env if user-level doesn't exist
  if (!fs.existsSync(userEnv)) {
    const rootEnv = path.join(__dirname, '..', '.env');
    if (fs.existsSync(rootEnv)) return rootEnv;
  }
  return userEnv;
}

function waitForPort(port, timeout = 15000) {
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

function startBackend() {
  return new Promise((resolve, reject) => {
    const backendPath = getBackendPath();
    const envPath = getEnvPath();

    console.log('🚀 Starting backend:', backendPath);

    const env = {
      ...process.env,
      PORT: String(BACKEND_PORT),
      LOCAL_MODE: 'true',
      NODE_ENV: 'development',
      DOTENV_CONFIG_PATH: envPath,
      PATH: `/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:${process.env.PATH || ''}`
    };

    // Find node binary - Electron may not inherit shell PATH
    const fs = require('fs');
    const nodeCandidates = [
      '/usr/local/bin/node',
      '/opt/homebrew/bin/node',
      '/usr/bin/node',
      process.env.NODE_PATH,
      path.join(process.env.HOME || '', '.nvm/versions/node', 'current', 'bin', 'node'),
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

    // Fallback: use 'node' from PATH (works in --dev mode)
    if (!selectedNode) {
      selectedNode = 'node';
    }

    console.log('📍 Using node:', selectedNode);
    console.log('📍 Backend path:', backendPath);
    console.log('📍 Backend exists:', fs.existsSync(backendPath));
    console.log('📍 Node exists:', fs.existsSync(selectedNode));
    console.log('📍 CWD:', path.dirname(backendPath));

    backendProcess = spawn(selectedNode, [backendPath], {
      cwd: path.dirname(backendPath),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: !selectedNode.startsWith('/')  // Use shell only if not absolute path
    });

    backendProcess.stdout.on('data', (data) => {
      console.log(`[backend] ${data.toString().trim()}`);
    });

    backendProcess.stderr.on('data', (data) => {
      console.error(`[backend:err] ${data.toString().trim()}`);
    });

    backendProcess.on('error', (err) => {
      console.error('Backend process error:', err);
      reject(err);
    });

    backendProcess.on('exit', (code) => {
      console.log(`Backend exited with code ${code}`);
      backendProcess = null;
    });

    // Wait for backend to be ready
    waitForPort(BACKEND_PORT)
      .then(() => {
        console.log('✅ Backend is ready on port', BACKEND_PORT);
        resolve();
      })
      .catch(reject);
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
      webSecurity: true
    },
    show: false,
    icon: path.join(__dirname, 'icons', 'icon.png')
  });

  // Load the app
  if (process.argv.includes('--dev')) {
    // Dev mode: use Vite dev server
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // Production/normal mode: start from landing page (user needs to login)
    mainWindow.loadURL(`http://localhost:${BACKEND_PORT}`);
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Retry loading if page fails (backend might not be fully ready)
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.log('Page load failed, retrying in 1s...', errorDescription);
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
  // Set app name
  app.setName('bahAI');
  
  createMenu();

  try {
    await startBackend();
    createWindow();
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
  stopBackend();
});

app.on('quit', () => {
  stopBackend();
});
