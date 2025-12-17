import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login, isConfigured } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isConfigured) {
      setError('Supabase is not configured.');
      return;
    }
    setLoading(true);
    const res = await login(email, password);
    if (!res.ok) {
      setError(res.message ?? 'Login failed');
    }
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 420, margin: '40px auto', textAlign: 'left' }}>
      <h2>Login</h2>
      {error && (
        <div style={{ background: '#ffe5e5', color: '#900', padding: '8px 12px', borderRadius: 6, marginBottom: 12 }}>
          {error}
        </div>
      )}
      <label style={{ display: 'block', marginBottom: 8 }}>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ width: '100%' }} />
      </label>
      <label style={{ display: 'block', marginBottom: 8 }}>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required style={{ width: '100%' }} />
      </label>
      <button type="submit" disabled={loading} style={{ width: '100%', padding: '12px 16px' }}>
        {loading ? 'Logging in...' : 'Login'}
      </button>
    </form>
  );
}