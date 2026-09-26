export type AdminView =
  | 'dashboard'
  | 'employees'
  | 'departments'
  | 'requests'
  | 'approvals'
  | 'settings';

export function adminPath(view: AdminView, query?: Record<string, string | undefined>): string {
  const path = view === 'dashboard' ? '/admin' : `/admin/${view}`;
  if (!query) {
    return path;
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) {
      params.set(key, value);
    }
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export function parseAdminView(pathname: string): AdminView | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/admin') {
    return 'dashboard';
  }
  if (path === '/admin/employees') {
    return 'employees';
  }
  if (path === '/admin/departments') {
    return 'departments';
  }
  if (path === '/admin/requests' || path.startsWith('/admin/requests/')) {
    return 'requests';
  }
  if (path === '/admin/approvals') {
    return 'approvals';
  }
  if (path === '/admin/settings') {
    return 'settings';
  }
  return null;
}

export function isAdminPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  return path === '/admin' || path.startsWith('/admin/');
}
