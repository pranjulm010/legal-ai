"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  fetchMe,
  login as loginApi,
  logout as logoutApi,
  register as registerApi,
  registerPublic as registerPublicApi,
  setPassword as setPasswordApi,
  type FirmOnboardingDetails,
} from "./api";
import { isAuthenticated as hasToken } from "./auth";

type AuthUser = {
  username: string;
  full_name: string;
  role: string;
  firm_id: number;
  firm_name: string;
  firm_size: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<string>;
  register: (
    username: string,
    password: string,
    email: string,
    fullName?: string,
    firmName?: string,
    firmSize?: string,
    firmDetails?: FirmOnboardingDetails
  ) => Promise<void>;
  registerPublic: (
    username: string,
    password: string,
    email: string,
    fullName?: string
  ) => Promise<void>;
  completeInvite: (uid: string, token: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const hydrate = async () => {
      if (!hasToken()) {
        setIsLoading(false);
        return;
      }

      try {
        const me = await fetchMe();
        setUser(me);
      } catch {
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };

    hydrate();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const data = await loginApi(username, password);

    setUser({
      username: data.full_name,
      full_name: data.full_name,
      role: data.role,
      firm_id: data.firm_id,
      firm_name: data.firm_name,
      firm_size: data.firm_size,
    });

    return data.role;
  }, []);

  const register = useCallback(
    async (
      username: string,
      password: string,
      email: string,
      fullName: string = "",
      firmName?: string,
      firmSize?: string,
      firmDetails?: FirmOnboardingDetails
    ) => {
      const data = await registerApi(
        username,
        password,
        email,
        fullName,
        firmName,
        firmSize,
        firmDetails
      );

      setUser({
        username: data.full_name,
        full_name: data.full_name,
        role: data.role,
        firm_id: data.firm_id,
        firm_name: data.firm_name,
        firm_size: data.firm_size,
      });
    },
    []
  );

  const registerPublic = useCallback(
    async (username: string, password: string, email: string, fullName: string = "") => {
      const data = await registerPublicApi(username, password, email, fullName);

      setUser({
        username: data.full_name,
        full_name: data.full_name,
        role: data.role,
        firm_id: data.firm_id,
        firm_name: data.firm_name,
        firm_size: data.firm_size,
      });
    },
    []
  );

  const completeInvite = useCallback(
    async (uid: string, token: string, password: string) => {
      const data = await setPasswordApi(uid, token, password);

      setUser({
        username: data.full_name,
        full_name: data.full_name,
        role: data.role,
        firm_id: data.firm_id,
        firm_name: data.firm_name,
        firm_size: data.firm_size,
      });
    },
    []
  );

  const logout = useCallback(() => {
    logoutApi();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, isLoading, login, register, registerPublic, completeInvite, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
}
