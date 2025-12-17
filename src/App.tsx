import './App.css'
import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './components/Login'
import AppShell from './components/AppShell'

function Root() {
  const { session, loading } = useAuth();
  if (loading) {
    return <div style={{ padding: 24 }}>Loading...</div>;
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
