import { AccountRole } from '@prisma/client';

/** Super Admin never handles. Department Admin handles by role. Employees use canHandle. */
export function canHandleRequests(actor: { role: AccountRole; canHandle: boolean }): boolean {
  if (actor.role === AccountRole.SUPER_ADMIN) return false;
  if (actor.role === AccountRole.DEPARTMENT_ADMIN) return true;
  return actor.canHandle;
}

/** Persist the flag so a Department Admin is never stored as unable to handle. */
export function storedCanHandle(role: AccountRole, requested: boolean): boolean {
  if (role === AccountRole.SUPER_ADMIN) return false;
  if (role === AccountRole.DEPARTMENT_ADMIN) return true;
  return requested;
}
