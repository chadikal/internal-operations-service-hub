import { useEffect, useState } from 'react';
import { ApiError, decideApproval, getApprovalInbox, ServiceRequest } from './api';

function approvalStateLabel(state: ServiceRequest['approvalState']) {
  if (state === 'NOT_REQUIRED') return 'Not required';
  if (state === 'PENDING') return 'Pending';
  if (state === 'APPROVED') return 'Approved';
  if (state === 'DENIED') return 'Denied';
  return '—';
}

function roleLabel(role: string) {
  if (role === 'SUPER_ADMIN') return 'Super Admin';
  if (role === 'DEPARTMENT_ADMIN') return 'Department Admin';
  return role;
}

export function ApprovalFacts({ request }: { request: ServiceRequest }) {
  return (
    <>
      <div>
        <dt>Approval state</dt>
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

export function ApprovalInbox({ role }: { role: 'SUPER_ADMIN' | 'DEPARTMENT_ADMIN' }) {
  const [items, setItems] = useState<ServiceRequest[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const inbox = await getApprovalInbox();
    setItems(inbox.items);
    setSelectedId((current) =>
      current != null && inbox.items.some((item) => item.id === current) ? current : inbox.items[0]?.id ?? null,
    );
  }

  useEffect(() => {
    let cancelled = false;
    getApprovalInbox()
      .then((inbox) => {
        if (cancelled) return;
        setItems(inbox.items);
        setSelectedId(inbox.items[0]?.id ?? null);
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
  }, []);

  const selected = items.find((item) => item.id === selectedId) ?? null;

  async function onDecide(decision: 'APPROVED' | 'DENIED') {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      await decideApproval(selected.id, decision, decision === 'DENIED' ? reason : undefined);
      setReason('');
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : 'Could not record the decision');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" data-testid="approval-inbox">
      <h2>Approvals</h2>
      <p className="muted">
        {role === 'SUPER_ADMIN'
          ? 'Requests in this company whose captured policy is Super Admin. You cannot decide a request you submitted.'
          : 'Requests in your department whose captured policy is Department Admin. You cannot decide a request you submitted.'}
      </p>
      {error ? (
        <div className="alert" role="alert">
          {error}
        </div>
      ) : null}
      {loading ? <p className="muted">Loading approvals…</p> : null}
      {!loading && items.length === 0 ? (
        <p className="muted">No requests are waiting for your approval.</p>
      ) : null}
      {items.length > 0 ? (
        <div className="stack">
          <ul className="approval-list">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={item.id === selectedId ? 'btn-primary' : 'btn-secondary'}
                  onClick={() => setSelectedId(item.id)}
                >
                  #{item.id} {item.title ?? item.department.name}
                </button>
              </li>
            ))}
          </ul>
          {selected ? (
            <article className="stack">
              <h3>
                #{selected.id} {selected.title ?? 'Untitled'}
              </h3>
              <p>{selected.description ?? 'No description'}</p>
              <p className="muted">
                {selected.submitter.name} · {selected.department.name}
                {selected.requestType ? ` · ${selected.requestType.name}` : ''} · Work status{' '}
                {selected.status.replace('_', ' ')}
              </p>
              {selected.approvalNotice ? <p data-testid="approval-notice">{selected.approvalNotice}</p> : null}
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
                  <button
                    className="btn-primary"
                    type="button"
                    disabled={busy}
                    onClick={() => void onDecide('APPROVED')}
                  >
                    Approve
                  </button>
                  <button className="btn-secondary" type="submit" disabled={busy || reason.trim().length === 0}>
                    Deny
                  </button>
                </div>
              </form>
            </article>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
