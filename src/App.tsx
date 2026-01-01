import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './components/Login'
import AppShell from './components/AppShell'
import { IconLoader, IconAlertCircle } from './components/ui/Icons'

function Root() {
  const { session, loading, staffId, profileError } = useAuth();
  
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
        <IconLoader className="w-10 h-10 text-green-600 animate-spin mb-4" />
        <div className="text-gray-500 font-medium">Loading Hotel System...</div>
      </div>
    );
  }
  
  if (session && !staffId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white max-w-md w-full p-8 rounded-lg shadow-lg text-center border border-error-light">
          <div className="bg-error-light w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <IconAlertCircle className="w-8 h-8 text-error" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Access Denied</h2>
          <p className="text-gray-600 mb-6">
            Your account is authenticated but no staff profile was found. Please contact the system administrator.
          </p>
          {profileError && (
            <div className="bg-error-light text-error p-3 rounded text-sm text-left">
              Error details: {profileError}
            </div>
          )}
          <button 
            onClick={() => window.location.reload()}
            className="mt-6 w-full py-2 px-4 bg-gray-900 text-white rounded hover:bg-gray-800 transition-colors"
          >
            Refresh Application
          </button>
        </div>
      </div>
    );
  }
  
  return session ? <AppShell /> : <Login />;
}

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  )
}
