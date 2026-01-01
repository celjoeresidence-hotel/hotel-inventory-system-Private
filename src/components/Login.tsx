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
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-[400px] p-8 shadow-xl border border-gray-100 bg-white rounded-2xl">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-green-600 rounded-xl flex items-center justify-center mx-auto mb-6 text-white shadow-lg shadow-green-600/20">
            <IconLock className="w-6 h-6" />
          </div>
          <h1 className="font-bold text-2xl mb-2 text-gray-900 tracking-tight">Welcome Back</h1>
          <p className="text-gray-500 text-sm">Sign in to Hotel Inventory System</p>
        </div>

        <form onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-6 text-sm flex items-center gap-2 border border-red-100 animate-in fade-in slide-in-from-top-1">
              <IconAlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="flex flex-col gap-5">
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="name@hotel.com"
              fullWidth
              className="h-11 bg-gray-50 border-gray-200 focus:bg-white transition-colors"
            />
            
            <div>
              <Input
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                fullWidth
                className="h-11 bg-gray-50 border-gray-200 focus:bg-white transition-colors"
              />
            </div>

            <Button 
              type="submit" 
              variant="primary" 
              size="lg" 
              className="w-full justify-center mt-2 bg-green-600 hover:bg-green-700 h-11 text-sm font-medium tracking-wide shadow-lg shadow-green-600/20 rounded-lg transition-all" 
              isLoading={loading}
            >
              Sign In
            </Button>
          </div>
        </form>
        
        <div className="text-center text-gray-400 text-xs mt-8">
          © {new Date().getFullYear()} Hotel Inventory System
        </div>
      </Card>
    </div>
  );
}
