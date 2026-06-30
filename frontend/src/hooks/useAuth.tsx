import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
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
  getAuthHeader: () => Record<string, string>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// P1-FIX: Refresh token logic — transparently refresh access token on 401
async function attemptRefresh(): Promise<string | null> {
  const refreshToken = localStorage.getItem('refresh_token');
  if (!refreshToken) return null;

  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });

    if (!res.ok) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('refresh_token');
      return null;
    }

    const data = await res.json();
    localStorage.setItem('auth_token', data.token);
    if (data.refreshToken) localStorage.setItem('refresh_token', data.refreshToken);
    return data.token;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshInFlight = useRef<Promise<string | null> | null>(null);

  // P1-FIX: singleton refresh to avoid race conditions
  const refreshAccessToken = useCallback(async () => {
    if (!refreshInFlight.current) {
      refreshInFlight.current = attemptRefresh().finally(() => {
        refreshInFlight.current = null;
      });
    }
    return refreshInFlight.current;
  }, []);

  // P1-FIX: helper that returns the auth header (used by api.ts and other callers)
  const getAuthHeader = useCallback((): Record<string, string> => {
    const token = localStorage.getItem('auth_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  }, []);

  useEffect(() => {
    const verifySession = async () => {
      try {
        const configRes = await fetch(`${API_BASE_URL}/api/auth/config`);
        if (configRes.ok) {
          const configData = await configRes.json();
          if (configData.localMode) {
            const existingToken = localStorage.getItem('auth_token');
            if (existingToken) {
              try {
                const meRes = await fetch(`${API_BASE_URL}/api/auth/me`, {
                  headers: { 'Authorization': `Bearer ${existingToken}` }
                });
                if (meRes.ok) {
                  const meData = await meRes.json();
                  setUser(meData.user);
                  setLoading(false);
                  return;
                }
                if (meRes.status === 401 || meRes.status === 403) {
                  // Try refresh before giving up
                  const newToken = await refreshAccessToken();
                  if (newToken) {
                    const retryRes = await fetch(`${API_BASE_URL}/api/auth/me`, {
                      headers: { 'Authorization': `Bearer ${newToken}` }
                    });
                    if (retryRes.ok) {
                      const retryData = await retryRes.json();
                      setUser(retryData.user);
                      setLoading(false);
                      return;
                    }
                  }
                  localStorage.removeItem('auth_token');
                  localStorage.removeItem('refresh_token');
                }
              } catch {}
            }
            
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
        let res = await fetch(`${API_BASE_URL}/api/auth/me`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        // P1-FIX: if 401/403, try to refresh
        if (res.status === 401 || res.status === 403) {
          const newToken = await refreshAccessToken();
          if (newToken) {
            res = await fetch(`${API_BASE_URL}/api/auth/me`, {
              headers: { 'Authorization': `Bearer ${newToken}` }
            });
          }
        }

        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
        } else {
          localStorage.removeItem('auth_token');
          localStorage.removeItem('refresh_token');
        }
      } catch (err) {
        console.error('Session verification failed', err);
      } finally {
        setLoading(false);
      }
    };

    verifySession();
  }, [refreshAccessToken]);

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
    if (data.refreshToken) localStorage.setItem('refresh_token', data.refreshToken);
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
    if (data.refreshToken) localStorage.setItem('refresh_token', data.refreshToken);
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
    if (data.refreshToken) localStorage.setItem('refresh_token', data.refreshToken);
    setUser(data.user);
  };

  const signOut = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('refresh_token');
    localStorage.setItem('signed_out', '1');
    setUser(null);
    window.history.pushState({}, '', '/');
    window.location.href = '/';
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, googleLogin, register, signOut, getAuthHeader }}>
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
