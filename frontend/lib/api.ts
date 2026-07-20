import axios from "axios";
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setAccessToken,
  setTokens,
} from "./auth";

const RAW_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "http://127.0.0.1:8000/api";

export const BASE_URL = RAW_BASE_URL.replace(/\/$/, "");

const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use((config) => {
  const token = getAccessToken();

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

let refreshPromise: Promise<string | null> | null = null;

const attemptRefresh = async (): Promise<string | null> => {
  const refresh = getRefreshToken();
  if (!refresh) return null;

  try {
    const response = await axios.post(`${BASE_URL}/auth/refresh/`, { refresh });
    const newAccess = response.data.access as string;
    setAccessToken(newAccess);
    return newAccess;
  } catch {
    return null;
  }
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      getRefreshToken()
    ) {
      originalRequest._retry = true;

      if (!refreshPromise) {
        refreshPromise = attemptRefresh().finally(() => {
          refreshPromise = null;
        });
      }

      const newAccess = await refreshPromise;

      if (newAccess) {
        originalRequest.headers.Authorization = `Bearer ${newAccess}`;
        return api(originalRequest);
      }

      clearTokens();

      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
    }

    return Promise.reject(error);
  }
);

export type UserType = "public" | "lawyer";

export type ResponseMode = "plain_english" | "mixed" | "professional";

export interface SendMessagePayload {
  question: string;
  userId?: string;
  sessionId?: string;
  userType?: UserType;
  mode?: ResponseMode;
  documentId?: string | null;
  documentType?: string | null;
  caseId?: number | null;
  allowWebSearch?: boolean;
  useAgent?: boolean;
  useAdvancedAgent?: boolean;
  chatSessionId?: number | null;
  region?: string | null;
}

export interface ResearchStep {
  sub_question: string;
  source_type: string;
  resolved: boolean;
}

export interface AskQuestionResponse {
  question: string;
  answer: string;
  sources: unknown[];
  chat_id: number | null;
  chat_session_id: number | null;
  needs_web_confirmation: boolean;
  research_steps: ResearchStep[] | null;
  route?: string | null;
  confidence_level?: string | null;
}

export type UploadDocumentResponse = {
  status?: string;
  message?: string;
  document_id?: string;
  documentId?: string;
  id?: string;
  file_name?: string;
  filename?: string;
  name?: string;
  total_pages?: number;
  document_type?: string;
};

export const uploadDocument = async (
  file: File,
  userId: string = "anonymous",
  caseId?: string | null
): Promise<UploadDocumentResponse> => {
  const formData = new FormData();

  formData.append("file", file);
  formData.append("user_id", userId);

  if (caseId) {
    formData.append("case_id", caseId);
  }

  const response = await api.post(`/upload-document/`, formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });

  return response.data;
};

export const uploadPDF = uploadDocument;

export interface DocumentStatus {
  document_id: string;
  status: "processing" | "ready" | "failed" | string;
  total_chunks: number;
  error_message: string;
}

export const getDocumentStatus = async (documentId: string): Promise<DocumentStatus> => {
  const response = await api.get(`/documents/${documentId}/status/`);
  return response.data;
};

// Polls a just-uploaded document's processing status until it leaves
// "processing" (or the attempt budget runs out), so the caller can show a
// "processing..." state instead of letting the user ask questions before
// chunks/embeddings exist yet.
export const waitForDocumentReady = async (
  documentId: string,
  { intervalMs = 2000, maxAttempts = 60 }: { intervalMs?: number; maxAttempts?: number } = {}
): Promise<DocumentStatus> => {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await getDocumentStatus(documentId);
    if (status.status !== "processing") {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Document is still processing after an extended wait.");
};

export const sendMessage = async ({
  question,
  userId = "anonymous",
  sessionId = "default-session",
  userType = "public",
  mode = "plain_english",
  documentId,
  documentType,
  caseId = null,
  allowWebSearch = false,
  useAgent = false,
  useAdvancedAgent = true,
  chatSessionId = null,
  region = null,
}: SendMessagePayload): Promise<AskQuestionResponse> => {
  const response = await api.post("/ask-question/", {
    question: question,
    user_id: userId,
    session_id: sessionId,
    user_type: userType,
    answer_mode: mode,
    document_id: documentId || null,
    document_type: documentType || null,
    case_id: caseId || null,
    allow_web_search: allowWebSearch,
    use_agent: useAgent,
    use_advanced_agent: useAdvancedAgent,
    chat_session_id: chatSessionId || null,
    region: region || null,
  });

  return response.data;
};

export const getHistory = async (
  userId: string,
  sessionId: string = "default-session"
) => {
  const response = await api.get("/history/", {
    params: {
      user_id: userId,
      session_id: sessionId,
    },
  });

  return response.data;
};

export const checkBackendHealth = async () => {
  const response = await api.get("/health/");

  return response.data;
};

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface LoginResponse {
  access: string;
  refresh: string;
  role: string;
  firm_id: number;
  firm_name: string;
  firm_size: string;
  full_name: string;
}

export const login = async (
  username: string,
  password: string
): Promise<LoginResponse> => {
  const response = await axios.post(`${BASE_URL}/auth/login/`, {
    username,
    password,
  });

  setTokens(response.data.access, response.data.refresh);

  return response.data;
};

export interface FirmOnboardingDetails {
  barRegistrationNumber?: string;
  address?: string;
  officialEmailDomain?: string;
  practiceAreas?: string;
  employeeCount?: number;
  lawyerCount?: number;
  officeLocations?: string;
  phone?: string;
  website?: string;
  gstNumber?: string;
}

export const register = async (
  username: string,
  password: string,
  email: string,
  fullName: string = "",
  firmName?: string,
  firmSize: string = "solo",
  firmDetails?: FirmOnboardingDetails
): Promise<LoginResponse> => {
  const response = await axios.post(`${BASE_URL}/auth/register/`, {
    username,
    password,
    email,
    full_name: fullName,
    firm_name: firmName || null,
    firm_size: firmSize,
    bar_registration_number: firmDetails?.barRegistrationNumber || "",
    address: firmDetails?.address || "",
    official_email_domain: firmDetails?.officialEmailDomain || "",
    practice_areas: firmDetails?.practiceAreas || "",
    employee_count: firmDetails?.employeeCount || 0,
    lawyer_count: firmDetails?.lawyerCount || 0,
    office_locations: firmDetails?.officeLocations || "",
    phone: firmDetails?.phone || "",
    website: firmDetails?.website || "",
    gst_number: firmDetails?.gstNumber || "",
  });

  setTokens(response.data.access, response.data.refresh);

  return response.data;
};

export const registerPublic = async (
  username: string,
  password: string,
  email: string,
  fullName: string = ""
): Promise<LoginResponse> => {
  const response = await axios.post(`${BASE_URL}/auth/register-public/`, {
    username,
    password,
    email,
    full_name: fullName,
  });

  setTokens(response.data.access, response.data.refresh);

  return response.data;
};

// ---------------------------------------------------------------------------
// Firm profile
// ---------------------------------------------------------------------------

export interface FirmProfile {
  id: number;
  name: string;
  size: string;
  bar_registration_number: string;
  address: string;
  official_email_domain: string;
  practice_areas: string;
  employee_count: number;
  lawyer_count: number;
  active_lawyer_count: number;
  office_locations: string;
  phone: string;
  website: string;
  gst_number: string;
  logo_url: string | null;
  default_region: string;
}

export const REGIONS: { value: string; label: string }[] = [
  { value: "india", label: "India" },
  { value: "usa", label: "United States" },
  { value: "uk", label: "United Kingdom" },
  { value: "canada", label: "Canada" },
  { value: "australia", label: "Australia" },
  { value: "singapore", label: "Singapore" },
  { value: "eu", label: "European Union" },
  { value: "middle_east", label: "Middle East" },
];

export const getFirmProfile = async (): Promise<FirmProfile> => {
  const response = await api.get("/auth/firm/");
  return response.data;
};

export const updateFirmProfile = async (
  payload: Partial<Omit<FirmProfile, "id" | "logo_url" | "active_lawyer_count">>
): Promise<FirmProfile> => {
  const response = await api.patch("/auth/firm/", payload);
  return response.data;
};

export const uploadFirmLogo = async (file: File): Promise<FirmProfile> => {
  const formData = new FormData();
  formData.append("file", file);

  const response = await api.post("/auth/firm/logo/", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });

  return response.data;
};

// ---------------------------------------------------------------------------
// Chat history search (Knowledge page)
// ---------------------------------------------------------------------------

export interface ChatSearchResult {
  id: number;
  question: string;
  answer: string;
  document_id: string | null;
  document_name: string | null;
  chat_session_id: number | null;
  created_at: string;
}

export interface ChatSessionMessage {
  id: number;
  question: string;
  answer: string;
  created_at: string;
}

export interface ChatSessionDetail {
  id: number;
  title: string;
  document_id: string | null;
  document_name: string | null;
  messages: ChatSessionMessage[];
}

export const getChatSession = async (sessionId: number): Promise<ChatSessionDetail> => {
  const response = await api.get(`/chat-sessions/${sessionId}/`);
  return response.data;
};

export interface ChatSessionListItem {
  id: number;
  title: string;
  message_count: number;
  last_question: string | null;
  updated_at: string;
}

export const listChatSessions = async (): Promise<ChatSessionListItem[]> => {
  const response = await api.get("/chat-sessions/");
  return response.data;
};

export const renameChatSession = async (
  sessionId: number,
  title: string
): Promise<ChatSessionListItem> => {
  const response = await api.patch(`/chat-sessions/${sessionId}/`, { title });
  return response.data;
};

export const deleteChatSession = async (sessionId: number): Promise<void> => {
  await api.delete(`/chat-sessions/${sessionId}/`);
};

export const searchChatHistory = async (q: string = ""): Promise<ChatSearchResult[]> => {
  const response = await api.get("/documents/chats/search/", { params: q ? { q } : undefined });
  return response.data.results;
};

export const deleteChatEntry = async (chatId: number): Promise<void> => {
  await api.delete(`/documents/chats/${chatId}/`);
};

export const logout = () => {
  clearTokens();
};

export const fetchMe = async () => {
  const response = await api.get("/auth/me/");
  return response.data;
};

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

export interface CaseListItem {
  id: number;
  title: string;
  case_type: string;
  status: string;
  client_name: string;
  assigned_lawyer_names: string[];
  reminders_count: number;
  open_reminders_count: number;
  created_at: string;
  updated_at: string;
}

export interface Reminder {
  id: number;
  case_id?: number;
  case_title?: string;
  title: string;
  notes: string;
  due_date: string;
  is_completed: boolean;
  completed_at: string | null;
}

export interface DocumentRef {
  document_id: string;
  file_name: string;
}

export interface CaseDetail {
  id: number;
  title: string;
  case_type: string;
  status: string;
  description: string;
  client_name: string;
  drive_link: string;
  assigned_lawyer_names: string[];
  documents: DocumentRef[];
  reminders: Reminder[];
  created_at: string;
  updated_at: string;
}

export const listCases = async (params?: {
  status?: string;
  case_type?: string;
}): Promise<CaseListItem[]> => {
  const response = await api.get("/cases/", { params });
  return response.data;
};

export const createCase = async (payload: {
  title: string;
  case_type?: string;
  status?: string;
  description?: string;
  client_name?: string;
  drive_link?: string;
}): Promise<CaseDetail> => {
  const response = await api.post("/cases/", payload);
  return response.data;
};

export const getCase = async (caseId: number | string): Promise<CaseDetail> => {
  const response = await api.get(`/cases/${caseId}/`);
  return response.data;
};

export const updateCase = async (
  caseId: number | string,
  payload: Partial<{
    title: string;
    case_type: string;
    status: string;
    description: string;
    client_name: string;
    drive_link: string;
  }>
): Promise<CaseDetail> => {
  const response = await api.patch(`/cases/${caseId}/`, payload);
  return response.data;
};

export const deleteCase = async (caseId: number | string): Promise<void> => {
  await api.delete(`/cases/${caseId}/`);
};

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

export const listReminders = async (params?: {
  case_id?: number | string;
  upcoming?: boolean;
  overdue?: boolean;
}): Promise<Reminder[]> => {
  const response = await api.get("/reminders/", { params });
  return response.data;
};

export const createReminder = async (payload: {
  case_id: number | string;
  title: string;
  notes?: string;
  due_date: string;
}): Promise<Reminder> => {
  const response = await api.post("/reminders/", payload);
  return response.data;
};

export const completeReminder = async (
  reminderId: number | string
): Promise<Reminder> => {
  const response = await api.patch(`/reminders/${reminderId}/complete/`);
  return response.data;
};

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export interface DashboardSummary {
  case_counts_by_status: Record<string, number>;
  total_cases: number;
  upcoming_reminders: Reminder[];
  overdue_reminders: Reminder[];
  recent_cases: CaseListItem[];
}

export const getDashboardSummary = async (): Promise<DashboardSummary> => {
  const response = await api.get("/dashboard/summary/");
  return response.data;
};

// ---------------------------------------------------------------------------
// Lawyers (team management)
// ---------------------------------------------------------------------------

export interface LawyerListItem {
  id: number;
  username: string;
  full_name: string;
  email: string;
  role: string;
  department: string;
  is_active: boolean;
  invite_pending: boolean;
  last_login: string | null;
}

export interface LawyerInviteResult extends LawyerListItem {
  email_sent: boolean;
  invite_link: string | null;
}

export interface LawyerImportResult {
  created: number;
  skipped: number;
  errors: string[];
}

export const listLawyers = async (): Promise<LawyerListItem[]> => {
  const response = await api.get("/lawyers/");
  return response.data;
};

export const createLawyer = async (payload: {
  username: string;
  email: string;
  first_name?: string;
  last_name?: string;
  role?: string;
  department?: string;
}): Promise<LawyerInviteResult> => {
  const response = await api.post("/lawyers/", payload);
  return response.data;
};

export const updateLawyer = async (
  lawyerId: number,
  payload: Partial<{
    role: string;
    is_active: boolean;
    department: string;
    successor_id: number;
  }>
): Promise<LawyerListItem> => {
  const response = await api.patch(`/lawyers/${lawyerId}/`, payload);
  return response.data;
};

export const removeLawyer = async (lawyerId: number): Promise<void> => {
  await api.delete(`/lawyers/${lawyerId}/`);
};

// ---------------------------------------------------------------------------
// Google Drive integration
// ---------------------------------------------------------------------------

export interface DriveStatus {
  connected: boolean;
  folder_id?: string;
  folder_name?: string;
  folder_link?: string;
  last_synced_at?: string | null;
}

export interface DriveSyncResult {
  synced: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export const getDriveStatus = async (): Promise<DriveStatus> => {
  const response = await api.get("/integrations/google-drive/status/");
  return response.data;
};

export const connectDrive = async (): Promise<{ auth_url: string }> => {
  const response = await api.get("/integrations/google-drive/connect/");
  return response.data;
};

export const setDriveFolder = async (folderLink: string): Promise<DriveStatus> => {
  const response = await api.post("/integrations/google-drive/folder/", {
    folder_link: folderLink,
  });
  return response.data;
};

export const clearDriveFolder = async (): Promise<DriveStatus> => {
  const response = await api.delete("/integrations/google-drive/folder/");
  return response.data;
};

export const syncDrive = async (): Promise<DriveSyncResult> => {
  const response = await api.post("/integrations/google-drive/sync/");
  return response.data;
};

export const disconnectDrive = async (): Promise<void> => {
  await api.delete("/integrations/google-drive/");
};

export const importLawyersCsv = async (file: File): Promise<LawyerImportResult> => {
  const formData = new FormData();
  formData.append("file", file);

  const response = await api.post("/lawyers/import/", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });

  return response.data;
};

export const resendInvite = async (lawyerId: number): Promise<LawyerInviteResult> => {
  const response = await api.post(`/lawyers/${lawyerId}/resend-invite/`);
  return response.data;
};

export const setPassword = async (
  uid: string,
  token: string,
  password: string
): Promise<LoginResponse> => {
  const response = await axios.post(`${BASE_URL}/auth/set-password/`, {
    uid,
    token,
    password,
  });

  setTokens(response.data.access, response.data.refresh);

  return response.data;
};

// ---------------------------------------------------------------------------
// Drafts (drafting + redlining)
// ---------------------------------------------------------------------------

export type DraftType = "draft" | "redline";

export interface DraftListItem {
  id: number;
  title: string;
  draft_type: DraftType;
  case_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface RedlineSuggestion {
  id: number;
  order: number;
  original_text: string;
  suggested_text: string;
  reason: string;
  status: "pending" | "accepted" | "rejected";
}

export interface DraftDetail {
  id: number;
  title: string;
  draft_type: DraftType;
  prompt: string;
  content: string;
  case_id: number | null;
  source_document_id: string | null;
  suggestions: RedlineSuggestion[];
  created_at: string;
  updated_at: string;
}

export const listDrafts = async (caseId?: number | string): Promise<DraftListItem[]> => {
  const response = await api.get("/drafts/", {
    params: caseId ? { case_id: caseId } : undefined,
  });
  return response.data;
};

export const getDraft = async (draftId: number | string): Promise<DraftDetail> => {
  const response = await api.get(`/drafts/${draftId}/`);
  return response.data;
};

export const generateDraft = async (payload: {
  title: string;
  prompt: string;
  case_id?: number | string;
  template_id?: number | string;
  placeholder_values?: Record<string, string>;
}): Promise<DraftDetail> => {
  const response = await api.post("/drafts/generate/", payload);
  return response.data;
};

// ---------------------------------------------------------------------------
// Draft templates (reusable formats distilled from a sample document)
// ---------------------------------------------------------------------------

export interface TemplatePlaceholder {
  name: string;
  description: string;
}

export interface TemplateListItem {
  id: number;
  name: string;
  description: string;
  version: number;
  placeholder_count: number;
  created_at: string;
  updated_at: string;
}

export interface TemplateDetail {
  id: number;
  name: string;
  description: string;
  sample_original_name: string;
  extracted_structure: string;
  tone: string;
  formatting_rules: string;
  placeholders: TemplatePlaceholder[];
  ai_prompt: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export const listTemplates = async (): Promise<TemplateListItem[]> => {
  const response = await api.get("/drafts/templates/");
  return response.data;
};

export const getTemplate = async (
  templateId: number | string
): Promise<TemplateDetail> => {
  const response = await api.get(`/drafts/templates/${templateId}/`);
  return response.data;
};

export const createTemplate = async (payload: {
  name: string;
  description?: string;
  file: File;
}): Promise<TemplateDetail> => {
  const formData = new FormData();
  formData.append("name", payload.name);
  formData.append("description", payload.description || "");
  formData.append("file", payload.file);

  const response = await api.post("/drafts/templates/", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
};

export const deleteTemplate = async (
  templateId: number | string
): Promise<void> => {
  await api.delete(`/drafts/templates/${templateId}/`);
};

export const generateRedline = async (payload: {
  document_id: string;
  title?: string;
  instructions?: string;
  case_id?: number | string;
}): Promise<DraftDetail> => {
  const response = await api.post("/drafts/redline/", payload);
  return response.data;
};

export const updateDraft = async (
  draftId: number | string,
  payload: Partial<{ title: string; content: string }>
): Promise<DraftDetail> => {
  const response = await api.patch(`/drafts/${draftId}/`, payload);
  return response.data;
};

export const deleteDraft = async (draftId: number | string): Promise<void> => {
  await api.delete(`/drafts/${draftId}/`);
};

export const exportDraft = async (
  draftId: number | string,
  format: "pdf" | "docx",
  fileName: string
): Promise<void> => {
  const response = await api.get(`/drafts/${draftId}/export/`, {
    params: { format },
    responseType: "blob",
  });

  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileName}.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

export const updateSuggestion = async (
  suggestionId: number | string,
  status: "accepted" | "rejected"
): Promise<RedlineSuggestion> => {
  const response = await api.patch(`/drafts/suggestions/${suggestionId}/`, { status });
  return response.data;
};

// ---------------------------------------------------------------------------
// Case activity (comments + auto-logged events)
// ---------------------------------------------------------------------------

export interface CaseActivity {
  id: number;
  activity_type: string;
  body: string;
  actor_name: string | null;
  created_at: string;
}

export const listCaseActivities = async (
  caseId: number | string
): Promise<CaseActivity[]> => {
  const response = await api.get(`/cases/${caseId}/activities/`);
  return response.data;
};

export const postCaseComment = async (
  caseId: number | string,
  body: string
): Promise<CaseActivity> => {
  const response = await api.post(`/cases/${caseId}/activities/`, { body });
  return response.data;
};

// ---------------------------------------------------------------------------
// Contacts (manual entry + CSV import)
// ---------------------------------------------------------------------------

export interface Contact {
  id: number;
  name: string;
  email: string;
  phone: string;
  notes: string;
  case_id: number | null;
  case_title: string | null;
  created_at: string;
}

export interface ContactImportResult {
  created: number;
  skipped: number;
  errors: string[];
}

export const listContacts = async (caseId?: number | string): Promise<Contact[]> => {
  const response = await api.get("/contacts/", {
    params: caseId ? { case_id: caseId } : undefined,
  });
  return response.data;
};

export const createContact = async (payload: {
  name: string;
  email?: string;
  phone?: string;
  notes?: string;
  case_id?: number | string;
}): Promise<Contact> => {
  const response = await api.post("/contacts/", payload);
  return response.data;
};

export const updateContact = async (
  contactId: number | string,
  payload: Partial<{ name: string; email: string; phone: string; notes: string; case_id: number | null }>
): Promise<Contact> => {
  const response = await api.patch(`/contacts/${contactId}/`, payload);
  return response.data;
};

export const deleteContact = async (contactId: number | string): Promise<void> => {
  await api.delete(`/contacts/${contactId}/`);
};

export const importContactsCsv = async (file: File): Promise<ContactImportResult> => {
  const formData = new FormData();
  formData.append("file", file);

  const response = await api.post("/contacts/import/", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });

  return response.data;
};

// ---------------------------------------------------------------------------
// Admin analytics dashboard
// ---------------------------------------------------------------------------

export interface AuditLogItem {
  id: number;
  actor_name: string | null;
  action: string;
  details: string;
  created_at: string;
}

export interface AdminDashboard {
  total_users: number;
  active_users: number;
  pending_invitations: number;
  documents_uploaded: number;
  ai_queries: number;
  drafts_generated: number;
  recent_activity: AuditLogItem[];
}

export const getAdminDashboard = async (): Promise<AdminDashboard> => {
  const response = await api.get("/auth/admin-dashboard/");
  return response.data;
};

// ---------------------------------------------------------------------------
// Document intelligence (summarize, risks, entities, compare, compliance)
// ---------------------------------------------------------------------------

export interface DocumentListItem {
  document_id: string;
  file_name: string;
  document_type: string;
  tags: string;
  case_id: number | null;
  case_title: string | null;
  uploaded_at: string;
  source: "upload" | "drive";
}

export interface EntityExtraction {
  dates: string[];
  parties: string[];
  case_number: string | null;
  court_name: string | null;
  sections_referenced: string[];
  amounts: string[];
  addresses: string[];
}

export interface RiskItem {
  clause_excerpt: string;
  risk: string;
  severity: string;
}

export interface ComplianceFinding {
  item: string;
  status: string;
  note: string;
}

export const listDocuments = async (params?: {
  tag?: string;
  case_id?: number | string;
}): Promise<DocumentListItem[]> => {
  const response = await api.get("/documents/", { params });
  return response.data;
};

export const deleteDocument = async (documentId: string): Promise<void> => {
  await api.delete(`/documents/${documentId}/`);
};

export const updateDocumentTags = async (
  documentId: string,
  tags: string
): Promise<DocumentListItem> => {
  const response = await api.patch(`/documents/${documentId}/tags/`, { tags });
  return response.data;
};

export const summarizeDocument = async (documentId: string): Promise<string> => {
  const response = await api.post(`/documents/${documentId}/summarize/`);
  return response.data.summary;
};

export const generateClientSummary = async (documentId: string): Promise<string> => {
  const response = await api.post(`/documents/${documentId}/client-summary/`);
  return response.data.summary;
};

export const analyzeDocumentRisks = async (documentId: string): Promise<RiskItem[]> => {
  const response = await api.post(`/documents/${documentId}/risks/`);
  return response.data.risks;
};

export const extractDocumentEntities = async (documentId: string): Promise<EntityExtraction> => {
  const response = await api.post(`/documents/${documentId}/entities/`);
  return response.data;
};

export const checkDocumentCompliance = async (
  documentId: string
): Promise<ComplianceFinding[]> => {
  const response = await api.post(`/documents/${documentId}/compliance-check/`);
  return response.data.findings;
};

export const compareDocuments = async (
  documentIdA: string,
  documentIdB: string
): Promise<string> => {
  const response = await api.post("/documents/compare/", {
    document_id_a: documentIdA,
    document_id_b: documentIdB,
  });
  return response.data.comparison;
};

export default api;
