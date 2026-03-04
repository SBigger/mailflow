import { useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { Mail, Lock, Loader2 } from 'lucide-react';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message || 'Login fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#f2f5f2' }}>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style={{ backgroundColor: '#7a9b7f' }}>
            <Mail className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold" style={{ color: '#2d3a2d' }}>Artis MailFlow</h1>
          <p className="text-sm mt-1" style={{ color: '#6b826b' }}>Intelligentes E-Mail & Task Management</p>
        </div>

        {/* Form */}
        <div className="rounded-2xl p-6 shadow-sm border" style={{ backgroundColor: '#ffffff', borderColor: '#ccd8cc' }}>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm mb-1.5 font-medium" style={{ color: '#4a5e4a' }}>E-Mail</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#8aaa8f' }} />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="name@artis-treuhand.ch"
                  required
                  className="w-full rounded-lg py-2.5 pl-10 pr-4 focus:outline-none transition-colors"
                  style={{
                    backgroundColor: '#f2f5f2',
                    border: '1px solid #bfcfbf',
                    color: '#2d3a2d',
                  }}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm mb-1.5 font-medium" style={{ color: '#4a5e4a' }}>Passwort</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#8aaa8f' }} />
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full rounded-lg py-2.5 pl-10 pr-4 focus:outline-none transition-colors"
                  style={{
                    backgroundColor: '#f2f5f2',
                    border: '1px solid #bfcfbf',
                    color: '#2d3a2d',
                  }}
                />
              </div>
            </div>

            {error && (
              <div className="rounded-lg p-3 text-sm" style={{ backgroundColor: '#fee2e2', border: '1px solid #fca5a5', color: '#b91c1c' }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 text-white disabled:opacity-50"
              style={{ backgroundColor: '#7a9b7f' }}
              onMouseOver={e => e.currentTarget.style.backgroundColor = '#5f7d64'}
              onMouseOut={e => e.currentTarget.style.backgroundColor = '#7a9b7f'}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {loading ? 'Einloggen...' : 'Einloggen'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs mt-6" style={{ color: '#8aaa8f' }}>
          © 2026 Artis Treuhand GmbH · MailFlow
        </p>
      </div>
    </div>
  );
}
