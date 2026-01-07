import { useEffect, useState } from 'react';
import { Button } from './ui/Button';

interface ElectronAPI {
  onUpdateAvailable: (cb: () => void) => () => void;
  onDownloadProgress?: (cb: (info: { percent?: number }) => void) => () => void;
  onUpdateError?: (cb: (err: string) => void) => () => void;
  onUpdateDownloaded: (cb: () => void) => () => void;
  checkForUpdates: () => void;
  downloadUpdate: () => Promise<void>;
  quitAndInstall: () => Promise<void>;
}

export default function UpdateNotification() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateDownloaded, setUpdateDownloaded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [restartCountdown, setRestartCountdown] = useState<number | null>(null);

  useEffect(() => {
    // Check if running in Electron
    const electronAPI = (window as unknown as { electronAPI?: ElectronAPI }).electronAPI;
    if (!electronAPI) return;

    // Listen for update available
    const unsubscribeAvailable = electronAPI.onUpdateAvailable(() => {
      setUpdateAvailable(true);
      setUpdateError(null);
    });

    // Listen for download progress
    let unsubscribeProgress: (() => void) | undefined;
    if (electronAPI.onDownloadProgress) {
      unsubscribeProgress = electronAPI.onDownloadProgress((info: { percent?: number }) => {
        if (info && typeof info.percent === 'number') {
          setProgress(Math.round(info.percent));
        }
      });
    }

    // Listen for update error
    let unsubscribeError: (() => void) | undefined;
    if (electronAPI.onUpdateError) {
      unsubscribeError = electronAPI.onUpdateError((err: string) => {
        setDownloading(false);
        setUpdateError(err || 'Update failed');
      });
    }

    // Listen for update downloaded
    const unsubscribeDownloaded = electronAPI.onUpdateDownloaded(() => {
      setUpdateDownloaded(true);
      setDownloading(false);
      setUpdateError(null);
      // Start auto restart countdown (5 seconds)
      setRestartCountdown(5);
    });

    // Check for updates on mount
    electronAPI.checkForUpdates();

    return () => {
      if (unsubscribeAvailable) unsubscribeAvailable();
      if (unsubscribeProgress) unsubscribeProgress();
      if (unsubscribeError) unsubscribeError();
      if (unsubscribeDownloaded) unsubscribeDownloaded();
    };
  }, []);

  // Handle countdown for auto-restart
  useEffect(() => {
    if (restartCountdown === null) return;

    if (restartCountdown === 0) {
      const electronAPI = (window as unknown as { electronAPI?: ElectronAPI }).electronAPI;
      if (electronAPI) {
        electronAPI.quitAndInstall();
      }
      return;
    }

    const timer = setTimeout(() => {
      setRestartCountdown((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);

    return () => clearTimeout(timer);
  }, [restartCountdown]);

  const handleDownload = async () => {
    setDownloading(true);
    const electronAPI = (window as unknown as { electronAPI?: ElectronAPI }).electronAPI;
    if (electronAPI) {
      await electronAPI.downloadUpdate();
    }
  };

  const handleRestart = async () => {
    const electronAPI = (window as unknown as { electronAPI?: ElectronAPI }).electronAPI;
    if (electronAPI) {
      await electronAPI.quitAndInstall();
    }
  };

  if (!updateAvailable && !updateDownloaded && !updateError) return null;

  return (
    <div className="fixed bottom-4 right-4 bg-white dark:bg-gray-800 p-4 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50 max-w-sm w-full">
      <h3 className="font-semibold text-lg mb-2 text-gray-900 dark:text-gray-100">
        {updateError ? 'Update Failed' : 'Update Available'}
      </h3>
      
      {updateError ? (
        <div>
          <p className="text-sm text-red-600 dark:text-red-400 mb-4">
            {updateError}
          </p>
          <div className="flex gap-2">
            <Button onClick={() => setUpdateError(null)} variant="outline" className="w-1/2">
              Dismiss
            </Button>
            <Button onClick={handleDownload} className="w-1/2">
              Retry
            </Button>
          </div>
        </div>
      ) : updateDownloaded ? (
        <div>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
            Update downloaded. Restarting in {restartCountdown} seconds...
          </p>
          <Button onClick={handleRestart} className="w-full">
            Restart Now
          </Button>
        </div>
      ) : (
        <div>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
            A new version of the application is available.
          </p>
          {downloading ? (
            <div className="w-full mb-4">
              <div className="flex justify-between text-xs mb-1 text-gray-600 dark:text-gray-300">
                <span>Downloading...</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
                <div 
                  className="bg-green-600 h-2.5 rounded-full transition-all duration-300" 
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
            </div>
          ) : (
            <Button 
              onClick={handleDownload} 
              disabled={downloading}
              className="w-full"
            >
              Download Update
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
