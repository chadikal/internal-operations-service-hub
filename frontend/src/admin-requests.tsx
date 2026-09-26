import { FormEvent, ReactNode, useEffect, useState } from 'react';
import {
  ApiError,
  CompanyRequestFilters,
  CompanyRequestList,
  CompanyRequestListItem,
  currentSessionGeneration,
  Department,
  getCompanyRequests,
  getDepartments,
  getHistory,
  getRequest,
  HistoryRecord,
  ServiceRequest,
  StaleSessionResult,
} from './api';
import { ApprovalFacts } from './approvals';
import { adminPath } from './routing';

function statusClass(status: ServiceRequest['status']) {
  if (status === 'SUBMITTED') return 'badge badge-submitted';
  if (status === 'IN_PROGRESS') return 'badge badge-progress';
  return 'badge badge-completed';
}

function formatWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

type RequestQueryState = {
  scope: 'all' | 'mine';
  status: string;
  departmentId: string;
  assignment: string;
  q: string;
  page: number;
  open: string;
};

function readRequestQuery(): RequestQueryState {
  const params = new URLSearchParams(window.location.search);
  const scope: 'all' | 'mine' = params.get('scope') === 'mine' ? 'mine' : 'all';
  const status = params.get('status') ?? '';
  const departmentId = params.get('departmentId') ?? '';
  const assignment = params.get('assignment') ?? '';
  const q = params.get('q') ?? '';
  const page = Math.max(1, Number(params.get('page') || '1') || 1);
  const open = params.get('open') ?? '';
  return { scope, status, departmentId, assignment, q, page, open };
}

function writeRequestQuery(next: RequestQueryState, replace: boolean) {
  const path = adminPath('requests', {
    scope: next.scope === 'mine' ? 'mine' : undefined,
    status: next.status || undefined,
    departmentId: next.departmentId || undefined,
    assignment: next.assignment === 'unassigned' || next.assignment === 'assigned' ? next.assignment : undefined,
    q: next.q.trim() || undefined,
    page: next.page > 1 ? String(next.page) : undefined,
    open: next.open || undefined,
  });
  const current = `${window.location.pathname}${window.location.search}`;
  if (current === path) {
    return;
  }
  if (replace) {
    window.history.replaceState({}, '', path);
  } else {
    window.history.pushState({}, '', path);
  }
}

export function AdminRequestsPage({
  createdRequestId,
  compose,
  onUnauthorized,
  urlSearch,
}: {
  createdRequestId: number | null;
  compose: ReactNode;
  onUnauthorized: () => void;
  urlSearch: string;
}) {
  const initial = readRequestQuery();
  const [scope, setScope] = useState<'all' | 'mine'>(initial.scope);
  const [status, setStatus] = useState(initial.status);
  const [departmentId, setDepartmentId] = useState(initial.departmentId);
  const [assignment, setAssignment] = useState(initial.assignment);
  const [q, setQ] = useState(initial.q);
  const [page, setPage] = useState(initial.page);
  const [openId, setOpenId] = useState(initial.open);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [list, setList] = useState<CompanyRequestList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<ServiceRequest | null>(null);
  const [history, setHistory] = useState<HistoryRecord[]>([]);

  function queryState() {
    return { scope, status, departmentId, assignment, q, page, open: openId };
  }

  async function loadList(generation: number, next = queryState()) {
    const result = await getCompanyRequests({
      scope: next.scope,
      departmentId: next.departmentId ? Number(next.departmentId) : undefined,
      status: next.status as CompanyRequestFilters['status'],
      assignment: next.assignment as CompanyRequestFilters['assignment'],
      q: next.q,
      page: next.page,
    });
    if (currentSessionGeneration() !== generation) {
      throw new StaleSessionResult();
    }
    setList(result);
  }

  async function loadDetail(id: number, generation: number) {
    const [nextRequest, nextHistory] = await Promise.all([getRequest(id), getHistory(id)]);
    if (currentSessionGeneration() !== generation) {
      throw new StaleSessionResult();
    }
    setDetail(nextRequest);
    setHistory(nextHistory);
  }

  useEffect(() => {
    const next = readRequestQuery();
    setScope(next.scope);
    setStatus(next.status);
    setDepartmentId(next.departmentId);
    setAssignment(next.assignment);
    setQ(next.q);
    setPage(next.page);
    setOpenId(next.open);
  }, [urlSearch]);

  useEffect(() => {
    writeRequestQuery(queryState(), true);
    const generation = currentSessionGeneration();
    setLoading(true);
    setError('');
    Promise.all([loadList(generation), getDepartments()])
      .then(([, nextDepartments]) => {
        if (currentSessionGeneration() !== generation) {
          return;
        }
        setDepartments(nextDepartments);
      })
      .catch((err: unknown) => {
        if (err instanceof StaleSessionResult) {
          return;
        }
        if (err instanceof ApiError && err.status === 401) {
          onUnauthorized();
          return;
        }
        setError(err instanceof Error ? err.message : 'Could not load requests');
      })
      .finally(() => setLoading(false));
  }, [scope, status, departmentId, assignment, q, page]);

  useEffect(() => {
    if (!openId) {
      setDetail(null);
      setHistory([]);
      return;
    }
    const opened = list?.items.find((row) => String(row.id) === openId);
    if (opened && !opened.mine) {
      setDetail(null);
      setHistory([]);
      setOpenId('');
      writeRequestQuery({ ...queryState(), open: '' }, true);
      return;
    }
    const generation = currentSessionGeneration();
    loadDetail(Number(openId), generation).catch((err: unknown) => {
      if (err instanceof StaleSessionResult) {
        return;
      }
      if (err instanceof ApiError && err.status === 401) {
        onUnauthorized();
        return;
      }
      if (err instanceof ApiError && err.status === 403) {
        setDetail(null);
        setHistory([]);
        setOpenId('');
        writeRequestQuery({ ...queryState(), open: '' }, true);
        return;
      }
      setDetail(null);
      setHistory([]);
      setError(err instanceof Error ? err.message : 'Could not load request details');
    });
  }, [openId, list]);

  useEffect(() => {
    if (createdRequestId == null) {
      return;
    }
    setOpenId(String(createdRequestId));
    setPage(1);
    const generation = currentSessionGeneration();
    void loadList(generation).catch(() => undefined);
  }, [createdRequestId]);

  function changeFilters(patch: Partial<RequestQueryState>) {
    if (patch.scope != null) setScope(patch.scope);
    if (patch.status != null) setStatus(patch.status);
    if (patch.departmentId != null) setDepartmentId(patch.departmentId);
    if (patch.assignment != null) setAssignment(patch.assignment);
    if (patch.q != null) setQ(patch.q);
    setPage(1);
    if (patch.open != null) setOpenId(patch.open);
  }

  function openRow(row: CompanyRequestListItem) {
    if (!row.mine) {
      return;
    }
    setOpenId(String(row.id));
    writeRequestQuery({ ...queryState(), open: String(row.id) }, false);
  }

  const pageCount = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1;

  return (
    <div>
      <header className="workspace-header">
        <h2>Requests</h2>
        <p className="muted">
          Company-wide oversight is ID, submitter, title, employee department, destination
          department, and status. Super Admin can open details only for requests they submitted.
          Unassigned is not claimable. Super Admin cannot own, assign, claim, or change work
          status.
        </p>
      </header>

      <div className="tab-list" role="tablist" aria-label="Request lists">
        <button
          type="button"
          role="tab"
          aria-selected={scope === 'all'}
          className={scope === 'all' ? 'tab-active' : 'tab'}
          onClick={() => changeFilters({ scope: 'all' })}
        >
          All requests
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={scope === 'mine'}
          className={scope === 'mine' ? 'tab-active' : 'tab'}
          onClick={() => changeFilters({ scope: 'mine' })}
        >
          My requests
        </button>
      </div>
      {scope === 'mine' ? (
        <p className="muted">Requests you submitted, across departments. This is not requests assigned to you.</p>
      ) : null}

      <form
        className="filters"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          setPage(1);
        }}
      >
        <label>
          Search
          <input value={q} onChange={(event) => changeFilters({ q: event.target.value })} />
        </label>
        <label>
          Department
          <select value={departmentId} onChange={(event) => changeFilters({ departmentId: event.target.value })}>
            <option value="">All departments</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Work status
          <select value={status} onChange={(event) => changeFilters({ status: event.target.value })}>
            <option value="">All statuses</option>
            <option value="ACTIVE">Active (SUBMITTED + IN_PROGRESS)</option>
            <option value="SUBMITTED">SUBMITTED</option>
            <option value="IN_PROGRESS">IN_PROGRESS</option>
            <option value="COMPLETED">COMPLETED</option>
          </select>
        </label>
        <label>
          Assignment
          <select value={assignment} onChange={(event) => changeFilters({ assignment: event.target.value })}>
            <option value="">All</option>
            <option value="unassigned">Unassigned</option>
            <option value="assigned">Assigned</option>
          </select>
        </label>
      </form>

      {error ? (
        <div className="alert" role="alert">
          {error}
        </div>
      ) : null}
      {loading ? <p>Loading requests…</p> : null}
      {!loading && list && list.items.length === 0 ? (
        <p className="muted" data-testid="requests-empty">
          No requests match these filters.
        </p>
      ) : null}
      {!loading && list && list.items.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table" data-testid="request-table">
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col">Title</th>
                <th scope="col">Submitter</th>
                <th scope="col">Employee department</th>
                <th scope="col">Destination department</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((row) => (
                <tr
                  key={row.id}
                  data-testid={`request-row-${row.id}`}
                  className={openId === String(row.id) ? 'row-selected' : undefined}
                >
                  <td>
                    {row.mine ? (
                      <button className="link-button" type="button" onClick={() => openRow(row)}>
                        #{row.id}
                      </button>
                    ) : (
                      `#${row.id}`
                    )}
                  </td>
                  <td>
                    {row.mine ? (
                      <button className="link-button" type="button" onClick={() => openRow(row)}>
                        {row.title ? row.title : '—'}
                      </button>
                    ) : (
                      row.title ? row.title : '—'
                    )}
                  </td>
                  <td>{row.submitter.name}</td>
                  <td>{row.submitterDepartment ? row.submitterDepartment.name : '—'}</td>
                  <td>{row.department.name}</td>
                  <td>
                    <span className={statusClass(row.status)}>{row.status.replace('_', ' ')}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {list && list.total > list.pageSize ? (
        <div className="actions">
          <button className="btn-secondary" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span className="muted">
            Page {list.page} of {pageCount} ({list.total} requests)
          </span>
          <button
            className="btn-secondary"
            type="button"
            disabled={page >= pageCount}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      ) : null}

      {detail ? (
        <>
          <section className="card">
            <div className="card-heading">
              <h2>Request Details</h2>
              <span className={statusClass(detail.status)} data-testid="request-status">
                {detail.status.replace('_', ' ')}
              </span>
            </div>
            <dl className="details">
              <div>
                <dt>Request ID</dt>
                <dd data-testid="request-id">#{detail.id}</dd>
              </div>
              <div>
                <dt>Submitter</dt>
                <dd>{detail.submitter.name}</dd>
              </div>
              <div>
                <dt>Department</dt>
                <dd>{detail.department.name}</dd>
              </div>
              <div>
                <dt>Request type</dt>
                <dd>{detail.requestType ? detail.requestType.name : '—'}</dd>
              </div>
              <div>
                <dt>Approval policy</dt>
                <dd>
                  {detail.capturedApprovalPolicy === 'DEPARTMENT_ADMIN'
                    ? 'Department Admin'
                    : detail.capturedApprovalPolicy === 'SUPER_ADMIN'
                      ? 'Super Admin'
                      : detail.capturedApprovalPolicy === 'NONE'
                        ? 'None'
                        : '—'}
                </dd>
              </div>
              <ApprovalFacts request={detail} />
              <div>
                <dt>Owner</dt>
                <dd>{detail.currentOwner ? detail.currentOwner.name : 'Unassigned'}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{detail.status.replace('_', ' ')}</dd>
              </div>
              <div>
                <dt>Title</dt>
                <dd>{detail.title ? detail.title : '—'}</dd>
              </div>
              <div className="details-wide">
                <dt>Description</dt>
                <dd>{detail.description ? detail.description : '—'}</dd>
              </div>
            </dl>
            <p className="muted">
              Approval state is separate from work status. This Requests page opens details and
              history only for requests you submitted. Unrelated company requests stay on the
              oversight list. Decisions for requests you are eligible to approve are on Approvals.
            </p>
          </section>
          <section className="card">
            <h2>Status History</h2>
            {history.length === 0 ? (
              <p className="muted">No successful status changes yet.</p>
            ) : (
              <ol className="timeline" data-testid="status-history">
                {history.map((record) => (
                  <li key={record.id}>
                    <strong>
                      {record.previousStatus.replace('_', ' ')} → {record.newStatus.replace('_', ' ')}
                    </strong>
                    <span>
                      by {record.changedByEmployee.name} · {formatWhen(record.changedAt)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      ) : null}

      {compose}
    </div>
  );
}
