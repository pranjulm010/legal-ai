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
  getMyPermissions,
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
  // Effective action list for the current user (hardcoded role defaults +
  // any per-firm RBAC overrides), fetched from GET /auth/my-permissions/.
  // null while it hasn't loaded yet - callers should fall back to the
  // hardcoded lib/permissions.ts matrix during that window.
  permissions: string[] | null;
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
  // Re-fetch the effective action list without a full page reload - call
  // after an RBAC override change that could affect the current user's own
  // role, so the UI reflects it immediately instead of on next login.
  refreshPermissions: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [permissions, setPermissions] = useState<string[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadPermissions = useCallback(() => {
    getMyPermissions()
      .then(setPermissions)
      .catch(() => setPermissions(null));
  }, []);

  useEffect(() => {
    const hydrate = async () => {
      if (!hasToken()) {
        setIsLoading(false);
        return;
      }

      try {
        const me = await fetchMe();
        setUser(me);
        loadPermissions();
      } catch {
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };

    hydrate();
  }, [loadPermissions]);

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
    loadPermissions();

    return data.role;
  }, [loadPermissions]);

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
      loadPermissions();
    },
    [loadPermissions]
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
      loadPermissions();
    },
    [loadPermissions]
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
      loadPermissions();
    },
    [loadPermissions]
  );

  const logout = useCallback(() => {
    logoutApi();
    setUser(null);
    setPermissions(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        permissions,
        isLoading,
        login,
        register,
        registerPublic,
        completeInvite,
        logout,
        refreshPermissions: loadPermissions,
      }}
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
