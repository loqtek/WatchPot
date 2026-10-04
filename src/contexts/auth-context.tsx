"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { apiFetch, clearClientSession } from "@/lib/api";
import type { UserOut } from "@/lib/types";

type AuthContextValue = {
  user: UserOut | null;
  loading: boolean;
  logout: () => void;
  refetch: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<UserOut | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const u = await apiFetch<UserOut>("/auth/me");
      setUser(u);
      if (u.must_change_password) {
        router.replace("/change-password");
      }
    } catch {
      setUser(null);
      clearClientSession();
      router.replace("/login");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const logout = useCallback(() => {
    void apiFetch("/auth/logout", { method: "POST" }).catch(() => undefined);
    clearClientSession();
    setUser(null);
    router.push("/login");
  }, [router]);

  const value = useMemo(
    () => ({ user, loading, logout, refetch }),
    [user, loading, logout, refetch],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
