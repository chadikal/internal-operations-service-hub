const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export type NamedRef = {
  id: number;
  name: string;
};

export type Employee = {
  id: number;
  name: string;
  departmentId: number | null;
  canHandle: boolean;
};

export type Department = {
  id: number;
  name: string;
};

export type ApprovalPolicy = 'NONE' | 'DEPARTMENT_ADMIN' | 'SUPER_ADMIN';

export type RequestType = {
  id: number;
  departmentId: number;
  name: string;
  approvalPolicy: ApprovalPolicy;
};

export type DepartmentTemplateId =
  | 'IT'
  | 'HR'
  | 'FINANCE'
  | 'OPERATIONS'
  | 'MARKETING'
  | 'FACILITIES'
  | 'CUSTOM_EMPTY';

export type TemplateSuggestion = {
  name: string;
  approvalPolicy: ApprovalPolicy;
};

export type DepartmentTemplate = {
  id: DepartmentTemplateId;
  name: string;
  suggestions: TemplateSuggestion[];
  suggestionsRecorded: boolean;
  unspecifiedNotice: string | null;
};

export type SessionUser = {
  id: number;
  name: string;
  email: string | null;
  companyId: number;
  companyName: string;
  departmentId: number | null;
  role: string;
  canHandle: boolean;
  active: boolean;
  csrfToken: string;
};

export type ApprovalState = 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'DENIED';

export type ApprovalDecision = {
  decision: 'APPROVED' | 'DENIED';
  reason: string | null;
  approverId: number;
  approverRole: 'EMPLOYEE' | 'DEPARTMENT_ADMIN' | 'SUPER_ADMIN';
  decidedAt: string;
  approver: NamedRef;
};

export type ServiceRequest = {
  id: number;
  submittedBy: number;
  departmentId: number;
  requestTypeId: number | null;
  capturedApprovalPolicy: ApprovalPolicy | null;
  approvalState: ApprovalState | null;
  noEligibleApprover: boolean;
  approvalNotice: string | null;
  approvalDecision: ApprovalDecision | null;
  currentOwnerId: number | null;
  status: 'SUBMITTED' | 'IN_PROGRESS' | 'COMPLETED';
  statusUpdatedAt: string;
  title: string | null;
  description: string | null;
  submitter: NamedRef;
  department: NamedRef;
  requestType: NamedRef | null;
  currentOwner: NamedRef | null;
};

export type HistoryRecord = {
  id: number;
  requestId: number;
  previousStatus: string;
  newStatus: string;
  changedBy: number;
  changedAt: string;
  changedByEmployee: NamedRef;
};

export type IntakeDraft = {
  departmentId: number | null;
  requestTypeId: number | null;
  summary: string | null;
  description: string | null;
};

export type IntakeResult = {
  situation: 'problem' | 'need';
  troubleshootingSteps: string[];
  missingInformation: string[];
  suggestions?: string[];
  draft: IntakeDraft | null;
};

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(`${status}: ${message}`);
    this.status = status;
  }
}

export class StaleSessionResult extends Error {
  constructor() {
    super('Ignored a response from a previous session');
  }
}

let csrfToken = '';
let sessionGeneration = 0;

export function currentSessionGeneration(): number {
  return sessionGeneration;
}

export function beginClientSession(user: SessionUser): number {
  sessionGeneration += 1;
  csrfToken = user.csrfToken;
  return sessionGeneration;
}

export function endClientSession(): number {
  sessionGeneration += 1;
  csrfToken = '';
  return sessionGeneration;
}

export function hasActionableIntakeDraft(draft: IntakeDraft | null | undefined): boolean {
  return draft != null && draft.departmentId != null && Boolean(draft.summary?.trim());
}

async function send<T>(path: string, options?: RequestInit): Promise<T> {
  const generation = sessionGeneration;
  const method = options?.method ?? 'GET';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (csrfToken && method !== 'GET' && method !== 'HEAD') {
    headers['X-CSRF-Token'] = csrfToken;
  }
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...headers,
      ...(options?.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  const thisRequestEndedSession =
    !response.ok &&
    response.status === 401 &&
    path !== '/auth/login' &&
    generation === sessionGeneration;
  if (thisRequestEndedSession) {
    endClientSession();
  }
  if (generation !== sessionGeneration && !thisRequestEndedSession) {
    throw new StaleSessionResult();
  }
  if (!response.ok) {
    const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    throw new ApiError(response.status, message || response.statusText || 'Request failed');
  }
  return body as T;
}

export async function login(email: string, password: string) {
  return send<SessionUser>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function logout() {
  await send<{ loggedOut: boolean }>('/auth/logout', {
    method: 'POST',
    body: '{}',
  });
  endClientSession();
}

export function getMe() {
  return send<SessionUser>('/auth/me');
}

export async function getEmployees() {
  const employees = await send<Employee[]>('/employees');
  return employees.map((employee) => ({
    id: Number(employee.id),
    name: employee.name,
    departmentId: employee.departmentId == null ? null : Number(employee.departmentId),
    canHandle: employee.canHandle === true,
  }));
}

export function getDepartments() {
  return send<Department[]>('/departments');
}

export function getRequestTypes() {
  return send<RequestType[]>('/request-types');
}

export function getDepartmentTemplates() {
  return send<DepartmentTemplate[]>('/department-templates');
}

export function getDepartmentTemplate(id: DepartmentTemplateId) {
  return send<DepartmentTemplate>(`/department-templates/${id}`);
}

export function createRequestType(departmentId: number, name: string, approvalPolicy: ApprovalPolicy) {
  return send<RequestType>(`/departments/${departmentId}/request-types`, {
    method: 'POST',
    body: JSON.stringify({ name, approvalPolicy }),
  });
}

export function updateRequestType(
  id: number,
  input: { name?: string; approvalPolicy?: ApprovalPolicy },
) {
  return send<RequestType>(`/request-types/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function createRequest(
  submittedBy: number,
  departmentId: number,
  requestTypeId: number,
  title?: string,
  description?: string,
) {
  const trimmedTitle = title?.trim();
  const trimmedDescription = description?.trim();
  return send<ServiceRequest>('/requests', {
    method: 'POST',
    body: JSON.stringify({
      submittedBy,
      departmentId,
      requestTypeId,
      ...(trimmedTitle ? { title: trimmedTitle } : {}),
      ...(trimmedDescription ? { description: trimmedDescription } : {}),
    }),
  });
}

export function analyzeIntake(text: string) {
  return send<IntakeResult>('/ai/intake', {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

export function getRequest(id: number) {
  return send<ServiceRequest>(`/requests/${id}`);
}

export function getHistory(id: number) {
  return send<HistoryRecord[]>(`/requests/${id}/history`);
}

export function claimRequest(id: number) {
  return send<ServiceRequest>(`/requests/${id}/claim`, {
    method: 'POST',
    body: '{}',
  });
}

export function transition(id: number, to: 'IN_PROGRESS' | 'COMPLETED', changedBy: number) {
  return send<ServiceRequest>(`/requests/${id}/transition`, {
    method: 'PATCH',
    body: JSON.stringify({ to, changedBy }),
  });
}

export function signupCompany(companyName: string, name: string, email: string, password: string) {
  return send<{ pending: true; companyName: string; email: string }>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ companyName, name, email, password }),
  });
}

export function verifyEmail(token: string) {
  return send<{ verified: true }>('/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

export function acceptInvitation(token: string, password: string) {
  return send<{ accepted: true }>('/auth/invitations/accept', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  });
}

export function createDepartment(
  name: string,
  input?: { templateId?: DepartmentTemplateId; requestTypes?: TemplateSuggestion[] },
) {
  return send<Department & { requestTypes?: RequestType[] }>('/departments', {
    method: 'POST',
    body: JSON.stringify({
      name,
      ...(input?.templateId ? { templateId: input.templateId } : {}),
      ...(input?.requestTypes ? { requestTypes: input.requestTypes } : {}),
    }),
  });
}

export function applyDepartmentTemplateTypes(
  departmentId: number,
  input: { templateId?: DepartmentTemplateId; requestTypes: TemplateSuggestion[] },
) {
  return send<Department & { requestTypes: RequestType[] }>(`/departments/${departmentId}/template-types`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateDepartment(id: number, name: string) {
  return send<Department>(`/departments/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export function deleteDepartment(id: number) {
  return send<{ deleted: true }>(`/departments/${id}`, {
    method: 'DELETE',
  });
}

export function inviteStaff(input: {
  email: string;
  name: string;
  departmentId: number;
  role: 'EMPLOYEE' | 'DEPARTMENT_ADMIN' | 'SUPER_ADMIN';
  canHandle: boolean;
}) {
  return send<SessionUser>('/auth/invitations', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export type DashboardCounts = {
  employees: number;
  departments: number;
  requests: number;
  submitted: number;
  inProgress: number;
  completed: number;
  activeRequests: number;
};

export type CompanyEmployee = {
  id: number;
  name: string;
  email: string | null;
  department: { id: number; name: string } | null;
  role: 'EMPLOYEE' | 'DEPARTMENT_ADMIN' | 'SUPER_ADMIN' | string;
  canHandle: boolean;
  active: boolean;
};

export type EmployeeListFilters = {
  q?: string;
  departmentId?: number;
  role?: 'EMPLOYEE' | 'DEPARTMENT_ADMIN' | 'SUPER_ADMIN' | '';
  canHandle?: '' | 'true' | 'false';
  active?: '' | 'true' | 'false';
};

export function getDashboardCounts() {
  return send<DashboardCounts>('/admin/dashboard');
}

export function getCompanyEmployees(filters: EmployeeListFilters = {}) {
  const params = new URLSearchParams();
  const q = filters.q?.trim();
  if (q) params.set('q', q);
  if (filters.departmentId) params.set('departmentId', String(filters.departmentId));
  if (filters.role) params.set('role', filters.role);
  if (filters.canHandle === 'true' || filters.canHandle === 'false') {
    params.set('canHandle', filters.canHandle);
  }
  if (filters.active === 'true' || filters.active === 'false') {
    params.set('active', filters.active);
  }
  const query = params.toString();
  return send<CompanyEmployee[]>(query ? `/admin/employees?${query}` : '/admin/employees');
}

export type CompanyRequestListItem = {
  id: number;
  title: string | null;
  status: ServiceRequest['status'];
  submitter: { name: string };
  submitterDepartment: { name: string } | null;
  department: { name: string };
  mine: boolean;
};

export type CompanyRequestList = {
  items: CompanyRequestListItem[];
  total: number;
  page: number;
  pageSize: number;
};

export type CompanyRequestFilters = {
  scope?: 'all' | 'mine';
  departmentId?: number;
  status?: '' | 'ACTIVE' | 'SUBMITTED' | 'IN_PROGRESS' | 'COMPLETED';
  assignment?: '' | 'all' | 'unassigned' | 'assigned';
  q?: string;
  page?: number;
  pageSize?: number;
};

export function getCompanyRequests(filters: CompanyRequestFilters = {}) {
  const params = new URLSearchParams();
  if (filters.scope === 'mine') params.set('scope', 'mine');
  if (filters.departmentId) params.set('departmentId', String(filters.departmentId));
  if (filters.status) params.set('status', filters.status);
  if (filters.assignment === 'unassigned' || filters.assignment === 'assigned') {
    params.set('assignment', filters.assignment);
  }
  const q = filters.q?.trim();
  if (q) params.set('q', q);
  if (filters.page && filters.page > 1) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  const query = params.toString();
  return send<CompanyRequestList>(query ? `/admin/requests?${query}` : '/admin/requests');
}

export function getApprovalInbox() {
  return send<{ items: ServiceRequest[] }>('/requests/approvals');
}

export function decideApproval(id: number, decision: 'APPROVED' | 'DENIED', reason?: string) {
  return send<ServiceRequest>(`/requests/${id}/approval`, {
    method: 'POST',
    body: JSON.stringify({ decision, reason }),
  });
}
