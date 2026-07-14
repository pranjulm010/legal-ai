const ACCESS_TOKEN_KEY = "legal_ai_access_token";
const REFRESH_TOKEN_KEY = "legal_ai_refresh_token";

export const getAccessToken = (): string | null => {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACCESS_TOKEN_KEY);
};

export const getRefreshToken = (): string | null => {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REFRESH_TOKEN_KEY);
};

export const setTokens = (access: string, refresh: string) => {
  localStorage.setItem(ACCESS_TOKEN_KEY, access);
  localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
};

export const setAccessToken = (access: string) => {
  localStorage.setItem(ACCESS_TOKEN_KEY, access);
};

export const clearTokens = () => {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
};

export const isAuthenticated = (): boolean => {
  return !!getAccessToken();
};
