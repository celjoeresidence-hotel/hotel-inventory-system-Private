const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),
  onUpdateAvailable: (callback) => {
    const subscription = (event, value) => callback(value);
    ipcRenderer.on('update-available', subscription);
    return () => ipcRenderer.removeListener('update-available', subscription);
  },
  onUpdateDownloaded: (callback) => {
    const subscription = (event, value) => callback(value);
    ipcRenderer.on('update-downloaded', subscription);
    return () => ipcRenderer.removeListener('update-downloaded', subscription);
  },
  onUpdateError: (callback) => {
    const subscription = (event, value) => callback(value);
    ipcRenderer.on('update-error', subscription);
    return () => ipcRenderer.removeListener('update-error', subscription);
  },
  onDownloadProgress: (callback) => {
    const subscription = (event, value) => callback(value);
    ipcRenderer.on('download-progress', subscription);
    return () => ipcRenderer.removeListener('download-progress', subscription);
  },
});

window.addEventListener('DOMContentLoaded', () => {
  // Safe DOM manipulation if needed
});
