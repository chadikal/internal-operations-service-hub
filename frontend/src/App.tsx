import { FormEvent, useEffect, useState } from 'react';
import {
  assignOwner,
  createRequest,
  Department,
  Employee,
  getDepartments,
  getEmployees,
  getHistory,
  getRequest,
  HistoryRecord,
  ServiceRequest,
  transition,
} from './api';

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

export default function App() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [actorId, setActorId] = useState<number | null>(null);
  const [departmentId, setDepartmentId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [loadId, setLoadId] = useState('');
  const [request, setRequest] = useState<ServiceRequest | null>(null);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const actor = employees.find((employee) => Number(employee.id) === Number(actorId)) ?? null;
  const canHandle = actor?.canHandle === true;
  const eligibleOwners = employees.filter(
    (employee) =>
      employee.canHandle === true &&
      (request == null || Number(employee.id) !== Number(request.submittedBy)),
  );
  const isCurrentOwner =
    actor != null && request != null && Number(request.currentOwnerId) === Number(actor.id);
  const ownerSelectValue = eligibleOwners.some((employee) => String(employee.id) === ownerId)
    ? ownerId
    : eligibleOwners[0]
      ? String(eligibleOwners[0].id)
      : '';

  useEffect(() => {
    Promise.all([getEmployees(), getDepartments()])
      .then(([nextEmployees, nextDepartments]) => {
        setEmployees(nextEmployees);
        setDepartments(nextDepartments);
        if (nextEmployees[0]) setActorId(Number(nextEmployees[0].id));
        if (nextDepartments[0]) setDepartmentId(String(nextDepartments[0].id));
        const firstHandler = nextEmployees.find((employee) => employee.canHandle === true);
        if (firstHandler) setOwnerId(String(firstHandler.id));
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  async function refresh(id: number, actingAs: number) {
    const [nextRequest, nextHistory] = await Promise.all([
      getRequest(actingAs, id),
      getHistory(actingAs, id),
    ]);
    setRequest(nextRequest);
    setHistory(nextHistory);
  }

  async function run(action: () => Promise<void>) {
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  function onSelectActor(nextActorId: number) {
    const nextActor = employees.find((employee) => Number(employee.id) === Number(nextActorId));
    setActorId(nextActorId);
    if (nextActor?.canHandle === true) {
      setOwnerId(String(nextActor.id));
    }
    setRequest(null);
    setHistory([]);
    setError('');
  }

  function onCreate(event: FormEvent) {
    event.preventDefault();
    if (actorId === null) return;
    void run(async () => {
      const created = await createRequest(actorId, actorId, Number(departmentId));
      await refresh(created.id, actorId);
    });
  }

  function onLoad(event: FormEvent) {
    event.preventDefault();
    if (actorId === null) return;
    void run(async () => {
      try {
        await refresh(Number(loadId), actorId);
      } catch (err) {
        setRequest(null);
        setHistory([]);
        throw err;
      }
    });
  }

  function onAssignOwner(event: FormEvent) {
    event.preventDefault();
    if (
      !request ||
      actor?.canHandle !== true ||
      request.status === 'COMPLETED' ||
      eligibleOwners.length === 0
    ) {
      return;
    }
    void run(async () => {
      await assignOwner(actor.id, request.id, Number(ownerSelectValue));
      await refresh(request.id, actor.id);
    });
  }

  function onTransition(to: 'IN_PROGRESS' | 'COMPLETED') {
    if (!request || actor?.canHandle !== true || request.currentOwnerId !== actor.id) return;
    void run(async () => {
      await transition(actor.id, request.id, to, actor.id);
      await refresh(request.id, actor.id);
    });
  }

  return (
    <div className="page">
      <header className="header">
        <h1>Internal Operations Service Hub</h1>
        <p>Create and track internal department requests</p>
        <div className="actor-switcher" role="group" aria-label="Acting as">
          <span>Acting as:</span>
          {employees.map((employee, index) => (
            <span key={employee.id}>
              {index > 0 ? <span className="actor-divider">|</span> : null}
              <button
                type="button"
                className="actor-btn"
                aria-pressed={actorId === employee.id}
                onClick={() => onSelectActor(employee.id)}
              >
                {employee.name}
              </button>
            </span>
          ))}
        </div>
      </header>

      {error ? (
        <div className="alert" role="alert">
          {error}
        </div>
      ) : null}

      <div className="grid">
        <section className="card">
          <h2>Create Request</h2>
          <p className="muted">
            Requests are submitted as {actor ? actor.name : 'the selected user'}.
          </p>
          <form className="stack" onSubmit={onCreate}>
            <label>
              Department
              <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn-primary" type="submit" disabled={busy || actorId === null}>
              Create Request
            </button>
          </form>
        </section>

        <section className="card">
          <h2>Load Request</h2>
          <p className="muted">Open an existing request by its ID.</p>
          <form className="stack" onSubmit={onLoad}>
            <label>
              Request ID
              <input
                value={loadId}
                onChange={(event) => setLoadId(event.target.value)}
                inputMode="numeric"
              />
            </label>
            <button className="btn-secondary" type="submit" disabled={busy || actorId === null}>
              Load Request
            </button>
          </form>
        </section>
      </div>

      {request ? (
        <>
          <section className="card">
            <div className="card-heading">
              <h2>Request Details</h2>
              <span className={statusClass(request.status)} data-testid="request-status">
                {request.status.replace('_', ' ')}
              </span>
            </div>
            <dl className="details">
              <div>
                <dt>Request ID</dt>
                <dd data-testid="request-id">#{request.id}</dd>
              </div>
              <div>
                <dt>Submitter</dt>
                <dd>{request.submitter.name}</dd>
              </div>
              <div>
                <dt>Department</dt>
                <dd>{request.department.name}</dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd>{request.currentOwner ? request.currentOwner.name : 'Unassigned'}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{request.status.replace('_', ' ')}</dd>
              </div>
            </dl>

            {canHandle ? (
              <>
                {request.status !== 'COMPLETED' ? (
                  eligibleOwners.length === 0 ? (
                    <p className="muted">No eligible handlers available</p>
                  ) : (
                    <form className="inline-form" onSubmit={onAssignOwner}>
                      <label>
                        Assign owner
                        <select
                          value={ownerSelectValue}
                          onChange={(event) => setOwnerId(event.target.value)}
                          disabled={busy}
                        >
                          {eligibleOwners.map((employee) => (
                            <option key={employee.id} value={employee.id}>
                              {employee.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button className="btn-secondary" type="submit" disabled={busy}>
                        Assign owner
                      </button>
                    </form>
                  )
                ) : null}

                <div className="actions">
                  {request.currentOwnerId === null && request.status !== 'COMPLETED' ? (
                    <p className="muted">Assign an owner before work can start.</p>
                  ) : null}

                  {isCurrentOwner && request.status === 'SUBMITTED' ? (
                    <button
                      className="btn-primary"
                      type="button"
                      disabled={busy}
                      onClick={() => onTransition('IN_PROGRESS')}
                    >
                      Start Request
                    </button>
                  ) : null}

                  {isCurrentOwner && request.status === 'IN_PROGRESS' ? (
                    <button
                      className="btn-primary"
                      type="button"
                      disabled={busy}
                      onClick={() => onTransition('COMPLETED')}
                    >
                      Complete Request
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}
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
    </div>
  );
}
