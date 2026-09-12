const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export type NamedRef = {
  id: number;
  name: string;
};

export type Employee = {
  id: number;
  name: string;
  departmentId: number;
  canHandle: boolean;
};

export type Department = {
  id: number;
  name: string;
};

export type ServiceRequest = {
  id: number;
  submittedBy: number;
  departmentId: number;
  currentOwnerId: number | null;
  status: 'SUBMITTED' | 'IN_PROGRESS' | 'COMPLETED';
  statusUpdatedAt: string;
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

function actorHeaders(actorId: number): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'X-Actor-Id': String(actorId),
  };
}

async function send<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    throw new Error(`${response.status}: ${message || response.statusText || 'Request failed'}`);
  }
  return body as T;
}

export async function getEmployees() {
  const employees = await send<Employee[]>('/employees');
  return employees.map((employee) => ({
    id: Number(employee.id),
    name: employee.name,
    departmentId: Number(employee.departmentId),
    canHandle: employee.canHandle === true,
  }));
}

export function getDepartments() {
  return send<Department[]>('/departments');
}

export function createRequest(actorId: number, submittedBy: number, departmentId: number) {
  return send<ServiceRequest>('/requests', {
    method: 'POST',
    headers: actorHeaders(actorId),
    body: JSON.stringify({ submittedBy, departmentId }),
  });
}

export function getRequest(actorId: number, id: number) {
  return send<ServiceRequest>(`/requests/${id}`, {
    headers: actorHeaders(actorId),
  });
}

export function getHistory(actorId: number, id: number) {
  return send<HistoryRecord[]>(`/requests/${id}/history`, {
    headers: actorHeaders(actorId),
  });
}

export function assignOwner(actorId: number, id: number, currentOwnerId: number) {
  return send<ServiceRequest>(`/requests/${id}/owner`, {
    method: 'PATCH',
    headers: actorHeaders(actorId),
    body: JSON.stringify({ currentOwnerId }),
  });
}

export function transition(
  actorId: number,
  id: number,
  to: 'IN_PROGRESS' | 'COMPLETED',
  changedBy: number,
) {
  return send<ServiceRequest>(`/requests/${id}/transition`, {
    method: 'PATCH',
    headers: actorHeaders(actorId),
    body: JSON.stringify({ to, changedBy }),
  });
}
