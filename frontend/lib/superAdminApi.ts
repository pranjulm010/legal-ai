import axios from "axios";
import { BASE_URL } from "./api";

// Entirely separate from the firm-scoped auth flow (lib/auth.ts, api.ts,
// AuthContext) - a super admin isn't a LawyerProfile and shouldn't share
// token storage with a regular firm login in the same browser.
const SUPER_ADMIN_TOKEN_KEY = "legal_ai_super_admin_access_token";

export const getSuperAdminToken = (): string | null => {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(SUPER_ADMIN_TOKEN_KEY);
};

export const setSuperAdminToken = (token: string) => {
  localStorage.setItem(SUPER_ADMIN_TOKEN_KEY, token);
};

export const clearSuperAdminToken = () => {
  localStorage.removeItem(SUPER_ADMIN_TOKEN_KEY);
};

const superAdminApi = axios.create({ baseURL: BASE_URL });

superAdminApi.interceptors.request.use((config) => {
  const token = getSuperAdminToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export interface SuperAdminLoginResponse {
  access: string;
  refresh: string;
  full_name: string;
}

export const superAdminLogin = async (
  username: string,
  password: string
): Promise<SuperAdminLoginResponse> => {
  const response = await axios.post(`${BASE_URL}/super-admin/login/`, {
    username,
    password,
  });
  setSuperAdminToken(response.data.access);
  return response.data;
};

export interface FirmSummary {
  id: number;
  name: string;
  slug: string;
  size: string;
  is_active: boolean;
  lawyer_count: number;
  active_lawyer_count: number;
  document_count: number;
  case_count: number;
  draft_count: number;
  created_at: string;
}

export interface PlatformStats {
  total_firms: number;
  active_firms: number;
  total_lawyers: number;
  total_documents: number;
  total_ai_queries: number;
  total_drafts: number;
}

export const listAllFirms = async (): Promise<FirmSummary[]> => {
  const response = await superAdminApi.get("/super-admin/firms/");
  return response.data;
};

export const getPlatformStats = async (): Promise<PlatformStats> => {
  const response = await superAdminApi.get("/super-admin/stats/");
  return response.data;
};

export const updateFirmStatus = async (
  firmId: number,
  payload: Partial<{ name: string; is_active: boolean }>
): Promise<FirmSummary> => {
  const response = await superAdminApi.patch(`/super-admin/firms/${firmId}/`, payload);
  return response.data;
};

export const deleteFirm = async (firmId: number): Promise<void> => {
  await superAdminApi.delete(`/super-admin/firms/${firmId}/`);
};
