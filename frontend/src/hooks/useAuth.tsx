import { createContext, useContext, useEffect, useState } from 'react';
import { API_BASE_URL } from '../lib/constants';

interface User {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'user';
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  googleLogin: (credential: string) => Promise<void>;
  register: (email: string, password: string, fullName: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const verifySession = async () => {
      try {
        const configRes = await fetch(`${API_BASE_URL}/api/auth/config`);
        if (configRes.ok) {
          const configData = await configRes.json();
          if (configData.localMode) {
            // Check if user explicitly signed out
            if (localStorage.getItem('signed_out') === '1') {
              setLoading(false);
              return;
            }
            setUser({ id: 9999, email: 'admin@bahai.local', name: 'bahAI Developer', role: 'admin' });
            setLoading(false);
            return;
          }
        }
      } catch (err) {
        console.error('Failed to fetch auth configuration', err);
      }

      const token = localStorage.getItem('auth_token');
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
        } else {
          localStorage.removeItem('auth_token');
        }
      } catch (err) {
        console.error('Session verification failed', err);
      } finally {
        setLoading(false);
      }
    };

    verifySession();
  }, []);

  const login = async (email: string, password: string) => {
    const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Giriş uğursuzdur.');

    localStorage.removeItem('signed_out');
    localStorage.setItem('auth_token', data.token);
    setUser(data.user);
  };

  const register = async (email: string, password: string, fullName: string) => {
    const res = await fetch(`${API_BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, fullName })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Qeydiyyat uğursuzdur.');

    localStorage.removeItem('signed_out');
    localStorage.setItem('auth_token', data.token);
    setUser(data.user);
  };

  const googleLogin = async (credential: string) => {
    const res = await fetch(`${API_BASE_URL}/api/auth/google-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Google ilə giriş uğursuzdur.');

    localStorage.removeItem('signed_out');
    localStorage.setItem('auth_token', data.token);
    setUser(data.user);
  };

  const signOut = () => {
    localStorage.removeItem('auth_token');
    localStorage.setItem('signed_out', '1');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, googleLogin, register, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
