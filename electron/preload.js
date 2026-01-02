const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Expose safe APIs if needed
  // onUpdateAvailable: (callback) => ipcRenderer.on('update-available', callback),
  // onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', callback),
});

window.addEventListener('DOMContentLoaded', () => {
  // Safe DOM manipulation if needed
});
