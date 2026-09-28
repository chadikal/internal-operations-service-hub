export type PendingInvite = {
  name: string;
  email: string;
  departmentName: string;
  role: 'EMPLOYEE' | 'DEPARTMENT_ADMIN' | 'SUPER_ADMIN';
  canHandle: boolean;
};

const STORAGE_KEY = 'hub-pending-invites';

export function savePendingInvites(founderEmail: string, invitations: PendingInvite[]) {
  if (invitations.length === 0) {
    sessionStorage.removeItem(STORAGE_KEY);
    return;
  }
  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ email: founderEmail.trim().toLowerCase(), invitations }),
  );
}

export function takePendingInvites(founderEmail: string): PendingInvite[] {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { email?: string; invitations?: PendingInvite[] };
    if (parsed.email !== founderEmail.trim().toLowerCase() || !Array.isArray(parsed.invitations)) {
      return [];
    }
    sessionStorage.removeItem(STORAGE_KEY);
    return parsed.invitations;
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
    return [];
  }
}
