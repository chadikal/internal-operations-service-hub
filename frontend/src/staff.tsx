import { FormEvent, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  claimRequest,
  CompanyEmployee,
  currentSessionGeneration,
  Department,
  DepartmentDashboardCounts,
  getDepartmentDashboard,
  getDepartmentEmployees,
  getDepartments,
  getDepartmentRequests,
  getHistory,
  getRequest,
  getRequestSummary,
  HistoryRecord,
  listRequestQueue,
  QueueRequest,
  RequestQueue,
  RequestSummary,
  ServiceRequest,
  SessionUser,
  StaleSessionResult,
  transition,
} from './api';
import { FormOverlay } from './form-overlay';
import { canActAsHandler, staffRoleLabel } from './roles';
import {
  canManageStaff,
  EditStaffOverlay,
  handlerCell,
  InviteStaffButton,
  InviteStaffOverlay,
  RemoveStaffDialog,
  StaffRowActions,
} from './staff-manage';
import { AuthorizedRequestDetail } from './request-detail';
import { requestColumn, SubmissionTable } from './request-table';
import { staffPath, StaffView } from './routing';
import { approvalBreakdown, myRequestBreakdown, requestBreakdown } from './dashboard-figures';
import { ApprovalsIcon, MyRequestsIcon, PeopleIcon, RequestsIcon, SummaryCard } from './summary-card';

export function RequestStartActions({
  onCreate,
  onIntake,
}: {
  onCreate: () => void;
  onIntake: () => void;
}) {
  return (
    <div className="page-actions">
      <button id="launch-ai-intake" className="btn-secondary" type="button" onClick={onIntake}>
        AI Intake
      </button>
      <button id="launch-new-request" className="btn-primary" type="button" onClick={onCreate}>
        New Request
      </button>
    </div>
  );
}

export function StaffDashboard({
  user,
  onUnauthorized,
  onCreate,
  onIntake,
  onOpen,
}: {
  user: SessionUser;
  onUnauthorized: () => void;
  onCreate: () => void;
  onIntake: () => void;
  onOpen: (view: StaffView, query?: Record<string, string>) => void;
}) {
  if (user.role === 'DEPARTMENT_ADMIN') {
    return (
      <DepartmentDashboard user={user} onUnauthorized={onUnauthorized} onCreate={onCreate} onIntake={onIntake} onOpen={onOpen} />
    );
  }
  return (
    <PersonalDashboard user={user} onUnauthorized={onUnauthorized} onCreate={onCreate} onIntake={onIntake} onOpen={onOpen} />
  );
}

function PersonalDashboard({
  user,
  onUnauthorized,
  onCreate,
  onIntake,
  onOpen,
}: {
  user: SessionUser;
  onUnauthorized: () => void;
  onCreate: () => void;
  onIntake: () => void;
  onOpen: (view: StaffView, query?: Record<string, string>) => void;
}) {
  const [summary, setSummary] = useState<RequestSummary | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const generation = currentSessionGeneration();
    getRequestSummary()
      .then((next) => {
        if (currentSessionGeneration() === generation) setSummary(next);
      })
      .catch((err: unknown) => {
        if (err instanceof StaleSessionResult) return;
        if (err instanceof ApiError && err.status === 401) {
          onUnauthorized();
          return;
        }
        setError(err instanceof Error ? err.message : 'Could not load dashboard');
      });
  }, [user.id]);

  const title = 'Your dashboard';
  return (
    <div data-testid="staff-dashboard">
      <header className="workspace-header section-heading">
        <div>
          <h2>{title}</h2>
          <p className="muted">Your submissions, and the requests you can open.</p>
        </div>
        <RequestStartActions onCreate={onCreate} onIntake={onIntake} />
      </header>
      {error ? (
        <div className="alert" role="alert">
          {error}
        </div>
      ) : null}
      {!summary && !error ? <p className="muted">Loading dashboard…</p> : null}
      {summary ? (
        <div className="summary-board summary-board-paired">
          <SummaryCard
            title="My Requests"
            total={summary.myRequests.total}
            totalTestId="count-my-requests"
            icon={<MyRequestsIcon />}
            href={staffPath('my-requests')}
            onOpen={() => onOpen('my-requests')}
            items={myRequestBreakdown(summary.myRequests, (query) => ({
              href: `${staffPath('my-requests')}?${new URLSearchParams(query)}`,
              onOpen: () => onOpen('my-requests', query),
            }))}
          />
          {summary.handling ? (
            <SummaryCard
              title="Requests"
              total={summary.handling.available + summary.handling.claimed + summary.handling.completed}
              icon={<RequestsIcon />}
              href={staffPath('requests')}
              onOpen={() => onOpen('requests')}
              items={[
                {
                  key: 'available',
                  label: 'Available',
                  value: summary.handling.available,
                  testId: 'handling-available',
                  href: `${staffPath('requests')}?queue=available`,
                  onOpen: () => onOpen('requests', { queue: 'available' }),
                },
                {
                  key: 'claimed',
                  label: 'Claimed by me',
                  value: summary.handling.claimed,
                  testId: 'handling-claimed',
                  href: `${staffPath('requests')}?queue=claimed`,
                  onOpen: () => onOpen('requests', { queue: 'claimed' }),
                },
                {
                  key: 'completed',
                  label: 'Completed',
                  value: summary.handling.completed,
                  testId: 'handling-completed',
                  href: `${staffPath('requests')}?queue=completed`,
                  onOpen: () => onOpen('requests', { queue: 'completed' }),
                },
              ]}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DepartmentDashboard({
  onUnauthorized,
  onCreate,
  onIntake,
  onOpen,
}: {
  user: SessionUser;
  onUnauthorized: () => void;
  onCreate: () => void;
  onIntake: () => void;
  onOpen: (view: StaffView, query?: Record<string, string>) => void;
}) {
  const [counts, setCounts] = useState<DepartmentDashboardCounts | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const generation = currentSessionGeneration();
    getDepartmentDashboard()
      .then((next) => {
        if (currentSessionGeneration() === generation) setCounts(next);
      })
      .catch((err: unknown) => {
        if (err instanceof StaleSessionResult) return;
        if (err instanceof ApiError && err.status === 401) {
          onUnauthorized();
          return;
        }
        setError(err instanceof Error ? err.message : 'Could not load dashboard');
      });
  }, []);

  return (
    <div data-testid="staff-dashboard">
      <header className="workspace-header section-heading">
        <div>
          <h2>Department dashboard</h2>
          <p className="muted">Figures are for your department.</p>
        </div>
        <RequestStartActions onCreate={onCreate} onIntake={onIntake} />
      </header>
      {error ? (
        <div className="alert" role="alert">
          {error}
        </div>
      ) : null}
      {!counts && !error ? <p className="muted">Loading dashboard…</p> : null}
      {counts ? (
        <div className="summary-board summary-board-paired" data-testid="department-dashboard-counts">
          <SummaryCard
            className="summary-card-requests"
            testId="department-requests"
            title="Requests"
            total={counts.requests.total}
            icon={<RequestsIcon />}
            href={staffPath('requests')}
            onOpen={() => onOpen('requests')}
            items={requestBreakdown(counts.requests, (query) => ({
              href: `${staffPath('requests')}?${new URLSearchParams(query)}`,
              onOpen: () => onOpen('requests', query),
            })).map((item) =>
              item.key === 'claimed'
                ? { ...item, testId: 'department-claimed' }
                : item.key === 'unclaimed'
                  ? { ...item, testId: 'department-unclaimed' }
                  : item,
            )}
          />
          <SummaryCard
            title="My Requests"
            total={counts.myRequests.total}
            totalTestId="count-my-requests"
            icon={<MyRequestsIcon />}
            href={staffPath('my-requests')}
            onOpen={() => onOpen('my-requests')}
            items={myRequestBreakdown(counts.myRequests, (query) => ({
              href: `${staffPath('my-requests')}?${new URLSearchParams(query)}`,
              onOpen: () => onOpen('my-requests', query),
            }))}
          />
          <SummaryCard
            testId="department-approvals"
            title="Approvals"
            total={counts.approvals.total}
            icon={<ApprovalsIcon />}
            href={`${staffPath('approvals')}?status=all`}
            onOpen={() => onOpen('approvals', { status: 'all' })}
            items={approvalBreakdown(counts.approvals, 'department', (status) => ({
              href: `${staffPath('approvals')}?status=${status}`,
              onOpen: () => onOpen('approvals', { status }),
            })).map((item) =>
              item.key === 'awaiting' ? { ...item, testId: 'department-pending-approvals' } : item,
            )}
          />
          <SummaryCard
            className="summary-card-wide"
            testId="department-employees"
            title="Staff"
            total={counts.people.total}
            icon={<PeopleIcon />}
            href={staffPath('employees')}
            onOpen={() => onOpen('employees')}
            items={[
              {
                key: 'admins',
                label: 'Department Admin',
                value: counts.people.admins,
                testId: 'department-admins',
                href: `${staffPath('employees')}?role=DEPARTMENT_ADMIN`,
                onOpen: () => onOpen('employees', { role: 'DEPARTMENT_ADMIN' }),
              },
              {
                key: 'handlers',
                label: 'Handlers',
                value: counts.people.handlers,
                testId: 'department-handlers',
                href: `${staffPath('employees')}?canHandle=true`,
                onOpen: () => onOpen('employees', { canHandle: 'true' }),
              },
              {
                key: 'employees',
                label: 'Employees',
                value: counts.people.employees,
                testId: 'department-role-employees',
                href: `${staffPath('employees')}?role=EMPLOYEE`,
                onOpen: () => onOpen('employees', { role: 'EMPLOYEE' }),
              },
            ]}
          />
        </div>
      ) : null}
    </div>
  );
}

export function DepartmentEmployeesPage({
  user,
  onUnauthorized,
}: {
  user: SessionUser;
  onUnauthorized: () => void;
}) {
  const params = new URLSearchParams(window.location.search);
  const initialCanHandle = params.get('canHandle');
  const initialRole = params.get('role');
  const [canHandle, setCanHandle] = useState<'' | 'true' | 'false'>(
    initialCanHandle === 'true' || initialCanHandle === 'false' ? initialCanHandle : '',
  );
  const [role, setRole] = useState(initialRole === 'EMPLOYEE' || initialRole === 'DEPARTMENT_ADMIN' ? initialRole : '');
  const [rows, setRows] = useState<CompanyEmployee[] | null>(null);
  const [department, setDepartment] = useState<Department | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<CompanyEmployee | null>(null);
  const [removing, setRemoving] = useState<CompanyEmployee | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const generation = currentSessionGeneration();
    setLoading(true);
    Promise.all([getDepartmentEmployees({ canHandle, role }), getDepartments()])
      .then(([next, departments]) => {
        if (currentSessionGeneration() !== generation) return;
        setRows(next);
        setDepartment(departments.find((item) => item.id === user.departmentId) ?? null);
      })
      .catch((err: unknown) => {
        if (err instanceof StaleSessionResult) return;
        if (err instanceof ApiError && err.status === 401) {
          onUnauthorized();
          return;
        }
        setRows([]);
        setError(err instanceof Error ? err.message : 'Could not load staff');
      })
      .finally(() => {
        if (currentSessionGeneration() === generation) setLoading(false);
      });
  }, [canHandle, role]);

  return (
    <div data-testid="department-employees">
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
      <form className="filters" onSubmit={(event) => event.preventDefault()}>
        <label>
          Role
          <select aria-label="Role" value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="">All</option>
            <option value="DEPARTMENT_ADMIN">Department Admin</option>
            <option value="EMPLOYEE">Employee</option>
          </select>
        </label>
        <label>
          Handler eligibility
          <select
            aria-label="Handler eligibility"
            value={canHandle}
            onChange={(event) => setCanHandle(event.target.value as '' | 'true' | 'false')}
          >
            <option value="">All</option>
            <option value="true">Handlers</option>
            <option value="false">Non-handlers</option>
          </select>
        </label>
      </form>
      {error ? (
        <div className="alert" role="alert">
          {error}
        </div>
      ) : null}
      {loading ? <p className="muted">Loading staff…</p> : null}
      {!loading && rows && rows.length === 0 ? (
        <p className="muted">No staff match these filters.</p>
      ) : null}
      {!loading && rows && rows.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table" data-testid="department-employee-table">
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
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.email ?? '—'}</td>
                  <td>{row.department ? row.department.name : '—'}</td>
                  <td>{staffRoleLabel(row.role, row.canHandle)}</td>
                  <td>{handlerCell(row)}</td>
                  <td>{row.active ? 'Active' : 'Inactive'}</td>
                  <td>
                    {canManageStaff(user, row) ? (
                      <StaffRowActions employee={row} onEdit={() => setEditing(row)} onRemove={() => setRemoving(row)} />
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
          mode="department"
          departments={department ? [department] : []}
          fixedDepartment={department}
          busy={false}
          run={(action) => void action()}
          onClose={() => setInviteOpen(false)}
          onInvited={async () => {
            setNotice('Invitation sent.');
            const next = await getDepartmentEmployees({ canHandle, role });
            setRows(next);
          }}
        />
      ) : null}
      {editing ? (
        <EditStaffOverlay
          mode="department"
          employee={editing}
          departments={department ? [department] : []}
          busy={false}
          run={(action) => void action()}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setNotice('');
            const next = await getDepartmentEmployees({ canHandle, role });
            setRows(next);
          }}
        />
      ) : null}
      {removing ? (
        <RemoveStaffDialog
          mode="department"
          employee={removing}
          busy={false}
          run={(action) => void action()}
          onClose={() => setRemoving(null)}
          onRemoved={async () => {
            setNotice('');
            const next = await getDepartmentEmployees({ canHandle, role });
            setRows(next);
          }}
        />
      ) : null}
    </div>
  );
}

export function StaffRequestList({
  user,
  onUnauthorized,
}: {
  user: SessionUser;
  onUnauthorized: () => void;
}) {
  const handler = canActAsHandler(user.role, user.canHandle);
  const departmentAdmin = user.role === 'DEPARTMENT_ADMIN';
  const initialList = departmentListFiltersFromLocation();
  const [tab, setTab] = useState<RequestTab>(() => initialRequestTab(handler, departmentAdmin));
  const [q, setQ] = useState('');
  const [approvalState, setApprovalState] = useState('');
  const [workStatus, setWorkStatus] = useState('');
  const [listStatus, setListStatus] = useState(initialList.status);
  const [listAssignment, setListAssignment] = useState(initialList.assignment);
  const [items, setItems] = useState<QueueRequest[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ServiceRequest | null>(null);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const openRequestId = useRef<number | null>(null);

  async function load(nextTab = tab) {
    const filters: { q?: string; approvalState?: string; workStatus?: string } = {};
    if (q.trim()) filters.q = q.trim();
    setLoading(true);
    try {
      if (nextTab === 'all') {
        const result = await getDepartmentRequests({
          q: filters.q,
          status: listStatus as '' | 'ACTIVE' | 'SUBMITTED' | 'IN_PROGRESS' | 'COMPLETED',
          assignment: listAssignment as '' | 'unassigned' | 'assigned',
        });
        setItems(result.items);
        return result.items;
      }
      if (nextTab === 'submitted' || nextTab === 'department') {
        if (approvalState) filters.approvalState = approvalState;
      }
      if (nextTab === 'submitted' || nextTab === 'claimed') {
        if (workStatus) filters.workStatus = workStatus;
      }
      const result = await listRequestQueue(nextTab, filters);
      setItems(result.items);
      return result.items;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const generation = currentSessionGeneration();
    load(tab)
      .then((next) => {
        if (currentSessionGeneration() !== generation) return;
        if (selectedId != null && !next.some((item) => item.id === selectedId)) {
          setSelectedId(null);
          setDetail(null);
          setHistory([]);
        }
      })
      .catch((err: unknown) => {
        if (err instanceof StaleSessionResult) return;
        if (err instanceof ApiError && err.status === 401) {
          onUnauthorized();
          return;
        }
        setError(err instanceof Error ? err.message : 'Could not load requests');
      });
  }, [tab]);

  async function openItem(id: number) {
    const row = items.find((item) => item.id === id);
    if (row?.canOpen === false) return;
    openRequestId.current = id;
    setSelectedId(id);
    setError('');
    try {
      const [nextRequest, nextHistory] = await Promise.all([getRequest(id), getHistory(id)]);
      if (openRequestId.current !== id) return;
      setDetail(nextRequest);
      setHistory(nextHistory);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 401) {
        onUnauthorized();
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not open this request');
    }
  }

  async function refreshOpen(id: number) {
    await load(tab);
    if (openRequestId.current !== id) return;
    await openItem(id);
  }

  function onSearch(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (tab === 'all') {
      const params = new URLSearchParams();
      if (listStatus) params.set('status', listStatus);
      if (listAssignment) params.set('assignment', listAssignment);
      if (q.trim()) params.set('q', q.trim());
      const qs = params.toString();
      const path = `${staffPath('requests')}${qs ? `?${qs}` : ''}`;
      if (`${window.location.pathname}${window.location.search}` !== path) {
        window.history.replaceState({}, '', path);
      }
    }
    load(tab).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Could not load requests');
    });
  }

  const tabs: { id: RequestTab; label: string }[] = [];
  if (departmentAdmin) {
    tabs.push({ id: 'all', label: 'All requests' });
  }
  if (handler) {
    tabs.push(
      { id: 'available', label: 'Available' },
      { id: 'claimed', label: 'Claimed by Me' },
      { id: 'completed', label: 'Completed' },
    );
  }
  if (!handler && !departmentAdmin) {
    tabs.push({ id: 'submitted', label: 'My Requests' });
  }

  const showApprovalFilter = tab === 'submitted' || tab === 'department';
  const showWorkFilter = tab === 'submitted' || tab === 'claimed';
  const showDepartmentFilters = tab === 'all';

  function selectTab(next: RequestTab) {
    setTab(next);
    setApprovalState('');
    setWorkStatus('');
    setListStatus('');
    setListAssignment('');
    setSelectedId(null);
    setDetail(null);
    setHistory([]);
    const path = next === 'all' ? staffPath('requests') : `${staffPath('requests')}?queue=${next}`;
    if (`${window.location.pathname}${window.location.search}` !== path) {
      window.history.pushState({}, '', path);
    }
  }

  return (
    <div data-testid="request-queue">
      <header className="workspace-header">
        <h2>Requests</h2>
        <p className="muted">{queueDescription(tab)}</p>
      </header>
      {tabs.length > 1 ? (
        <div className="request-tabs" role="tablist" aria-label="Request lists">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={tab === item.id ? 'request-tab request-tab-current' : 'request-tab'}
              onClick={() => selectTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
      <form className="filters" onSubmit={onSearch}>
        <label>
          Search
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Title, submitter, or ID"
            aria-label="Search requests"
          />
        </label>
        {showApprovalFilter ? (
          <label>
            Approval Status
            <select
              aria-label="Approval Status"
              value={approvalState}
              onChange={(event) => setApprovalState(event.target.value)}
            >
              <option value="">All approval states</option>
              <option value="NOT_REQUIRED">Not required</option>
              <option value="PENDING">Awaiting Approval</option>
              <option value="APPROVED">Approved</option>
              <option value="DENIED">Denied</option>
            </select>
          </label>
        ) : null}
        {showDepartmentFilters ? (
          <>
            <label>
              Work Status
              <select aria-label="Work Status" value={listStatus} onChange={(event) => setListStatus(event.target.value)}>
                <option value="">All</option>
                <option value="SUBMITTED">Submitted</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="COMPLETED">Completed</option>
                <option value="ACTIVE">Active</option>
              </select>
            </label>
            <label>
              Claim Status
              <select
                aria-label="Claim Status"
                value={listAssignment}
                onChange={(event) => setListAssignment(event.target.value)}
              >
                <option value="">All</option>
                <option value="unassigned">Unclaimed</option>
                <option value="assigned">Claimed</option>
              </select>
            </label>
          </>
        ) : null}
        {showWorkFilter ? (
          <label>
            Work Status
            <select
              aria-label="Work Status"
              value={workStatus}
              onChange={(event) => setWorkStatus(event.target.value)}
            >
              <option value="">All work statuses</option>
              <option value="SUBMITTED">Submitted</option>
              <option value="IN_PROGRESS">In Progress</option>
              {tab === 'submitted' ? <option value="COMPLETED">Completed</option> : null}
            </select>
          </label>
        ) : null}
        <button className="btn-secondary" type="submit">
          Apply
        </button>
      </form>
      {error ? (
        <div className="alert" role="alert">
          {error}
        </div>
      ) : null}
      {loading ? <p className="muted">Loading requests…</p> : null}
      {!loading ? (
        <SubmissionTable
          testId="queue-table"
          items={items}
          selectedId={selectedId}
          emptyLabel="No requests in this list."
          rowFocusId={(id) => `queue-request-${id}`}
          canOpenItem={(item) => item.canOpen !== false}
          onOpen={(item) => void openItem(item.id)}
        />
      ) : null}
      {detail ? (
        <FormOverlay
          title={`Request #${detail.id}`}
          returnFocusId={`queue-request-${detail.id}`}
          onClose={() => {
            openRequestId.current = null;
            setDetail(null);
            setHistory([]);
            setSelectedId(null);
          }}
        >
          <AuthorizedRequestDetail
            request={detail}
            history={history}
            actions={
              <RequestActions
                user={user}
                request={detail}
                busy={busy}
                onClaim={() => {
                  setBusy(true);
                  claimRequest(detail.id)
                    .then(() => refreshOpen(detail.id))
                    .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not claim'))
                    .finally(() => setBusy(false));
                }}
                onTransition={(to) => {
                  setBusy(true);
                  transition(detail.id, to, user.id)
                    .then(() => refreshOpen(detail.id))
                    .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not update status'))
                    .finally(() => setBusy(false));
                }}
              />
            }
          />
        </FormOverlay>
      ) : null}
    </div>
  );
}

function queueDescription(tab: RequestTab) {
  if (tab === 'all') {
    return 'Every request whose destination is your department. A row opens only when you can already view that request.';
  }
  if (tab === 'available') return 'Requests you can claim now. Claiming moves a request to Claimed by Me.';
  if (tab === 'claimed') return 'Requests you claimed that are not completed.';
  if (tab === 'completed') return 'Requests you finished.';
  if (tab === 'department') {
    return 'Requests destined for your department whose captured policy is Department Admin, excluding requests you submitted.';
  }
  return 'Requests you submitted.';
}

type RequestTab = RequestQueue | 'all';

function departmentListFiltersFromLocation() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get('status') ?? '';
  const assignment = params.get('assignment') ?? '';
  const statusAllowed = ['SUBMITTED', 'IN_PROGRESS', 'COMPLETED', 'ACTIVE'];
  const assignmentAllowed = ['unassigned', 'assigned'];
  return {
    status: statusAllowed.includes(status) ? status : '',
    assignment: assignmentAllowed.includes(assignment) ? assignment : '',
  };
}

function initialRequestTab(handler: boolean, departmentAdmin: boolean): RequestTab {
  const value = new URLSearchParams(window.location.search).get('queue');
  if (handler && (value === 'available' || value === 'claimed' || value === 'completed')) return value;
  if (departmentAdmin) return 'all';
  return handler ? 'available' : 'submitted';
}

function myRequestFiltersFromLocation() {
  const params = new URLSearchParams(window.location.search);
  const approvalState = params.get('approvalState') ?? '';
  const workStatus = params.get('workStatus') ?? '';
  const assignment = params.get('assignment') ?? '';
  const approvalAllowed = ['NOT_REQUIRED', 'PENDING', 'APPROVED', 'DENIED'];
  const workAllowed = ['SUBMITTED', 'IN_PROGRESS', 'COMPLETED'];
  const assignmentAllowed = ['unclaimed', 'claimed'];
  return {
    approvalState: approvalAllowed.includes(approvalState) ? approvalState : '',
    workStatus: workAllowed.includes(workStatus) ? workStatus : '',
    assignment: assignmentAllowed.includes(assignment) ? assignment : '',
  };
}

function writeMyRequestFilters(next: { approvalState: string; workStatus: string; assignment: string }) {
  const params = new URLSearchParams();
  const form = new URLSearchParams(window.location.search).get('form');
  if (form === 'create' || form === 'intake') params.set('form', form);
  if (next.approvalState) params.set('approvalState', next.approvalState);
  if (next.workStatus) params.set('workStatus', next.workStatus);
  if (next.assignment) params.set('assignment', next.assignment);
  const qs = params.toString();
  const path = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
  if (`${window.location.pathname}${window.location.search}` !== path) {
    window.history.replaceState({}, '', path);
  }
}


function RequestActions({
  user,
  request,
  busy,
  onClaim,
  onTransition,
}: {
  user: SessionUser;
  request: ServiceRequest;
  busy: boolean;
  onClaim: () => void;
  onTransition: (to: 'IN_PROGRESS' | 'COMPLETED') => void;
}) {
  const canHandle = canActAsHandler(user.role, user.canHandle);
  const owner = request.currentOwnerId != null && Number(request.currentOwnerId) === Number(user.id);
  const canClaim =
    canHandle &&
    user.active &&
    request.currentOwnerId == null &&
    user.departmentId != null &&
    Number(request.departmentId) === Number(user.departmentId) &&
    Number(request.submittedBy) !== Number(user.id) &&
    (request.approvalState === 'NOT_REQUIRED' ||
      request.approvalState === 'APPROVED' ||
      (request.approvalState == null &&
        (request.capturedApprovalPolicy == null || request.capturedApprovalPolicy === 'NONE')));

  if (!canClaim && !(owner && (request.status === 'SUBMITTED' || request.status === 'IN_PROGRESS'))) {
    return null;
  }
  return (
    <div className="actions">
      {canClaim ? (
        <button className="btn-primary" type="button" disabled={busy} onClick={onClaim}>
          Claim
        </button>
      ) : null}
      {owner && request.status === 'SUBMITTED' ? (
        <button className="btn-primary" type="button" disabled={busy} onClick={() => onTransition('IN_PROGRESS')}>
          Start Work
        </button>
      ) : null}
      {owner && request.status === 'IN_PROGRESS' ? (
        <button className="btn-primary" type="button" disabled={busy} onClick={() => onTransition('COMPLETED')}>
          Complete
        </button>
      ) : null}
    </div>
  );
}

export function MyRequestsPage({
  listVersion,
  onUnauthorized,
  onCreate,
  onIntake,
}: {
  listVersion: number;
  onUnauthorized: () => void;
  onCreate: () => void;
  onIntake: () => void;
}) {
  return (
    <SubmittedList
      listVersion={listVersion}
      onUnauthorized={onUnauthorized}
      onCreate={onCreate}
      onIntake={onIntake}
    />
  );
}

function SubmittedList({
  listVersion,
  onUnauthorized,
  onCreate,
  onIntake,
}: {
  listVersion: number;
  onUnauthorized: () => void;
  onCreate: () => void;
  onIntake: () => void;
}) {
  const initialFilters = myRequestFiltersFromLocation();
  const [q, setQ] = useState('');
  const [approvalState, setApprovalState] = useState(initialFilters.approvalState);
  const [workStatus, setWorkStatus] = useState(initialFilters.workStatus);
  const [assignment, setAssignment] = useState(initialFilters.assignment);
  const [items, setItems] = useState<QueueRequest[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ServiceRequest | null>(null);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const result = await listRequestQueue('submitted', {
        q: q.trim() || undefined,
        approvalState: approvalState || undefined,
        workStatus: workStatus || undefined,
        assignment: assignment || undefined,
      });
      setItems(result.items);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const generation = currentSessionGeneration();
    load()
      .then(() => {
        if (currentSessionGeneration() !== generation) return;
      })
      .catch((err: unknown) => {
        if (err instanceof StaleSessionResult) return;
        if (err instanceof ApiError && err.status === 401) onUnauthorized();
        else setError(err instanceof Error ? err.message : 'Could not load your requests');
      });
  }, [listVersion]);

  function openSubmission(item: QueueRequest) {
    setSelectedId(item.id);
    Promise.all([getRequest(item.id), getHistory(item.id)])
      .then(([nextRequest, nextHistory]) => {
        setDetail(nextRequest);
        setHistory(nextHistory);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) onUnauthorized();
        else setError(err instanceof Error ? err.message : 'Could not open this request');
      });
  }

  return (
    <div data-testid="my-requests">
      <header className="workspace-header section-heading">
        <div>
          <h2>My Requests</h2>
          <p className="muted">Requests you submitted.</p>
        </div>
        <RequestStartActions onCreate={onCreate} onIntake={onIntake} />
      </header>
      <form
        className="filters"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          writeMyRequestFilters({ approvalState, workStatus, assignment });
          load().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load your requests'));
        }}
      >
        <label>
          Search
          <input aria-label="Search my requests" value={q} onChange={(event) => setQ(event.target.value)} />
        </label>
        <label>
          {requestColumn.approvalState}
          <select aria-label={requestColumn.approvalState} value={approvalState} onChange={(event) => setApprovalState(event.target.value)}>
            <option value="">All approval states</option>
            <option value="NOT_REQUIRED">Not required</option>
            <option value="PENDING">Awaiting Approval</option>
            <option value="APPROVED">Approved</option>
            <option value="DENIED">Denied</option>
          </select>
        </label>
        <label>
          {requestColumn.workStatus}
          <select aria-label={requestColumn.workStatus} value={workStatus} onChange={(event) => setWorkStatus(event.target.value)}>
            <option value="">All work statuses</option>
            <option value="SUBMITTED">Submitted</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="COMPLETED">Completed</option>
          </select>
        </label>
        <label>
          Claim Status
          <select aria-label="Claim Status" value={assignment} onChange={(event) => setAssignment(event.target.value)}>
            <option value="">All</option>
            <option value="unclaimed">Unclaimed</option>
            <option value="claimed">Claimed</option>
          </select>
        </label>
        <button className="btn-secondary" type="submit">
          Apply
        </button>
      </form>
      {error ? (
        <div className="alert" role="alert">
          {error}
        </div>
      ) : null}
      {loading ? <p className="muted">Loading requests…</p> : null}
      {!loading ? (
        <SubmissionTable
          testId="my-request-table"
          items={items}
          selectedId={selectedId}
          emptyLabel="You have not submitted any requests in this filter."
          rowFocusId={(id) => `my-request-${id}`}
          onOpen={openSubmission}
        />
      ) : null}
      {detail ? (
        <FormOverlay
          title={`Request #${detail.id}`}
          returnFocusId={`my-request-${detail.id}`}
          onClose={() => {
            setDetail(null);
            setHistory([]);
            setSelectedId(null);
          }}
        >
          <AuthorizedRequestDetail request={detail} history={history} />
        </FormOverlay>
      ) : null}
    </div>
  );
}
