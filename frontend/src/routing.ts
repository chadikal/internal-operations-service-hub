export type AdminView =
  | 'dashboard'
  | 'employees'
  | 'departments'
  | 'requests'
  | 'my-requests'
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
  if (path === '/admin/my-requests') {
    return 'my-requests';
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

export type StaffView =
  | 'dashboard'
  | 'requests'
  | 'my-requests'
  | 'employees'
  | 'approvals'
  | 'settings';

export function staffPath(view: StaffView): string {
  if (view === 'dashboard') return '/';
  return `/${view}`;
}

export function parseStaffView(pathname: string): StaffView {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/' || path === '/dashboard') return 'dashboard';
  if (path === '/requests/new' || path === '/requests/intake') return 'my-requests';
  if (path === '/requests') return 'requests';
  if (path === '/my-requests') return 'my-requests';
  if (path === '/employees') return 'employees';
  if (path === '/approvals') return 'approvals';
  if (path === '/settings') return 'settings';
  return 'dashboard';
}
