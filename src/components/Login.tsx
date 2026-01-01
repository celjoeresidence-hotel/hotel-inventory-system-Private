import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Card } from './ui/Card';
import { IconLock, IconAlertCircle } from './ui/Icons';

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
      setError('System is not configured. Please contact support.');
      return;
    }
    setLoading(true);
    const res = await login(email, password);
    if (!res.ok) {
      setError(res.message ?? 'Invalid email or password');
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-green-700 to-green-900 p-4">
      <Card className="w-full max-w-md p-8 shadow-2xl border-0">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-green-50 rounded-full grid place-items-center mx-auto mb-4 text-green-700 ring-1 ring-green-100">
            <IconLock className="w-8 h-8" />
          </div>
          <h1 className="font-bold text-2xl mb-2 text-gray-900">Welcome Back</h1>
          <p className="text-gray-500 m-0">Sign in to Hotel Inventory System</p>
        </div>

        <form onSubmit={handleSubmit}>
          {error && (
            <div className="bg-error-light text-error p-3 rounded-lg mb-5 text-sm flex items-center gap-2 border border-error-light animate-in slide-in-from-top-2">
              <IconAlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="flex flex-col gap-4">
            <Input
              label="Email Address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="name@hotel.com"
              fullWidth
              className="h-11"
            />
            
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              fullWidth
              className="h-11"
            />

            <Button 
              type="submit" 
              variant="primary" 
              size="lg" 
              className="w-full justify-center mt-4 bg-green-700 hover:bg-green-800 h-11 text-base shadow-lg shadow-green-900/20" 
              isLoading={loading}
            >
              Sign In
            </Button>
          </div>
        </form>
        
        <div className="text-center text-gray-400 text-sm mt-8">
          © {new Date().getFullYear()} Hotel Inventory System
        </div>
      </Card>
    </div>
  );
}
