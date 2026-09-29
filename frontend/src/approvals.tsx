import { useEffect, useRef, useState } from 'react';
import { ApiError, decideApproval, getApprovalInbox, getHistory, HistoryRecord, ServiceRequest } from './api';
import { FormOverlay } from './form-overlay';
import { AuthorizedRequestDetail } from './request-detail';
import { formatSubmitted } from './request-stage';
import { ClampedTitle, ClippedText, ReadableText, requestColumn } from './request-table';

function approvalBadgeClass(state: Exclude<ServiceRequest['approvalState'], null>) {
  if (state === 'APPROVED') return 'badge badge-completed';
  if (state === 'DENIED' || state === 'PENDING') return 'badge badge-denied';
  return 'badge badge-submitted';
}

function approvalStateLabel(state: ServiceRequest['approvalState']) {
  if (state === 'NOT_REQUIRED') return 'Not required';
  if (state === 'PENDING') return 'Awaiting Approval';
  if (state === 'APPROVED') return 'Approved';
  if (state === 'DENIED') return 'Denied';
  return '—';
}

function roleLabel(role: string) {
  if (role === 'SUPER_ADMIN') return 'Super Admin';
  if (role === 'DEPARTMENT_ADMIN') return 'Department Admin';
  return role;
}

function readApprovalStatus() {
  const value = new URLSearchParams(window.location.search).get('status') ?? '';
  return value === 'awaiting' || value === 'approved' || value === 'denied' ? value : 'all';
}

export function ApprovalFacts({ request }: { request: ServiceRequest }) {
  return (
    <>
      <div>
        <dt>Approval Status</dt>
        <dd data-testid="approval-state">{approvalStateLabel(request.approvalState)}</dd>
      </div>
      {request.approvalNotice ? (
        <div className="details-wide">
          <dt>Approval notice</dt>
          <dd data-testid="approval-notice">{request.approvalNotice}</dd>
        </div>
      ) : null}
      {request.approvalDecision ? (
        <div className="details-wide">
          <dt>Approval decision</dt>
          <dd data-testid="approval-decision">
            {request.approvalDecision.decision === 'APPROVED' ? 'Approved' : 'Denied'} by{' '}
            {request.approvalDecision.approver.name} ({roleLabel(request.approvalDecision.approverRole)})
            {request.approvalDecision.reason ? `. Reason: ${request.approvalDecision.reason}` : ''}
          </dd>
        </div>
      ) : null}
    </>
  );
}

export function ApprovalInbox({ urlSearch }: { urlSearch: string }) {
  const [items, setItems] = useState<ServiceRequest[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [decisionError, setDecisionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(readApprovalStatus);
  const statusRef = useRef(status);
  statusRef.current = status;

  async function refresh() {
    const inbox = await getApprovalInbox(statusRef.current);
    setItems(inbox.items);
    setSelectedId((current) =>
      current != null && inbox.items.some((item) => item.id === current && item.canOpen !== false) ? current : null,
    );
  }

  useEffect(() => {
    setStatus(readApprovalStatus());
  }, [urlSearch]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getApprovalInbox(status)
      .then((inbox) => {
        if (cancelled) return;
        setItems(inbox.items);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load approvals');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  const selected = items.find((item) => item.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId == null) {
      setHistory([]);
      return;
    }
    let cancelled = false;
    getHistory(selectedId)
      .then((next) => {
        if (!cancelled) setHistory(next);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  async function onDecide(decision: 'APPROVED' | 'DENIED') {
    if (!selected) return;
    setBusy(true);
    setDecisionError('');
    try {
      await decideApproval(selected.id, decision, decision === 'DENIED' ? reason : undefined);
      setReason('');
      await refresh();
    } catch (err: unknown) {
      setDecisionError(err instanceof ApiError ? err.message : 'Could not record the decision');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="approval-inbox">
      <header className="workspace-header">
        <h2>Approvals</h2>
      </header>
      <form className="filters" onSubmit={(event) => event.preventDefault()}>
        <label>
          Approval Status
          <select
            aria-label="Approval Status"
            value={status}
            onChange={(event) => {
              const next = event.target.value;
              const params = new URLSearchParams(window.location.search);
              params.set('status', next);
              window.history.pushState({}, '', `${window.location.pathname}?${params.toString()}`);
              setStatus(next);
            }}
          >
            <option value="all">All</option>
            <option value="awaiting">Awaiting</option>
            <option value="approved">Approved</option>
            <option value="denied">Denied</option>
          </select>
        </label>
      </form>
      {error ? (
        <div className="alert" role="alert">
          {error}
        </div>
      ) : null}
      {loading ? <p className="muted">Loading approvals…</p> : null}
      {!loading ? (
        <div className="table-wrap">
          <table className="data-table request-table" data-testid="approval-table">
            <colgroup>
              <col className="col-id" />
              <col className="col-title" />
              <col className="col-submitter" />
              <col className="col-department" />
              <col className="col-submitted" />
              <col className="col-state" />
            </colgroup>
            <thead>
              <tr>
                <th className="col-id" scope="col">{requestColumn.id}</th>
                <th className="col-title" scope="col">{requestColumn.title}</th>
                <th className="col-submitter" scope="col">{requestColumn.submitter}</th>
                <th className="col-department" scope="col">{requestColumn.destinationDepartment}</th>
                <th className="col-submitted" scope="col">{requestColumn.submittedAt}</th>
                <th className="col-state" scope="col">{requestColumn.approvalState}</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td className="table-empty" colSpan={6}>
                    No requests match this approval status.
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const openable = item.canOpen !== false;
                  return (
                  <tr key={item.id} className={selectedId === item.id ? 'row-selected' : undefined}>
                    <td className="col-id">
                      {openable ? (
                        <button className="link-button" type="button" onClick={() => setSelectedId(item.id)}>
                          #{item.id}
                        </button>
                      ) : (
                        <ReadableText text={`#${item.id}`} />
                      )}
                    </td>
                    <td className="col-title">
                      <ClampedTitle
                        text={item.title ? item.title : 'Untitled request'}
                        buttonId={openable ? `approval-item-${item.id}` : undefined}
                        onOpen={openable ? () => setSelectedId(item.id) : undefined}
                      />
                    </td>
                    <td className="col-submitter">
                      <ReadableText text={item.submitter.name} />
                    </td>
                    <td className="col-department">
                      <ClippedText text={item.department.name} />
                    </td>
                    <td className="col-submitted">
                      <ReadableText text={formatSubmitted(item.submittedAt)} />
                    </td>
                    <td className="col-state">
                      {item.approvalState ? (
                        <span className={approvalBadgeClass(item.approvalState)}>{approvalStateLabel(item.approvalState)}</span>
                      ) : (
                        <ReadableText text="—" />
                      )}
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      ) : null}
      {selected ? (
        <FormOverlay
          title={`Request #${selected.id}`}
          returnFocusId={`approval-item-${selected.id}`}
          onClose={() => {
            setDecisionError('');
            setSelectedId(null);
          }}
        >
          {decisionError ? (
            <div className="alert" role="alert">
              {decisionError}
            </div>
          ) : null}
          <AuthorizedRequestDetail
            request={selected}
            history={history}
            actions={
              selected.canDecide === false ? undefined : (
              <form
                className="stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  void onDecide('DENIED');
                }}
              >
                <label>
                  Denial reason
                  <textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    rows={3}
                    maxLength={2000}
                  />
                </label>
                <div className="actions">
                  <button className="btn-primary" type="button" disabled={busy} onClick={() => void onDecide('APPROVED')}>
                    Approve
                  </button>
                  <button className="btn-secondary" type="submit" disabled={busy || reason.trim().length === 0}>
                    Deny
                  </button>
                </div>
              </form>
              )
            }
          />
        </FormOverlay>
      ) : null}
    </div>
  );
}
