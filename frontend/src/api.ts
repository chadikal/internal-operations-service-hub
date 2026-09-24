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

export type ServiceRequest = {
  id: number;
  submittedBy: number;
  departmentId: number;
  currentOwnerId: number | null;
  status: 'SUBMITTED' | 'IN_PROGRESS' | 'COMPLETED';
  statusUpdatedAt: string;
  title: string | null;
  description: string | null;
  submitter: NamedRef;
  department: NamedRef;
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

export function createRequest(
  submittedBy: number,
  departmentId: number,
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

export function assignOwner(id: number, currentOwnerId: number) {
  return send<ServiceRequest>(`/requests/${id}/owner`, {
    method: 'PATCH',
    body: JSON.stringify({ currentOwnerId }),
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

export function createDepartment(name: string) {
  return send<Department>('/departments', {
    method: 'POST',
    body: JSON.stringify({ name }),
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
