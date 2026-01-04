import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './ui/Button';
import { IconAlertCircle } from './ui/Icons';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class GlobalErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
          <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 text-center border border-gray-200 dark:border-gray-700">
            <div className="mx-auto w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mb-4">
              <IconAlertCircle className="w-6 h-6 text-red-600 dark:text-red-400" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
              Something went wrong
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              An unexpected error occurred. Please try reloading the page.
            </p>
            {this.state.error && (
              <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded text-left mb-6 overflow-auto max-h-32">
                <p className="text-xs font-mono text-red-700 dark:text-red-300 break-words">
                  {this.state.error.message}
                </p>
              </div>
            )}
            <div className="flex gap-3 justify-center">
              <Button onClick={() => window.location.reload()} className="w-full">
                Reload Application
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
