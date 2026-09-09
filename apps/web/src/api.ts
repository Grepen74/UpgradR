import type {
  ApplicationStatus,
  CompensationPeriod,
  CreateSuppressionInput,
  McpScopeDescriptor,
  SuppressionKeyType,
  SuppressionSource,
} from "@upgradr/contracts";
import type { DocumentKind, DocumentLinkRole } from "../shared/documents";
import type {
  LinkedInImportPreviewPayload,
  ProfileImportCreateInput,
  ResumeImportPreviewPayload,
} from "../shared/profileImportPreview";

export type SessionUser = {
  id: string;
  email: string | null;
};

export type DashboardSummary = {
  proposals: number;
  active: number;
  overdue: number;
};

export type ApplicationSummary = {
  id: string;
  title: string;
  company_name: string;
  location: string | null;
  source_url: string;
  source_provider: string;
  current_status: ApplicationStatus;
  match_score: number | null;
  confidence: number | null;
  mcp_client_id: string | null;
  board_position: number;
  created_at: string;
  updated_at: string;
  labels: LabelSummary[];
};

export type SuppressionSummary = {
  id: string;
  key_type: SuppressionKeyType;
  key_value: string;
  reason: string | null;
  source: SuppressionSource;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type LabelSummary = {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
  updated_at: string;
};

export type ApplicationStatusEvent = {
  id: string;
  from_status: ApplicationStatus | null;
  to_status: ApplicationStatus;
  note: string | null;
  created_at: string;
};

export type MatchAssessment = {
  id: string;
  score: number | null;
  rationale: string | null;
  strengths: string[];
  gaps: string[];
  confidence: number | null;
  assessed_by: string | null;
  mcp_client_id: string | null;
  created_at: string;
};

export type ApplicationDetail = ApplicationSummary & {
  company_id: string | null;
  primary_contact_id: string | null;
  external_id: string | null;
  description: string | null;
  compensation_min: number | null;
  compensation_max: number | null;
  compensation_currency: string | null;
  compensation_period: CompensationPeriod | null;
  match_rationale: string | null;
  strengths: string[];
  gaps: string[];
  applied_at: string | null;
  archived_at: string | null;
};

export type OAuthAuthorization = {
  authorizationId?: string;
  redirectUrl?: string;
  client?: {
    name: string;
    redirectUri: string;
  };
  scopes?: string[];
  scopeCatalog?: McpScopeDescriptor[];
  defaultScopes?: string[];
};

export type OAuthGrant = {
  clientId: string;
  clientName: string;
  scopes: string[];
  grantedAt: string;
};

export type CandidateProfile = {
  headline: string | null;
  summary: string | null;
  relevant_experience: string | null;
  is_confirmed: boolean;
  last_reviewed_at: string | null;
};

export type ProfileExperience = {
  id: string;
  company: string;
  title: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
  is_confirmed: boolean;
  sort_order: number;
};

export type ProfileEducation = {
  id: string;
  institution: string;
  degree: string | null;
  field_of_study: string | null;
  is_confirmed: boolean;
  sort_order: number;
};

export type ProfileSkill = {
  id: string;
  name: string;
  evidence: string | null;
  is_confirmed: boolean;
};

export type ProfileDetail = {
  profile: CandidateProfile;
  experiences: ProfileExperience[];
  education: ProfileEducation[];
  skills: ProfileSkill[];
};

export type JobSearchPreferences = {
  targetRoles: string[];
  locations: string[];
  remotePolicy: "onsite" | "hybrid" | "remote" | "flexible";
  minimumCompensation: number | null;
  minimumCompensationPeriod: CompensationPeriod;
  compensationCurrency: string | null;
  industries: string[];
  excludedCompanies: string[];
  notes: string | null;
  minimumMatchScore: number | null;
};

export type TaskSummary = {
  id: string;
  application_id: string | null;
  title: string;
  description: string | null;
  due_at: string | null;
  is_completed: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AnalyticsPipelineCounts = Partial<Record<ApplicationStatus, number>>;

export type AnalyticsWeekCount = {
  weekStart: string;
  count: number;
};

export type AnalyticsSourceCount = {
  sourceProvider: string;
  count: number;
};

export type AnalyticsConversion = {
  proposedCount: number;
  shortlistedCount: number;
  appliedCount: number;
  proposalToShortlistRate: number | null;
  shortlistToAppliedRate: number | null;
};

export type AnalyticsStageDuration = {
  status: ApplicationStatus;
  avgDays: number;
  sampleSize: number;
};

export type AnalyticsFollowUp = {
  completedCount: number;
  totalCount: number;
  completionRate: number | null;
};

export type AnalyticsOverview = {
  generatedAt: string;
  weeks: number;
  staleDays: number;
  pipeline: AnalyticsPipelineCounts;
  applicationsOverTime: AnalyticsWeekCount[];
  sourceBreakdown: AnalyticsSourceCount[];
  conversion: AnalyticsConversion;
  timeInStageDays: AnalyticsStageDuration[];
  followUp: AnalyticsFollowUp;
  staleApplicationCount: number;
  overdueTaskCount: number;
};

export type AnalyticsNextAction = {
  application_id: string;
  title: string;
  company_name: string;
  current_status: ApplicationStatus;
  updated_at: string;
};

export type AnalyticsStaleApplication = {
  id: string;
  title: string;
  company_name: string;
  current_status: ApplicationStatus;
  updated_at: string;
};

export type AnalyticsOverdueTask = {
  id: string;
  application_id: string | null;
  title: string;
  due_at: string | null;
};


export type ProfileImportSource = "linkedin" | "resume";

export type ProfileImportStatus = "pending" | "confirmed" | "discarded";

export type ProfileImportRecord = {
  id: string;
  source: ProfileImportSource | "manual" | "other";
  source_label: string | null;
  parser_version: string | null;
  status: ProfileImportStatus;
  imported_at: string;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

// The full pending/reviewed import, including its bounded raw_payload
// preview (only returned by GET /api/profile/imports/:id, not the list
// endpoint). raw_payload's shape depends on `source`.
export type ProfileImportDetail = ProfileImportRecord & {
  raw_payload: LinkedInImportPreviewPayload | ResumeImportPreviewPayload | null;
};

// Selections sent to POST /api/profile/imports/:id/confirm -- 0-based
// indexes into the corresponding raw_payload arrays (see
// ../shared/profileImportPreview.ts), matching
// public.confirm_profile_import()'s parameters.
export type ProfileImportConfirmInput = {
  confirmProfile?: boolean;
  experienceIndexes?: number[];
  educationIndexes?: number[];
  skillIndexes?: number[];
};

export type ProfileImportConfirmResult = {
  importId: string;
  status: "confirmed";
  confirmedProfile: boolean;
  confirmedExperiences: number;
  confirmedEducation: number;
  confirmedSkills: number;
};

export type CompanySummary = {
  id: string;
  name: string;
  website_url: string | null;
  industry: string | null;
  size_range: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type CompanyInput = {
  name: string;
  websiteUrl?: string | null;
  industry?: string | null;
  sizeRange?: string | null;
  notes?: string | null;
};

export type ContactSummary = {
  id: string;
  company_id: string | null;
  full_name: string;
  role_title: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ContactInput = {
  fullName: string;
  companyId?: string | null;
  roleTitle?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  notes?: string | null;
};

export type NoteSummary = {
  id: string;
  application_id: string | null;
  company_id: string | null;
  contact_id: string | null;
  body: string;
  created_at: string;
  updated_at: string;
};

export type NoteInput = {
  body: string;
  applicationId?: string | null;
  companyId?: string | null;
  contactId?: string | null;
};

export type ActivityEntityType =
  | "application"
  | "company"
  | "contact"
  | "task"
  | "note"
  | "document"
  | "candidate_profile"
  | "profile_import"
  | "mcp_operation";

export type ActivityEvent = {
  id: string;
  entity_type: ActivityEntityType;
  entity_id: string | null;
  event_type: string;
  actor: "user" | "agent" | "system";
  mcp_client_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type DocumentLink = {
  id: string;
  document_id: string;
  application_id: string;
  role: DocumentLinkRole;
  created_at: string;
};

export type DocumentRecord = {
  id: string;
  kind: DocumentKind;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
  updated_at: string;
  links: DocumentLink[];
};

export type DocumentQuota = {
  usedBytes: number;
  maxBytes: number;
  count: number;
  maxCount: number;
};

export type AccountExportSection<T> = {
  rows: T[];
  totalCount: number;
  truncated: boolean;
};

// Loosely typed on purpose: this is a raw personal-data export, and the
// dashboard only needs to trigger/describe the download, not render each
// field. See worker/routes/account.ts for the authoritative shape.
export type AccountExport = {
  generatedAt: string;
  account: Record<string, unknown> | null;
  candidateProfile: Record<string, unknown> | null;
  jobSearchPreferences: Record<string, unknown> | null;
  connectedAgents: OAuthGrant[];
  meta: { maxRowsPerTable: number; excluded: string[] };
  [section: string]: unknown;
};

function toQueryString(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      query.set(key, value);
    }
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? "Request failed");
  }
  return body;
}

export const api = {
  getSession: () => apiRequest<{ user: SessionUser | null }>("/api/session"),
  getDashboard: () => apiRequest<DashboardSummary>("/api/dashboard"),
  getApplications: () =>
    apiRequest<{ applications: ApplicationSummary[] }>("/api/applications"),
  createApplication: (input: {
    title: string;
    companyName: string;
    location?: string;
    sourceUrl: string;
    sourceProvider: string;
  }) =>
    apiRequest<{ id: string }>("/api/applications", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateApplicationStatus: (id: string, status: ApplicationStatus, note?: string) =>
    apiRequest<{ application: ApplicationSummary }>(
      `/api/applications/${encodeURIComponent(id)}/status`,
      {
        method: "POST",
        body: JSON.stringify({ status, ...(note ? { note } : {}) }),
      },
    ),
  // Applies a board drag. `orderedIds` is the destination column's complete
  // order after the drop, including the moved card.
  moveApplicationOnBoard: (id: string, status: ApplicationStatus, orderedIds: string[]) =>
    apiRequest<{ application: ApplicationSummary }>(
      `/api/applications/${encodeURIComponent(id)}/board-position`,
      {
        method: "POST",
        body: JSON.stringify({ status, orderedIds }),
      },
    ),
  getApplicationDetail: (id: string) =>
    apiRequest<{
      application: ApplicationDetail;
      statusEvents: ApplicationStatusEvent[];
      matchAssessments: MatchAssessment[];
    }>(`/api/applications/${encodeURIComponent(id)}`),
  attachLabel: (applicationId: string, labelId: string) =>
    apiRequest<{ label: LabelSummary }>(
      `/api/applications/${encodeURIComponent(applicationId)}/labels`,
      {
        method: "POST",
        body: JSON.stringify({ labelId }),
      },
    ),
  detachLabel: (applicationId: string, labelId: string) =>
    apiRequest<{ detached: true }>(
      `/api/applications/${encodeURIComponent(applicationId)}/labels/${encodeURIComponent(labelId)}`,
      { method: "DELETE" },
    ),
  getLabels: () => apiRequest<{ labels: LabelSummary[] }>("/api/labels"),
  createLabel: (input: { name: string; color?: string | null }) =>
    apiRequest<{ label: LabelSummary }>("/api/labels", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateLabel: (id: string, input: { name?: string; color?: string | null }) =>
    apiRequest<{ label: LabelSummary }>(`/api/labels/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deleteLabel: (id: string) =>
    apiRequest<{ deleted: true }>(`/api/labels/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  getSuppressions: () =>
    apiRequest<{ suppressions: SuppressionSummary[] }>("/api/suppressions"),
  createSuppression: (input: CreateSuppressionInput) =>
    apiRequest<{ suppression: SuppressionSummary }>("/api/suppressions", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteSuppression: (id: string) =>
    apiRequest<{ removed: true }>(`/api/suppressions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  getProfile: () => apiRequest<ProfileDetail>("/api/profile"),
  updateProfile: (input: {
    headline: string | null;
    summary: string | null;
    relevantExperience: string | null;
  }) =>
    apiRequest<{ profile: CandidateProfile }>("/api/profile", {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  addProfileExperience: (input: {
    company: string;
    title: string;
    description: string | null;
    startDate: string | null;
    endDate: string | null;
    isCurrent: boolean;
  }) =>
    apiRequest<{ entry: ProfileExperience }>("/api/profile/experiences", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  addProfileEducation: (input: {
    institution: string;
    degree: string | null;
    fieldOfStudy: string | null;
  }) =>
    apiRequest<{ entry: ProfileEducation }>("/api/profile/education", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  addProfileSkill: (input: { name: string; evidence: string | null }) =>
    apiRequest<{ entry: ProfileSkill }>("/api/profile/skills", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteProfileEntry: (kind: "experiences" | "education" | "skills", id: string) =>
    apiRequest<{ deleted: true }>(`/api/profile/${kind}/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  getProfileImports: () =>
    apiRequest<{ imports: ProfileImportRecord[] }>("/api/profile/imports"),
  createProfileImport: (input: ProfileImportCreateInput) =>
    apiRequest<{ import: ProfileImportRecord }>("/api/profile/imports", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getProfileImport: (id: string) =>
    apiRequest<{ import: ProfileImportDetail }>(`/api/profile/imports/${encodeURIComponent(id)}`),
  confirmProfileImport: (id: string, input: ProfileImportConfirmInput) =>
    apiRequest<{ confirmation: ProfileImportConfirmResult }>(
      `/api/profile/imports/${encodeURIComponent(id)}/confirm`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    ),
  discardProfileImport: (id: string) =>
    apiRequest<{ import: ProfileImportRecord }>(
      `/api/profile/imports/${encodeURIComponent(id)}/discard`,
      { method: "POST", body: "{}" },
    ),
  getPreferences: () => apiRequest<JobSearchPreferences>("/api/preferences"),
  updatePreferences: (input: JobSearchPreferences) =>
    apiRequest<{ saved: true }>("/api/preferences", {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  getTasks: () => apiRequest<{ tasks: TaskSummary[] }>("/api/tasks"),  createTask: (input: {
    title: string;
    description?: string | null;
    dueAt?: string | null;
    applicationId?: string | null;
  }) =>
    apiRequest<{ task: TaskSummary }>("/api/tasks", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  setTaskCompletion: (id: string, isCompleted: boolean) =>
    apiRequest<{ task: TaskSummary }>(`/api/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ isCompleted }),
    }),
  getCompanies: () => apiRequest<{ companies: CompanySummary[] }>("/api/companies"),
  createCompany: (input: CompanyInput) =>
    apiRequest<{ company: CompanySummary }>("/api/companies", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateCompany: (id: string, input: Partial<CompanyInput>) =>
    apiRequest<{ company: CompanySummary }>(`/api/companies/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deleteCompany: (id: string) =>
    apiRequest<{ deleted: true }>(`/api/companies/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  getContacts: (companyId?: string) =>
    apiRequest<{ contacts: ContactSummary[] }>(`/api/contacts${toQueryString({ companyId })}`),
  createContact: (input: ContactInput) =>
    apiRequest<{ contact: ContactSummary }>("/api/contacts", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateContact: (id: string, input: Partial<ContactInput>) =>
    apiRequest<{ contact: ContactSummary }>(`/api/contacts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deleteContact: (id: string) =>
    apiRequest<{ deleted: true }>(`/api/contacts/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  getNotes: (filter?: { applicationId?: string; companyId?: string; contactId?: string }) =>
    apiRequest<{ notes: NoteSummary[] }>(`/api/notes${toQueryString({ ...filter })}`),
  createNote: (input: NoteInput) =>
    apiRequest<{ note: NoteSummary }>("/api/notes", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateNote: (id: string, body: string) =>
    apiRequest<{ note: NoteSummary }>(`/api/notes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ body }),
    }),
  deleteNote: (id: string) =>
    apiRequest<{ deleted: true }>(`/api/notes/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  getActivity: (filter?: { entityType?: ActivityEntityType; entityId?: string }) =>
    apiRequest<{ events: ActivityEvent[] }>(`/api/activity${toQueryString({ ...filter })}`),
  getDocuments: () =>
    apiRequest<{ documents: DocumentRecord[]; quota: DocumentQuota }>("/api/documents"),
  uploadDocument: async (input: {
    file: File;
    kind: DocumentKind;
    replaceDocumentId?: string;
  }): Promise<{ document: DocumentRecord }> => {
    const form = new FormData();
    form.set("file", input.file);
    form.set("kind", input.kind);
    if (input.replaceDocumentId) {
      form.set("replaceDocumentId", input.replaceDocumentId);
    }
    // No Content-Type header: the browser sets the multipart boundary when
    // the body is a FormData instance.
    const response = await fetch("/api/documents", { method: "POST", body: form });
    const body = (await response.json()) as { document?: DocumentRecord; error?: string };
    if (!response.ok || !body.document) {
      throw new Error(body.error ?? "Unable to upload document");
    }
    return { document: body.document };
  },
  getDocumentDownloadUrl: (id: string) =>
    apiRequest<{ url: string; expiresAt: string }>(
      `/api/documents/${encodeURIComponent(id)}/download`,
    ),
  deleteDocument: (id: string) =>
    apiRequest<{ deleted: true }>(`/api/documents/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  linkDocument: (id: string, input: { applicationId: string; role?: DocumentLinkRole }) =>
    apiRequest<{ link: DocumentLink }>(`/api/documents/${encodeURIComponent(id)}/links`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  unlinkDocument: (id: string, linkId: string) =>
    apiRequest<{ unlinked: true }>(
      `/api/documents/${encodeURIComponent(id)}/links/${encodeURIComponent(linkId)}`,
      { method: "DELETE" },
    ),
  getAnalyticsOverview: (filter?: { weeks?: number; staleDays?: number }) =>
    apiRequest<{ overview: AnalyticsOverview }>(
      `/api/analytics/overview${toQueryString({
        weeks: filter?.weeks?.toString(),
        staleDays: filter?.staleDays?.toString(),
      })}`,
    ),
  getAnalyticsNextActions: (limit?: number) =>
    apiRequest<{ applications: AnalyticsNextAction[] }>(
      `/api/analytics/next-actions${toQueryString({ limit: limit?.toString() })}`,
    ),
  getAnalyticsStaleApplications: (filter?: { staleDays?: number; limit?: number }) =>
    apiRequest<{ applications: AnalyticsStaleApplication[] }>(
      `/api/analytics/stale-applications${toQueryString({
        staleDays: filter?.staleDays?.toString(),
        limit: filter?.limit?.toString(),
      })}`,
    ),
  getAnalyticsOverdueTasks: (limit?: number) =>
    apiRequest<{ tasks: AnalyticsOverdueTask[] }>(
      `/api/analytics/overdue-tasks${toQueryString({ limit: limit?.toString() })}`,
    ),
  getOAuthGrants: () =>
    apiRequest<{ grants: OAuthGrant[]; scopeCatalog: McpScopeDescriptor[] }>("/api/oauth/grants"),
  revokeOAuthGrant: (clientId: string) =>
    apiRequest<{ revoked: true }>("/api/oauth/grants/revoke", {
      method: "POST",
      body: JSON.stringify({ clientId }),
    }),
  updateOAuthGrantScopes: (clientId: string, scopes: string[]) =>
    apiRequest<{ scopes: string[] }>("/api/oauth/grants/scopes", {
      method: "POST",
      body: JSON.stringify({ clientId, scopes }),
    }),
  sendMagicLink: (email: string, returnTo?: string) =>
    apiRequest<{ sent: true }>("/api/auth/magic-link", {
      method: "POST",
      body: JSON.stringify({ email, returnTo }),
    }),
  getOAuthAuthorization: (authorizationId: string) =>
    apiRequest<OAuthAuthorization>(
      `/api/oauth/authorization?authorization_id=${encodeURIComponent(authorizationId)}`,
    ),
  decideOAuthAuthorization: (
    authorizationId: string,
    decision: "approve" | "deny",
    scopes?: string[],
  ) =>
    apiRequest<{ redirectUrl: string }>("/api/oauth/decision", {
      method: "POST",
      body: JSON.stringify({ authorizationId, decision, scopes }),
    }),
  signOut: () =>
    apiRequest<{ signedOut: true }>("/api/auth/sign-out", {
      method: "POST",
      body: "{}",
    }),
  // Not routed through apiRequest: the response body is the downloadable
  // JSON artifact itself (see GET /api/account/export), not a JSON envelope
  // to parse and discard.
  exportAccountData: async (): Promise<{ blob: Blob; filename: string }> => {
    const response = await fetch("/api/account/export");
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Unable to export account data");
    }
    const disposition = response.headers.get("Content-Disposition") ?? "";
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "upgradr-account-export.json";
    const blob = await response.blob();
    return { blob, filename };
  },
  deleteAccount: (confirmation: string) =>
    apiRequest<{ deleted: true }>("/api/account", {
      method: "DELETE",
      body: JSON.stringify({ confirmation }),
    }),
};
