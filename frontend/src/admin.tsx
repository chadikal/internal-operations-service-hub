import { FormEvent, ReactNode, useEffect, useState } from 'react';
import {
  ApiError,
  CompanyEmployee,
  currentSessionGeneration,
  DashboardCounts,
  Department,
  EmployeeListFilters,
  getCompanyEmployees,
  getDashboardCounts,
  getDepartments,
  SessionUser,
  StaleSessionResult,
} from './api';
import { DepartmentWorkspace } from './department-manage';
import { RequestStartActions } from './staff';
import { staffRoleLabel } from './roles';
import {
  canManageStaff,
  EditStaffOverlay,
  handlerCell,
  InviteStaffButton,
  InviteStaffOverlay,
  RemoveStaffDialog,
  StaffRowActions,
} from './staff-manage';
import { AdminView, adminPath } from './routing';
import { approvalBreakdown, myRequestBreakdown, requestBreakdown } from './dashboard-figures';
import { ApprovalsIcon, BuildingIcon, MyRequestsIcon, PeopleIcon, RequestsIcon, SummaryCard } from './summary-card';

function employeeFiltersFromLocation(): {
  role: EmployeeListFilters['role'];
  canHandle: EmployeeListFilters['canHandle'];
} {
  const params = new URLSearchParams(window.location.search);
  const role = params.get('role');
  const canHandle = params.get('canHandle');
  return {
    role: role === 'EMPLOYEE' || role === 'DEPARTMENT_ADMIN' || role === 'SUPER_ADMIN' || role === 'ADMIN' ? role : '',
    canHandle: canHandle === 'true' || canHandle === 'false' ? canHandle : '',
  };
}

export function workspaceRoleLabel(role: string, canHandle: boolean) {
  return staffRoleLabel(role, canHandle);
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M10 7V5h9v14h-9v-2" />
      <path d="M4 12h11" />
      <path d="M12 8l4 4-4 4" />
    </svg>
  );
}

function NavGlyph({ name }: { name: string }) {
  const common = {
    viewBox: '0 0 24 24',
    width: 20,
    height: 20,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    'aria-hidden': true as const,
  };
  if (name === 'dashboard') {
    return (
      <svg {...common}>
        <rect x="3" y="3" width="8" height="8" rx="1.5" />
        <rect x="13" y="3" width="8" height="8" rx="1.5" />
        <rect x="3" y="13" width="8" height="8" rx="1.5" />
        <rect x="13" y="13" width="8" height="8" rx="1.5" />
      </svg>
    );
  }
  if (name === 'requests') {
    return (
      <svg {...common}>
        <path d="M7 3h8l4 4v14H7z" />
        <path d="M15 3v5h5" />
        <path d="M10 12h6M10 16h6" />
      </svg>
    );
  }
  if (name === 'my-requests') {
    return (
      <svg {...common}>
        <circle cx="12" cy="8" r="3" />
        <path d="M6 19c.8-3 2.8-4.5 6-4.5s5.2 1.5 6 4.5" />
      </svg>
    );
  }
  if (name === 'approvals') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8" />
        <path d="M8.5 12.5l2.2 2.2 4.8-5" />
      </svg>
    );
  }
  if (name === 'employees') {
    return (
      <svg {...common}>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" />
        <circle cx="17" cy="9" r="2.2" />
        <path d="M16.2 14.6c2.2.3 3.8 1.6 4.3 4.4" />
      </svg>
    );
  }
  if (name === 'departments') {
    return (
      <svg {...common}>
        <path d="M4 20V6l8-3 8 3v14" />
        <path d="M9 20v-5h6v5" />
      </svg>
    );
  }
  if (name === 'expand' || name === 'collapse') {
    return (
      <svg {...common}>
        <path d={name === 'collapse' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
    </svg>
  );
}

function NavLink({
  view,
  current,
  children,
  onNavigate,
}: {
  view: AdminView;
  current: AdminView;
  children: string;
  onNavigate: (view: AdminView, query?: Record<string, string>) => void;
}) {
  return (
    <a
      href={adminPath(view)}
      className="sidebar-link"
      aria-current={current === view ? 'page' : undefined}
      title={children}
      onClick={(event) => {
        event.preventDefault();
        onNavigate(view);
      }}
    >
      <NavGlyph name={view} />
      <span className="sidebar-label">{children}</span>
    </a>
  );
}

export function AdminShell({
  user,
  view,
  busy,
  children,
  onNavigate,
  onLogout,
  navigation,
}: {
  user: SessionUser;
  view: AdminView;
  busy: boolean;
  children: ReactNode;
  onNavigate: (view: AdminView, query?: Record<string, string>) => void;
  onLogout: () => void;
  navigation?: {
    label: string;
    links: { key: string; label: string; current: boolean; onSelect: () => void }[];
  };
}) {
  const roleLabel = navigation ? navigation.label : 'Super Admin';
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('hub-sidebar') === 'collapsed');

  useEffect(() => {
    localStorage.setItem('hub-sidebar', collapsed ? 'collapsed' : 'expanded');
  }, [collapsed]);

  return (
    <div className={collapsed ? 'admin-shell sidebar-collapsed' : 'admin-shell'}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <button
            className="sidebar-toggle"
            type="button"
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => setCollapsed((current) => !current)}
          >
            <NavGlyph name={collapsed ? 'expand' : 'collapse'} />
          </button>
          <div className="sidebar-brand-text">
            <p className="sidebar-kicker">{roleLabel}</p>
            <h1>Internal Operations Service Hub</h1>
          </div>
        </div>
        <nav className="sidebar-nav" aria-label={roleLabel}>
          {navigation ? (
            navigation.links.map((link) => (
              <a
                key={link.key}
                href={`/${link.key}`}
                className="sidebar-link"
                aria-current={link.current ? 'page' : undefined}
                title={link.label}
                onClick={(event) => {
                  event.preventDefault();
                  link.onSelect();
                }}
              >
                <NavGlyph name={link.key} />
                <span className="sidebar-label">{link.label}</span>
              </a>
            ))
          ) : (
            <>
              <NavLink view="dashboard" current={view} onNavigate={onNavigate}>
                Dashboard
              </NavLink>
              <NavLink view="requests" current={view} onNavigate={onNavigate}>
                Requests
              </NavLink>
              <NavLink view="my-requests" current={view} onNavigate={onNavigate}>
                My Requests
              </NavLink>
              <NavLink view="approvals" current={view} onNavigate={onNavigate}>
                Approvals
              </NavLink>
              <NavLink view="employees" current={view} onNavigate={onNavigate}>
                Staff
              </NavLink>
              <NavLink view="departments" current={view} onNavigate={onNavigate}>
                Departments
              </NavLink>
              <NavLink view="settings" current={view} onNavigate={onNavigate}>
                Settings
              </NavLink>
            </>
          )}
        </nav>
        <div className="sidebar-footer">
          <p data-testid="signed-in-name">Signed in as {user.name}</p>
          <p>{user.companyName}</p>
          <button className="btn-secondary" type="button" onClick={onLogout} disabled={busy} title="Log out">
            <LogoutIcon />
            <span className="sidebar-label">Log out</span>
          </button>
        </div>
      </aside>
      <div className="admin-main">
        {children}
      </div>
    </div>
  );
}

export function ComingLaterPage({ title, detail }: { title: string; detail: string }) {
  return (
    <div data-testid="coming-later">
      <header className="workspace-header">
        <h2>{title}</h2>
        <p className="muted">Coming later</p>
      </header>
      <p className="muted">{detail}</p>
    </div>
  );
}

export function DashboardPage({
  onNavigate,
  onUnauthorized,
  onOpenCompose,
}: {
  onNavigate: (view: AdminView, query?: Record<string, string>) => void;
  onUnauthorized: () => void;
  onOpenCompose: (mode: 'create' | 'intake') => void;
}) {
  const [counts, setCounts] = useState<DashboardCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const generation = currentSessionGeneration();
    setLoading(true);
    setError('');
    getDashboardCounts()
      .then((next) => {
        if (currentSessionGeneration() !== generation) {
          return;
        }
        setCounts(next);
      })
      .catch((err: unknown) => {
        if (err instanceof StaleSessionResult) {
          return;
        }
        if (err instanceof ApiError && err.status === 401) {
          onUnauthorized();
          return;
        }
        setError(err instanceof Error ? err.message : 'Could not load dashboard');
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p>Loading dashboard…</p>;
  }
  if (error) {
    return (
      <div className="alert" role="alert">
        {error}
      </div>
    );
  }
  if (!counts) {
    return <p className="muted">No dashboard data yet.</p>;
  }

  function open(view: AdminView, query?: Record<string, string>) {
    onNavigate(view, query);
  }

  return (
    <div>
      <header className="workspace-header section-heading">
        <div>
          <h2>Dashboard</h2>
          <p className="muted">Figures are for this company.</p>
        </div>
        <RequestStartActions
          onCreate={() => onOpenCompose('create')}
          onIntake={() => onOpenCompose('intake')}
        />
      </header>
      <div className="summary-board summary-board-paired" data-testid="dashboard-counts">
        <SummaryCard
          className="summary-card-requests"
          title="Requests"
          total={counts.requests.total}
          totalTestId="count-requests"
          icon={<RequestsIcon />}
          href={adminPath('requests')}
          onOpen={() => open('requests')}
          items={requestBreakdown(counts.requests, (query) => ({
            href: adminPath('requests', query),
            onOpen: () => open('requests', query),
          }))}
        />
        <SummaryCard
          title="My Requests"
          total={counts.myRequests.total}
          totalTestId="count-my-requests"
          icon={<MyRequestsIcon />}
          href={adminPath('my-requests')}
          onOpen={() => open('my-requests')}
          items={myRequestBreakdown(counts.myRequests, (query) => ({
            href: adminPath('my-requests', query),
            onOpen: () => open('my-requests', query),
          }))}
        />
        <SummaryCard
          title="Approvals"
          total={counts.approvals.total}
          totalTestId="count-approvals"
          icon={<ApprovalsIcon />}
          href={adminPath('approvals', { status: 'all' })}
          onOpen={() => open('approvals', { status: 'all' })}
          items={approvalBreakdown(counts.approvals, 'count', (status) => ({
            href: adminPath('approvals', { status }),
            onOpen: () => open('approvals', { status }),
          }))}
        />
        <div className="summary-panel" data-testid="staff-departments-panel">
          <SummaryCard
            className="summary-card-embedded"
            title="Staff"
            total={counts.people.total}
            totalTestId="count-employees"
            icon={<PeopleIcon />}
            href={adminPath('employees')}
            onOpen={() => open('employees')}
            items={[
              {
                key: 'admins',
                label: 'Admins',
                value: counts.people.admins,
                testId: 'count-admins',
                href: adminPath('employees', { role: 'ADMIN' }),
                onOpen: () => open('employees', { role: 'ADMIN' }),
              },
              {
                key: 'handlers',
                label: 'Handlers',
                value: counts.people.handlers,
                testId: 'count-handlers',
                href: adminPath('employees', { canHandle: 'true' }),
                onOpen: () => open('employees', { canHandle: 'true' }),
              },
              {
                key: 'employees',
                label: 'Employees',
                value: counts.people.employees,
                testId: 'count-role-employees',
                href: adminPath('employees', { role: 'EMPLOYEE' }),
                onOpen: () => open('employees', { role: 'EMPLOYEE' }),
              },
            ]}
          />
          <a
            className="summary-departments summary-card-main"
            href={adminPath('departments')}
            data-testid="departments-count"
            onClick={(event) => {
              event.preventDefault();
              open('departments');
            }}
          >
            <span className="summary-icon" aria-hidden="true">
              <BuildingIcon />
            </span>
            <span className="summary-figure">
              <strong className="summary-total" data-testid="count-departments">
                {counts.departments}
              </strong>
              <span className="summary-label">Departments</span>
            </span>
          </a>
        </div>
      </div>
      {counts.requests.total === 0 ? (
        <p className="muted" data-testid="dashboard-empty-requests">
          No requests in this company yet. Use New Request to submit one.
        </p>
      ) : null}
      {counts.people.total === 0 ? (
        <p className="muted">No staff in this company yet.</p>
      ) : null}
      {counts.departments === 0 ? (
          <p className="muted">No departments yet. Add one on Departments before inviting staff.</p>
      ) : null}
    </div>
  );
}

export function EmployeesPage({
  user,
  busy,
  run,
  onUnauthorized,
}: {
  user: SessionUser;
  busy: boolean;
  run: (action: () => Promise<void>) => void;
  onUnauthorized: () => void;
}) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<CompanyEmployee[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const initialEmployeeFilters = employeeFiltersFromLocation();
  const [q, setQ] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [role, setRole] = useState<EmployeeListFilters['role']>(initialEmployeeFilters.role);
  const [canHandle, setCanHandle] = useState<EmployeeListFilters['canHandle']>(initialEmployeeFilters.canHandle);
  const [active, setActive] = useState<EmployeeListFilters['active']>('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<CompanyEmployee | null>(null);
  const [removing, setRemoving] = useState<CompanyEmployee | null>(null);
  const [notice, setNotice] = useState('');

  function filters(): EmployeeListFilters {
    return {
      q,
      departmentId: departmentId ? Number(departmentId) : undefined,
      role,
      canHandle,
      active,
    };
  }

  async function loadList(generation: number) {
    const [nextEmployees, nextDepartments] = await Promise.all([
      getCompanyEmployees(filters()),
      getDepartments(),
    ]);
    if (currentSessionGeneration() !== generation) {
      throw new StaleSessionResult();
    }
    setEmployees(nextEmployees);
    setDepartments(nextDepartments);
  }

  useEffect(() => {
    const generation = currentSessionGeneration();
    setLoading(true);
    setError('');
    loadList(generation)
      .catch((err: unknown) => {
        if (err instanceof StaleSessionResult) {
          return;
        }
        if (err instanceof ApiError && err.status === 401) {
          onUnauthorized();
          return;
        }
        setEmployees(null);
        setError(err instanceof Error ? err.message : 'Could not load staff');
      })
      .finally(() => setLoading(false));
  }, [q, departmentId, role, canHandle, active]);

  function onSearch(event: FormEvent) {
    event.preventDefault();
    const generation = currentSessionGeneration();
    setLoading(true);
    setError('');
    void loadList(generation)
      .catch((err: unknown) => {
        if (err instanceof StaleSessionResult) {
          return;
        }
        if (err instanceof ApiError && err.status === 401) {
          onUnauthorized();
          return;
        }
        setError(err instanceof Error ? err.message : 'Could not load staff');
      })
      .finally(() => setLoading(false));
  }

  return (
    <div>
      <header className="workspace-header section-heading">
        <div>
          <h2>Staff</h2>
        </div>
        <InviteStaffButton onClick={() => setInviteOpen(true)} />
      </header>
      {notice ? (
        <p className="muted" role="status">
          {notice}
        </p>
      ) : null}
      <form className="filters" onSubmit={onSearch}>
        <label>
          Search name or email
          <input value={q} onChange={(event) => setQ(event.target.value)} />
        </label>
        <label>
          Department
          <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
            <option value="">All departments</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Role
          <select value={role} onChange={(event) => setRole(event.target.value as EmployeeListFilters['role'])}>
            <option value="">All roles</option>
            <option value="ADMIN">Admins</option>
            <option value="EMPLOYEE">Employee</option>
            <option value="DEPARTMENT_ADMIN">Department Admin</option>
            <option value="SUPER_ADMIN">Super Admin</option>
          </select>
        </label>
        <label>
          Handler eligibility
          <select
            aria-label="Handler eligibility"
            value={canHandle}
            onChange={(event) => setCanHandle(event.target.value as EmployeeListFilters['canHandle'])}
          >
            <option value="">All</option>
            <option value="true">Handlers</option>
            <option value="false">Non-handlers</option>
          </select>
        </label>
        <label>
          Active status
          <select value={active} onChange={(event) => setActive(event.target.value as EmployeeListFilters['active'])}>
            <option value="">All</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </label>
        <button className="btn-secondary" type="submit">
          Apply filters
        </button>
      </form>
      {error ? (
        <div className="alert" role="alert">
          {error}
        </div>
      ) : null}
      {loading ? <p>Loading staff…</p> : null}
      {!loading && employees && employees.length === 0 ? (
        <p className="muted" data-testid="employees-empty">
          No staff match these filters.
        </p>
      ) : null}
      {!loading && employees && employees.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table" data-testid="employee-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Department</th>
                <th scope="col">Role</th>
                <th scope="col">Handler</th>
                <th scope="col">Active</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => (
                <tr key={employee.id}>
                  <td>{employee.name}</td>
                  <td>{employee.email ?? '—'}</td>
                  <td>{employee.department?.name ?? '—'}</td>
                  <td>{staffRoleLabel(employee.role, employee.canHandle)}</td>
                  <td>{handlerCell(employee)}</td>
                  <td>{employee.active ? 'Active' : 'Inactive'}</td>
                  <td>
                    {canManageStaff(user, employee) ? (
                      <StaffRowActions
                        employee={employee}
                        onEdit={() => setEditing(employee)}
                        onRemove={() => setRemoving(employee)}
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {inviteOpen ? (
        <InviteStaffOverlay
          mode="company"
          departments={departments}
          busy={busy}
          run={run}
          onClose={() => setInviteOpen(false)}
          onInvited={async () => {
            setNotice('Invitation sent.');
            await loadList(currentSessionGeneration());
          }}
        />
      ) : null}
      {editing ? (
        <EditStaffOverlay
          mode="company"
          employee={editing}
          departments={departments}
          busy={busy}
          run={run}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setNotice('');
            await loadList(currentSessionGeneration());
          }}
        />
      ) : null}
      {removing ? (
        <RemoveStaffDialog
          mode="company"
          employee={removing}
          busy={busy}
          run={run}
          onClose={() => setRemoving(null)}
          onRemoved={async () => {
            setNotice('');
            await loadList(currentSessionGeneration());
          }}
        />
      ) : null}
    </div>
  );
}


export function DepartmentsPage({
  busy,
  run,
  onUnauthorized,
}: {
  busy: boolean;
  run: (action: () => Promise<void>) => void;
  onUnauthorized: () => void;
}) {
  return <DepartmentWorkspace busy={busy} run={run} onUnauthorized={onUnauthorized} />;
}
