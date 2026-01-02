import { useEffect, useState } from 'react';
import { Button } from './ui/Button';

export default function UpdateNotification() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateDownloaded, setUpdateDownloaded] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    // Check if running in Electron
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI) return;

    // Listen for update available
    const unsubscribeAvailable = electronAPI.onUpdateAvailable(() => {
      setUpdateAvailable(true);
    });

    // Listen for update downloaded
    const unsubscribeDownloaded = electronAPI.onUpdateDownloaded(() => {
      setUpdateDownloaded(true);
      setDownloading(false);
    });

    // Check for updates on mount
    electronAPI.checkForUpdates();

    return () => {
      unsubscribeAvailable();
      unsubscribeDownloaded();
    };
  }, []);

  const handleDownload = async () => {
    setDownloading(true);
    const electronAPI = (window as any).electronAPI;
    if (electronAPI) {
      await electronAPI.downloadUpdate();
    }
  };

  const handleRestart = async () => {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI) {
      await electronAPI.quitAndInstall();
    }
  };

  if (!updateAvailable && !updateDownloaded) return null;

  return (
    <div className="fixed bottom-4 right-4 bg-white dark:bg-gray-800 p-4 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50 max-w-sm">
      <h3 className="font-semibold text-lg mb-2 text-gray-900 dark:text-gray-100">Update Available</h3>
      
      {updateDownloaded ? (
        <div>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
            A new version has been downloaded. Restart the application to apply changes.
          </p>
          <Button onClick={handleRestart} className="w-full">
            Restart & Install
          </Button>
        </div>
      ) : (
        <div>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
            A new version of the application is available.
          </p>
          <Button 
            onClick={handleDownload} 
            disabled={downloading}
            className="w-full"
          >
            {downloading ? 'Downloading...' : 'Download Update'}
          </Button>
        </div>
      )}
    </div>
  );
}
