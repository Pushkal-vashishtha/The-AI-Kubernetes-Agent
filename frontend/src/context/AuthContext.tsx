import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { insforge } from "../lib/insforge";
import type { AuthUser } from "../types";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<{ error: string | null; needsVerification: boolean }>;
  verifyEmail: (email: string, otp: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  getToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const tokenRef = useRef<string | null>(null);

  // Cold load: rehydrate the session from the httpOnly refresh cookie.
  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      const { data } = await insforge.auth.refreshSession();
      if (cancelled) return;
      if (data?.accessToken && data.user) {
        tokenRef.current = data.accessToken;
        setUser({ id: data.user.id, email: data.user.email ?? "" });
      }
      setLoading(false);
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await insforge.auth.signInWithPassword({ email, password });
    if (error) return error.message;
    if (data?.accessToken && data.user) {
      tokenRef.current = data.accessToken;
      setUser({ id: data.user.id, email: data.user.email ?? "" });
    }
    return null;
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { data, error } = await insforge.auth.signUp({ email, password });
    if (error) return { error: error.message, needsVerification: false };
    if (data?.requireEmailVerification) {
      return { error: null, needsVerification: true };
    }
    if (data?.accessToken && data.user) {
      tokenRef.current = data.accessToken;
      setUser({ id: data.user.id, email: data.user.email ?? "" });
    }
    return { error: null, needsVerification: false };
  }, []);

  // 6-digit code flow — a successful verify signs the user in.
  const verifyEmail = useCallback(async (email: string, otp: string) => {
    const { data, error } = await insforge.auth.verifyEmail({ email, otp });
    if (error) return error.message;
    if (data?.accessToken && data.user) {
      tokenRef.current = data.accessToken;
      setUser({ id: data.user.id, email: data.user.email ?? "" });
    }
    return null;
  }, []);

  const signOut = useCallback(async () => {
    await insforge.auth.signOut();
    tokenRef.current = null;
    setUser(null);
  }, []);

  // Access token for calls to our Express backend; refreshes when missing.
  const getToken = useCallback(async () => {
    if (tokenRef.current) return tokenRef.current;
    const { data } = await insforge.auth.refreshSession();
    tokenRef.current = data?.accessToken ?? null;
    return tokenRef.current;
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, verifyEmail, signOut, getToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}
