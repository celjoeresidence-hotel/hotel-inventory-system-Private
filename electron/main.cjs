const { app, BrowserWindow, shell, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const isDev = !app.isPackaged;
const { autoUpdater } = require('electron-updater');

// Configure autoUpdater
autoUpdater.autoDownload = false; // Let user decide or we can set to true
autoUpdater.autoInstallOnAppQuit = true;

// Set App User Model ID for Windows Taskbar Icon
if (process.platform === 'win32') {
  app.setAppUserModelId('com.hotel.inventory');
}

let mainWindow;
let splashWindow;

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 400,
    height: 400,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.center();
}

function createWindow() {
  // Create splash window first
  createSplashWindow();

  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    show: false, // Don't show immediately
    icon: path.join(__dirname, '../build/icon.png'),
    // Kiosk mode for production, but windowed for dev to allow debugging if needed (though we will block devtools)
    kiosk: !isDev, 
    fullscreen: !isDev,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      devTools: false // Explicitly disable DevTools creation at webPreferences level
    },
    // Hide default menu
    autoHideMenuBar: true,
  });

  // Remove menu completely
  mainWindow.setMenu(null);

  const startUrl = isDev
    ? 'http://localhost:5173'
    : `file://${path.join(__dirname, '../dist/index.html')}`;

  mainWindow.loadURL(startUrl);

  // Wait for content to finish loading before showing
  mainWindow.once('ready-to-show', () => {
    // Check for updates
    autoUpdater.checkForUpdatesAndNotify();

    // Add a small delay to ensure the splash screen is seen and UI is painted
    setTimeout(() => {
      if (splashWindow) {
        splashWindow.close();
        splashWindow = null;
      }
      mainWindow.show();
      mainWindow.focus();
    }, 1500); // 1.5s delay for smooth transition
  });

  // Fail-safe: If ready-to-show doesn't fire within 10 seconds, show window anyway
  // This helps debug white screen issues if content is loading but event missed
  setTimeout(() => {
    if (splashWindow) {
        splashWindow.close();
        splashWindow = null;
    }
    if (mainWindow && !mainWindow.isVisible()) {
        mainWindow.show();
        mainWindow.focus();
    }
  }, 10000);

  // Handle load failure
  mainWindow.webContents.on('did-fail-load', () => {
     console.error('Failed to load application');
     if (splashWindow) {
        splashWindow.close();
        splashWindow = null;
     }
     mainWindow.show(); // Show window so user can see error if any (or we could load an error page)
  });

  // Security: Prevent external navigation
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const parsedUrl = new URL(url);
    const validOrigins = [
      'http://localhost:5173', 
      'file:',
      // Add hosted backend URL origin here if needed, but the frontend is loaded locally or from trusted source
    ];
    
    // In production, we are likely loading from file:// or a specific hosted frontend.
    // If wrapping a hosted URL, we would check that origin.
    // For this setup, we assume local bundle or localhost dev.
    
    if (!validOrigins.some(origin => url.startsWith(origin))) {
      event.preventDefault();
      console.log('Blocked navigation to:', url);
    }
  });

  // Security: Handle new window requests (e.g. target="_blank")
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Block all new windows by default, or open in default browser if truly external and necessary
    // For kiosk mode, we typically deny everything.
    return { action: 'deny' };
  });

  // Security: Force close DevTools if somehow opened
  mainWindow.webContents.on('devtools-opened', () => {
    mainWindow.webContents.closeDevTools();
  });

  if (!isDev) {
    // Check for updates
    autoUpdater.checkForUpdatesAndNotify();
  }
}

app.on('ready', () => {
  createWindow();

  // Security: Register global shortcuts to block DevTools keys
  globalShortcut.register('Control+Shift+I', () => { return false; });
  globalShortcut.register('Control+Shift+J', () => { return false; });
  globalShortcut.register('CommandOrControl+U', () => { return false; });
  globalShortcut.register('F12', () => { return false; });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Auto-update events
autoUpdater.on('update-available', (info) => {
  if (mainWindow) {
    mainWindow.webContents.send('update-available', info);
  }
});

autoUpdater.on('update-downloaded', (info) => {
  if (mainWindow) {
    mainWindow.webContents.send('update-downloaded', info);
  }
});

autoUpdater.on('error', (err) => {
  if (mainWindow) {
    mainWindow.webContents.send('update-error', err.toString());
  }
});

autoUpdater.on('download-progress', (progressObj) => {
    if (mainWindow) {
        mainWindow.webContents.send('download-progress', progressObj);
    }
});

// IPC Handlers for Auto Updater
ipcMain.handle('check-for-updates', () => {
    if (!isDev) {
        autoUpdater.checkForUpdates();
    }
});

ipcMain.handle('download-update', () => {
    autoUpdater.downloadUpdate();
});

ipcMain.handle('quit-and-install', () => {
    autoUpdater.quitAndInstall();
});