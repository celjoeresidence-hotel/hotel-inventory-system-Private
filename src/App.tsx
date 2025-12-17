import './App.css'
import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './components/Login'
import AppShell from './components/AppShell'

function Root() {
  const { session, loading, staffId, profileError } = useAuth();
  if (loading) {
    return (
      <div className="app-loading">
        <div className="spinner" aria-label="Loading" />
        <div className="loading-text">Loading...</div>
      </div>
    );
  }
  if (session && !staffId) {
    return (
      <div className="blocking-error">
        <h2>Staff profile not found. Contact administrator.</h2>
        {profileError && (
          <div className="error-box" style={{ marginTop: 12 }}>
            {profileError}
          </div>
        )}
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
