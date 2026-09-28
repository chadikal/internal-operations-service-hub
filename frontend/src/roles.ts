export function canActAsHandler(role: string, canHandle: boolean): boolean {
  if (role === 'SUPER_ADMIN') return false;
  if (role === 'DEPARTMENT_ADMIN') return true;
  return canHandle;
}

/** Value stored for a new or updated account. Claim checks still use the role. */
export function storedCanHandle(role: string, requested: boolean): boolean {
  if (role === 'SUPER_ADMIN') return false;
  if (role === 'DEPARTMENT_ADMIN') return true;
  return requested;
}

export function staffRoleLabel(role: string, canHandle: boolean): string {
  if (role === 'SUPER_ADMIN') return 'Super Admin';
  if (role === 'DEPARTMENT_ADMIN') return 'Department Admin';
  if (canHandle) return 'Handler';
  return 'Employee';
}
