import { FormEvent, useEffect, useState } from 'react';
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
import { FormOverlay } from './form-overlay';
import { AuthorizedRequestDetail } from './request-detail';
import { ClampedTitle, ClippedText, ReadableText, requestColumn } from './request-table';
import { adminPath } from './routing';

function statusClass(status: ServiceRequest['status']) {
  if (status === 'SUBMITTED') return 'badge badge-submitted';
  if (status === 'IN_PROGRESS') return 'badge badge-progress';
  return 'badge badge-completed';
}


type RequestQueryState = {
  status: string;
  departmentId: string;
  assignment: string;
  q: string;
  page: number;
  open: string;
};

function readRequestQuery(): RequestQueryState {
  const params = new URLSearchParams(window.location.search);
  const status = params.get('status') ?? '';
  const departmentId = params.get('departmentId') ?? '';
  const assignment = params.get('assignment') ?? '';
  const q = params.get('q') ?? '';
  const page = Math.max(1, Number(params.get('page') || '1') || 1);
  const open = params.get('open') ?? '';
  return { status, departmentId, assignment, q, page, open };
}

function writeRequestQuery(next: RequestQueryState, replace: boolean) {
  const path = adminPath('requests', {
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
  onUnauthorized,
  urlSearch,
}: {
  createdRequestId: number | null;
  onUnauthorized: () => void;
  urlSearch: string;
}) {
  const initial = readRequestQuery();
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
    return { status, departmentId, assignment, q, page, open: openId };
  }

  async function loadList(generation: number, next = queryState()) {
    const result = await getCompanyRequests({
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
  }, [status, departmentId, assignment, q, page]);

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
          Company requests. Details open only for a request you submitted.
        </p>
      </header>

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
          {requestColumn.destinationDepartment}
          <select value={departmentId} onChange={(event) => changeFilters({ departmentId: event.target.value })}>
            <option value="">All</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {requestColumn.workStatus}
          <select value={status} onChange={(event) => changeFilters({ status: event.target.value })}>
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="SUBMITTED">Submitted</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="COMPLETED">Completed</option>
          </select>
        </label>
        <label>
          Claim Status
          <select aria-label="Claim Status" value={assignment} onChange={(event) => changeFilters({ assignment: event.target.value })}>
            <option value="">All</option>
            <option value="unassigned">Unclaimed</option>
            <option value="assigned">Claimed</option>
          </select>
        </label>
      </form>

      {error ? (
        <div className="alert" role="alert">
          {error}
        </div>
      ) : null}
      {loading ? <p className="muted">Loading requests…</p> : null}
      {!loading && list ? (
        <div className="table-wrap">
          <table className="data-table request-table" data-testid="request-table">
            <colgroup>
              <col className="col-id" />
              <col className="col-title" />
              <col className="col-submitter" />
              <col className="col-department" />
              <col className="col-department" />
              <col className="col-state" />
            </colgroup>
            <thead>
              <tr>
                <th className="col-id" scope="col">{requestColumn.id}</th>
                <th className="col-title" scope="col">{requestColumn.title}</th>
                <th className="col-submitter" scope="col">{requestColumn.submitter}</th>
                <th className="col-department" scope="col">{requestColumn.employeeDepartment}</th>
                <th className="col-department" scope="col">{requestColumn.destinationDepartment}</th>
                <th className="col-state" scope="col">{requestColumn.workStatus}</th>
              </tr>
            </thead>
            <tbody>
              {list.items.length === 0 ? (
                <tr>
                  <td className="table-empty" colSpan={6} data-testid="requests-empty">
                    No requests match these filters.
                  </td>
                </tr>
              ) : null}
              {list.items.map((row) => (
                <tr
                  key={row.id}
                  data-testid={`request-row-${row.id}`}
                  className={openId === String(row.id) ? 'row-selected' : undefined}
                >
                  <td className="col-id">
                    {row.mine ? (
                      <button className="link-button" type="button" onClick={() => openRow(row)}>
                        #{row.id}
                      </button>
                    ) : (
                      <ClippedText text={`#${row.id}`} />
                    )}
                  </td>
                  <td className="col-title">
                    <ClampedTitle
                      text={row.title ? row.title : '—'}
                      buttonId={row.mine ? `oversight-request-${row.id}` : undefined}
                      onOpen={row.mine ? () => openRow(row) : undefined}
                    />
                  </td>
                  <td className="col-submitter">
                    <ReadableText text={row.submitter.name} />
                  </td>
                  <td className="col-department">
                    <ClippedText text={row.submitterDepartment ? row.submitterDepartment.name : '—'} />
                  </td>
                  <td className="col-department">
                    <ClippedText text={row.department.name} />
                  </td>
                  <td className="col-state">
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
        <FormOverlay
          title={`Request #${detail.id}`}
          returnFocusId={`oversight-request-${detail.id}`}
          onClose={() => {
            setDetail(null);
            setHistory([]);
            setOpenId('');
            writeRequestQuery({ ...queryState(), open: '' }, true);
          }}
        >
          <AuthorizedRequestDetail
            request={detail}
            history={history}
            note="This page opens details and history only for requests you submitted. Unrelated company requests stay on the oversight list."
          />
        </FormOverlay>
      ) : null}
    </div>
  );
}
