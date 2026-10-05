import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AuthSessionSchema, type AuthSession, type PublicUser } from '@opsgraph/shared';
import { apiFetch, setAccessToken, setOnAuthFailure } from '../lib/api-client';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthContextValue {
  status: AuthStatus;
  user: PublicUser | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  setSession: (session: AuthSession) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<PublicUser | null>(null);

  const setSession = useCallback((session: AuthSession) => {
    setAccessToken(session.accessToken);
    setUser(session.user);
    setStatus('authenticated');
  }, []);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setStatus('anonymous');
  }, []);

  useEffect(() => {
    let cancelled = false;

    const restore = async (): Promise<void> => {
      try {
        const session = await apiFetch('/auth/refresh', {
          method: 'POST',
          schema: AuthSessionSchema,
        });
        if (!cancelled) {
          setSession(session);
        }
      } catch {
        if (!cancelled) {
          clearSession();
        }
      }
    };

    void restore();
    return () => {
      cancelled = true;
    };
  }, [setSession, clearSession]);

  useEffect(() => {
    setOnAuthFailure(clearSession);
    return () => {
      setOnAuthFailure(null);
    };
  }, [clearSession]);

  const login = useCallback(
    async (email: string, password: string): Promise<void> => {
      const session = await apiFetch('/auth/login', {
        method: 'POST',
        body: { email, password },
        schema: AuthSessionSchema,
      });
      setSession(session);
    },
    [setSession],
  );

  const logout = useCallback(async (): Promise<void> => {
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => undefined);
    clearSession();
  }, [clearSession]);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<void> => {
      const session = await apiFetch('/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
        schema: AuthSessionSchema,
      });
      setSession(session);
    },
    [setSession],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, logout, changePassword, setSession }),
    [status, user, login, logout, changePassword, setSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
