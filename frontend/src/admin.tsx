import { FormEvent, ReactNode, useEffect, useState } from 'react';
import {
  ApiError,
  CompanyEmployee,
  currentSessionGeneration,
  DashboardCounts,
  Department,
  DepartmentTemplate,
  DepartmentTemplateId,
  EmployeeListFilters,
  getCompanyEmployees,
  getDashboardCounts,
  getDepartments,
  getDepartmentTemplates,
  getRequestTypes,
  SessionUser,
  StaleSessionResult,
  updateDepartment,
  deleteDepartment,
  applyDepartmentTemplateTypes,
  createRequestType,
  updateRequestType,
  ApprovalPolicy,
  RequestType,
} from './api';
import { AddDepartmentForm, InviteStaffForm } from './onboarding';
import {
  confirmedSuggestions,
  draftsFromTemplate,
  DraftSuggestion,
  TemplatePicker,
  TemplateSuggestionEditor,
} from './department-templates';
import { AdminView, adminPath } from './routing';

function roleLabel(role: string) {
  if (role === 'SUPER_ADMIN') return 'Super Admin';
  if (role === 'DEPARTMENT_ADMIN') return 'Department Admin';
  if (role === 'EMPLOYEE') return 'Employee';
  return role;
}

function NavLink({
  view,
  current,
  children,
  comingLater,
  onNavigate,
}: {
  view: AdminView;
  current: AdminView;
  children: string;
  comingLater?: boolean;
  onNavigate: (view: AdminView, query?: Record<string, string>) => void;
}) {
  return (
    <a
      href={adminPath(view)}
      className="sidebar-link"
      aria-current={current === view ? 'page' : undefined}
      onClick={(event) => {
        event.preventDefault();
        onNavigate(view);
      }}
    >
      <span>{children}</span>
      {comingLater ? <span className="soon-badge">Coming later</span> : null}
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
}: {
  user: SessionUser;
  view: AdminView;
  busy: boolean;
  children: ReactNode;
  onNavigate: (view: AdminView, query?: Record<string, string>) => void;
  onLogout: () => void;
}) {
  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <p className="sidebar-kicker">Super Admin</p>
          <h1>Operations Hub</h1>
        </div>
        <nav className="sidebar-nav" aria-label="Super Admin">
          <NavLink view="dashboard" current={view} onNavigate={onNavigate}>
            Dashboard
          </NavLink>
          <NavLink view="employees" current={view} onNavigate={onNavigate}>
            Employees
          </NavLink>
          <NavLink view="departments" current={view} onNavigate={onNavigate}>
            Departments
          </NavLink>
          <NavLink view="requests" current={view} onNavigate={onNavigate}>
            Requests
          </NavLink>
          <NavLink view="approvals" current={view} comingLater onNavigate={onNavigate}>
            Approvals
          </NavLink>
          <NavLink view="settings" current={view} comingLater onNavigate={onNavigate}>
            Settings
          </NavLink>
        </nav>
        <div className="sidebar-footer">
          <p data-testid="signed-in-name">Signed in as {user.name}</p>
          <p>{user.companyName}</p>
          <button className="btn-secondary" type="button" onClick={onLogout} disabled={busy}>
            Log out
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
    <section className="card" data-testid="coming-later">
      <h2>{title}</h2>
      <p className="muted">Coming later</p>
      <p className="muted">{detail}</p>
    </section>
  );
}

export function DashboardPage({
  onNavigate,
  onUnauthorized,
}: {
  onNavigate: (view: AdminView, query?: Record<string, string>) => void;
  onUnauthorized: () => void;
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

  const cards: {
    key: string;
    label: string;
    value: number;
    view: AdminView;
    query?: Record<string, string>;
    note?: string;
  }[] = [
    { key: 'employees', label: 'Employees', value: counts.employees, view: 'employees' },
    { key: 'departments', label: 'Departments', value: counts.departments, view: 'departments' },
    { key: 'requests', label: 'All requests', value: counts.requests, view: 'requests' },
    {
      key: 'active',
      label: 'Active requests',
      value: counts.activeRequests,
      view: 'requests',
      query: { status: 'ACTIVE' },
      note: 'SUBMITTED + IN_PROGRESS',
    },
    { key: 'submitted', label: 'SUBMITTED', value: counts.submitted, view: 'requests', query: { status: 'SUBMITTED' } },
    { key: 'inProgress', label: 'IN_PROGRESS', value: counts.inProgress, view: 'requests', query: { status: 'IN_PROGRESS' } },
    { key: 'completed', label: 'COMPLETED', value: counts.completed, view: 'requests', query: { status: 'COMPLETED' } },
  ];

  return (
    <div>
      <header className="workspace-header">
        <h2>Dashboard</h2>
        <p className="muted">Counts for this company only. Approvals and top handlers are not implemented.</p>
      </header>
      <div className="stat-grid" data-testid="dashboard-counts">
        {cards.map((card) => (
          <a
            key={card.key}
            className="stat-card"
            href={adminPath(card.view, card.query)}
            onClick={(event) => {
              event.preventDefault();
              onNavigate(card.view, card.query);
            }}
          >
            <span className="stat-label">{card.label}</span>
            <strong data-testid={`count-${card.key}`}>{card.value}</strong>
            {card.note ? <span className="muted">{card.note}</span> : null}
          </a>
        ))}
      </div>
      {counts.requests === 0 ? (
        <p className="muted" data-testid="dashboard-empty-requests">
          No requests in this company yet. Open Requests to create one.
        </p>
      ) : null}
      {counts.employees === 0 ? (
        <p className="muted">No employees in this company yet.</p>
      ) : null}
      {counts.departments === 0 ? (
        <p className="muted">No departments yet. Add one on the Departments page before inviting staff.</p>
      ) : null}
    </div>
  );
}

export function EmployeesPage({
  busy,
  run,
  onUnauthorized,
}: {
  busy: boolean;
  run: (action: () => Promise<void>) => void;
  onUnauthorized: () => void;
}) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<CompanyEmployee[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [role, setRole] = useState<EmployeeListFilters['role']>('');
  const [canHandle, setCanHandle] = useState<EmployeeListFilters['canHandle']>('');
  const [active, setActive] = useState<EmployeeListFilters['active']>('');

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
        setError(err instanceof Error ? err.message : 'Could not load employees');
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
        setError(err instanceof Error ? err.message : 'Could not load employees');
      })
      .finally(() => setLoading(false));
  }

  return (
    <div>
      <header className="workspace-header">
        <h2>Employees</h2>
        <p className="muted">Accounts in this company. Handler eligibility is separate from role.</p>
      </header>
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
            <option value="EMPLOYEE">Employee</option>
            <option value="DEPARTMENT_ADMIN">Department Admin</option>
            <option value="SUPER_ADMIN">Super Admin</option>
          </select>
        </label>
        <label>
          Handler eligibility
          <select
            value={canHandle}
            onChange={(event) => setCanHandle(event.target.value as EmployeeListFilters['canHandle'])}
          >
            <option value="">All</option>
            <option value="true">Can handle</option>
            <option value="false">Cannot handle</option>
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
      {loading ? <p>Loading employees…</p> : null}
      {!loading && employees && employees.length === 0 ? (
        <p className="muted" data-testid="employees-empty">
          No employees match these filters.
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
                <th scope="col">canHandle</th>
                <th scope="col">Active</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => (
                <tr key={employee.id}>
                  <td>{employee.name}</td>
                  <td>{employee.email ?? '—'}</td>
                  <td>{employee.department?.name ?? '—'}</td>
                  <td>{roleLabel(employee.role)}</td>
                  <td>{employee.canHandle ? 'Yes' : 'No'}</td>
                  <td>{employee.active ? 'Active' : 'Inactive'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <InviteStaffForm
        departments={departments}
        busy={busy}
        run={run}
        onInvited={async () => {
          await loadList(currentSessionGeneration());
        }}
      />
    </div>
  );
}

function policyLabel(policy: ApprovalPolicy) {
  if (policy === 'DEPARTMENT_ADMIN') return 'Department Admin';
  if (policy === 'SUPER_ADMIN') return 'Super Admin';
  return 'None';
}

function RequestTypeRow({
  item,
  busy,
  run,
  onChanged,
  onUnauthorized,
}: {
  item: RequestType;
  busy: boolean;
  run: (action: () => Promise<void>) => void;
  onChanged: () => Promise<void>;
  onUnauthorized: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [policy, setPolicy] = useState<ApprovalPolicy>(item.approvalPolicy);
  const [rowError, setRowError] = useState('');

  useEffect(() => {
    setName(item.name);
    setPolicy(item.approvalPolicy);
  }, [item.name, item.approvalPolicy]);

  function fail(error: unknown, fallback: string) {
    if (error instanceof StaleSessionResult) {
      return;
    }
    if (error instanceof ApiError && error.status === 401) {
      onUnauthorized();
      return;
    }
    setRowError(error instanceof Error ? error.message : fallback);
  }

  return (
    <li>
      {editing ? (
        <form
          className="actions"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            run(async () => {
              setRowError('');
              try {
                await updateRequestType(item.id, { name, approvalPolicy: policy });
                setEditing(false);
                await onChanged();
              } catch (error) {
                fail(error, 'Could not update the request type');
                if (error instanceof StaleSessionResult || (error instanceof ApiError && error.status === 401)) {
                  throw error;
                }
              }
            });
          }}
        >
          <label>
            New name for {item.name}
            <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={200} />
          </label>
          <label>
            Approval policy for {item.name}
            <select
              value={policy}
              onChange={(event) => setPolicy(event.target.value as ApprovalPolicy)}
            >
              <option value="NONE">None</option>
              <option value="DEPARTMENT_ADMIN">Department Admin</option>
              <option value="SUPER_ADMIN">Super Admin</option>
            </select>
          </label>
          <button className="btn-secondary" type="submit" disabled={busy}>
            Save type
          </button>
          <button
            className="btn-secondary"
            type="button"
            disabled={busy}
            onClick={() => {
              setEditing(false);
              setName(item.name);
              setPolicy(item.approvalPolicy);
              setRowError('');
            }}
          >
            Cancel
          </button>
        </form>
      ) : (
        <div className="actions">
          <span>
            {item.name} · {policyLabel(item.approvalPolicy)}
          </span>
          <button className="btn-secondary" type="button" disabled={busy} onClick={() => setEditing(true)}>
            Edit {item.name}
          </button>
        </div>
      )}
      {rowError ? (
        <div className="alert" role="alert">
          {rowError}
        </div>
      ) : null}
    </li>
  );
}

function AddRequestTypeForm({
  department,
  busy,
  run,
  onAdded,
}: {
  department: Department;
  busy: boolean;
  run: (action: () => Promise<void>) => void;
  onAdded: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [policy, setPolicy] = useState<ApprovalPolicy>('NONE');
  const [formError, setFormError] = useState('');

  return (
    <form
      className="stack"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        run(async () => {
          setFormError('');
          try {
            await createRequestType(department.id, name, policy);
            setName('');
            setPolicy('NONE');
            await onAdded();
          } catch (error) {
            if (error instanceof StaleSessionResult) {
              return;
            }
            setFormError(error instanceof Error ? error.message : 'Could not add the request type');
            if (error instanceof ApiError && error.status === 401) {
              throw error;
            }
          }
        });
      }}
    >
      <label>
        New type for {department.name}
        <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={200} />
      </label>
      <label>
        Approval policy for new {department.name} type
        <select value={policy} onChange={(event) => setPolicy(event.target.value as ApprovalPolicy)}>
          <option value="NONE">None</option>
          <option value="DEPARTMENT_ADMIN">Department Admin</option>
          <option value="SUPER_ADMIN">Super Admin</option>
        </select>
      </label>
      <button className="btn-secondary" type="submit" disabled={busy}>
        Add request type to {department.name}
      </button>
      {formError ? (
        <div className="alert" role="alert">
          {formError}
        </div>
      ) : null}
    </form>
  );
}

function ApplyTemplateForm({
  department,
  templates,
  busy,
  run,
  onApplied,
}: {
  department: Department;
  templates: DepartmentTemplate[];
  busy: boolean;
  run: (action: () => Promise<void>) => void;
  onApplied: () => Promise<void>;
}) {
  const [templateId, setTemplateId] = useState('');
  const [drafts, setDrafts] = useState<DraftSuggestion[]>([]);
  const [formError, setFormError] = useState('');
  const selected = templates.find((item) => item.id === templateId);

  return (
    <form
      className="stack"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (templateId === '') {
          return;
        }
        run(async () => {
          setFormError('');
          try {
            await applyDepartmentTemplateTypes(department.id, {
              templateId: templateId as DepartmentTemplateId,
              requestTypes: confirmedSuggestions(drafts),
            });
            setTemplateId('');
            setDrafts([]);
            await onApplied();
          } catch (error) {
            if (error instanceof StaleSessionResult) {
              return;
            }
            setFormError(error instanceof Error ? error.message : 'Could not apply the template');
            if (error instanceof ApiError && error.status === 401) {
              throw error;
            }
          }
        });
      }}
    >
      <TemplatePicker
        label={`Template to apply to ${department.name}`}
        templates={templates}
        value={templateId}
        allowNone
        onChange={(nextId) => {
          setTemplateId(nextId);
          setDrafts(draftsFromTemplate(templates.find((item) => item.id === nextId)));
        }}
      />
      {selected?.unspecifiedNotice ? (
        <p className="muted" role="status">
          {selected.unspecifiedNotice}
        </p>
      ) : null}
      {selected?.id === 'CUSTOM_EMPTY' ? (
        <p className="muted">Custom/Empty suggests no request types.</p>
      ) : null}
      {templateId ? (
        <>
          <TemplateSuggestionEditor
            drafts={drafts}
            scope={department.name}
            onChange={setDrafts}
          />
          <button className="btn-secondary" type="submit" disabled={busy}>
            Apply suggested types to {department.name}
          </button>
        </>
      ) : null}
      {formError ? (
        <div className="alert" role="alert">
          {formError}
        </div>
      ) : null}
    </form>
  );
}

function DepartmentRow({
  department,
  types,
  templates,
  busy,
  run,
  onChanged,
  onUnauthorized,
}: {
  department: Department;
  types: RequestType[];
  templates: DepartmentTemplate[];
  busy: boolean;
  run: (action: () => Promise<void>) => void;
  onChanged: () => Promise<void>;
  onUnauthorized: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(department.name);
  const [rowError, setRowError] = useState('');

  useEffect(() => {
    setName(department.name);
  }, [department.name]);

  function fail(error: unknown, fallback: string) {
    if (error instanceof StaleSessionResult) {
      return;
    }
    if (error instanceof ApiError && error.status === 401) {
      onUnauthorized();
      return;
    }
    setRowError(error instanceof Error ? error.message : fallback);
  }

  return (
    <li>
      {editing ? (
        <form
          className="actions"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            run(async () => {
              setRowError('');
              try {
                await updateDepartment(department.id, name);
                setEditing(false);
                await onChanged();
              } catch (error) {
                fail(error, 'Could not rename the department');
                if (error instanceof StaleSessionResult || (error instanceof ApiError && error.status === 401)) {
                  throw error;
                }
              }
            });
          }}
        >
          <label>
            New name for {department.name}
            <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={200} />
          </label>
          <button className="btn-secondary" type="submit" disabled={busy}>
            Save name
          </button>
          <button
            className="btn-secondary"
            type="button"
            disabled={busy}
            onClick={() => {
              setEditing(false);
              setName(department.name);
              setRowError('');
            }}
          >
            Cancel
          </button>
        </form>
      ) : (
        <div className="actions">
          <span>{department.name}</span>
          <button className="btn-secondary" type="button" disabled={busy} onClick={() => setEditing(true)}>
            Rename {department.name}
          </button>
          <button
            className="btn-secondary"
            type="button"
            disabled={busy}
            onClick={() => {
              run(async () => {
                setRowError('');
                try {
                  await deleteDepartment(department.id);
                  await onChanged();
                } catch (error) {
                  fail(error, 'Could not delete the department');
                  if (error instanceof StaleSessionResult || (error instanceof ApiError && error.status === 401)) {
                    throw error;
                  }
                }
              });
            }}
          >
            Delete {department.name}
          </button>
        </div>
      )}
      {rowError ? (
        <div className="alert" role="alert">
          {rowError}
        </div>
      ) : null}
      <div className="type-block" data-testid={`request-types-for-${department.name}`}>
        <p className="muted">Request types for {department.name}</p>
        {types.length === 0 ? (
          <p className="muted">No request types yet.</p>
        ) : (
          <ul className="plain-list">
            {types.map((item) => (
              <RequestTypeRow
                key={item.id}
                item={item}
                busy={busy}
                run={run}
                onChanged={onChanged}
                onUnauthorized={onUnauthorized}
              />
            ))}
          </ul>
        )}
        <AddRequestTypeForm department={department} busy={busy} run={run} onAdded={onChanged} />
        <ApplyTemplateForm
          department={department}
          templates={templates}
          busy={busy}
          run={run}
          onApplied={onChanged}
        />
      </div>
    </li>
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
  const [departments, setDepartments] = useState<Department[] | null>(null);
  const [requestTypes, setRequestTypes] = useState<RequestType[]>([]);
  const [templates, setTemplates] = useState<DepartmentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function refresh(generation = currentSessionGeneration()) {
    const [next, nextTypes, nextTemplates] = await Promise.all([
      getDepartments(),
      getRequestTypes(),
      getDepartmentTemplates(),
    ]);
    if (currentSessionGeneration() !== generation) {
      throw new StaleSessionResult();
    }
    setDepartments(next);
    setRequestTypes(nextTypes);
    setTemplates(nextTemplates);
  }

  useEffect(() => {
    const generation = currentSessionGeneration();
    setLoading(true);
    setError('');
    refresh(generation)
      .catch((err: unknown) => {
        if (err instanceof StaleSessionResult) {
          return;
        }
        if (err instanceof ApiError && err.status === 401) {
          onUnauthorized();
          return;
        }
        setError(err instanceof Error ? err.message : 'Could not load departments');
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <header className="workspace-header">
        <h2>Departments</h2>
        <p className="muted">
          New companies start with IT, HR, and Finance. Those names are ordinary departments: you
          can rename them or delete unused ones. A department that still has employees or
          requests cannot be deleted.           Optional templates (IT, HR, Finance, Operations, Marketing, Facilities,
          Custom/Empty) can suggest types to review before they apply. The department name stays
          independent of the template. Create and edit request types here. Each type stores an
          approval policy snapshot when a request is submitted; later edits do not change
          existing requests. Approval decisions are not implemented.
        </p>
      </header>
      {error ? (
        <div className="alert" role="alert">
          {error}
        </div>
      ) : null}
      {loading ? <p>Loading departments…</p> : null}
      {!loading && departments && departments.length === 0 ? (
        <p className="muted" data-testid="departments-empty">
          No departments yet. Add one below.
        </p>
      ) : null}
      {!loading && departments && departments.length > 0 ? (
        <ul className="plain-list" data-testid="department-list">
          {departments.map((department) => (
            <DepartmentRow
              key={department.id}
              department={department}
              types={requestTypes.filter((item) => item.departmentId === department.id)}
              templates={templates}
              busy={busy}
              run={run}
              onChanged={async () => {
                setError('');
                try {
                  await refresh();
                } catch (err) {
                  if (err instanceof StaleSessionResult) {
                    return;
                  }
                  setError(err instanceof Error ? err.message : 'Could not refresh departments');
                  if (err instanceof ApiError && err.status === 401) {
                    throw err;
                  }
                }
              }}
              onUnauthorized={onUnauthorized}
            />
          ))}
        </ul>
      ) : null}
      <AddDepartmentForm
        busy={busy}
        run={run}
        templates={templates}
        onAdded={async () => {
          setError('');
          try {
            await refresh();
          } catch (err) {
            if (err instanceof StaleSessionResult) {
              return;
            }
            setError(err instanceof Error ? err.message : 'Could not refresh departments');
            if (err instanceof ApiError && err.status === 401) {
              throw err;
            }
          }
        }}
      />
    </div>
  );
}
