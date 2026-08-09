"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { apiFetch } from "./api";

export type UserRole = "owner" | "manager" | "cleaner" | "maintenance";

export interface Session {
  token: string;
  accountId: string;
  email: string;
  role: UserRole;
}

interface SessionContextValue {
  session: Session | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (accountName: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const STORAGE_KEY = "blanify_admin_session";

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setSession(JSON.parse(stored) as Session);
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
    setIsLoading(false);
  }, []);

  function persist(next: Session) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSession(next);
  }

  async function login(email: string, password: string) {
    const body = await apiFetch<{ token: string; accountId: string; role: UserRole }>("/api/v1/auth/login", null, {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    persist({ token: body.token, accountId: body.accountId, email, role: body.role });
  }

  async function register(accountName: string, email: string, password: string) {
    const body = await apiFetch<{ token: string; accountId: string; role: UserRole }>("/api/v1/auth/register", null, {
      method: "POST",
      body: JSON.stringify({ accountName, email, password }),
    });
    persist({ token: body.token, accountId: body.accountId, email, role: body.role });
  }

  function logout() {
    window.localStorage.removeItem(STORAGE_KEY);
    setSession(null);
  }

  return (
    <SessionContext.Provider value={{ session, isLoading, login, register, logout }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return context;
}
