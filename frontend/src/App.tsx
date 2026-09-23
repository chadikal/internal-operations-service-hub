import { FormEvent, useEffect, useState } from 'react';
import {
  analyzeIntake,
  assignOwner,
  createRequest,
  Department,
  Employee,
  getDepartments,
  getEmployees,
  getHistory,
  getRequest,
  hasActionableIntakeDraft,
  HistoryRecord,
  IntakeResult,
  ServiceRequest,
  transition,
} from './api';

type IntakeStep = 'input' | 'troubleshoot' | 'offer' | 'draft' | 'resolved' | 'declined';

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

function hasMissingRequiredInformation(result: IntakeResult | null): boolean {
  return (result?.missingInformation.length ?? 0) > 0;
}

function intakeSuggestions(result: IntakeResult | null): string[] {
  return result?.suggestions ?? [];
}

function chooseIntakeStep(result: IntakeResult): IntakeStep {
  if (result.situation === 'problem' && result.troubleshootingSteps.length > 0) {
    return 'troubleshoot';
  }
  if (hasMissingRequiredInformation(result)) {
    return 'input';
  }
  if (hasActionableIntakeDraft(result.draft)) {
    return 'offer';
  }
  return 'input';
}

export default function App() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [actorId, setActorId] = useState<number | null>(null);
  const [departmentId, setDepartmentId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [loadId, setLoadId] = useState('');
  const [request, setRequest] = useState<ServiceRequest | null>(null);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [intakeText, setIntakeText] = useState('');
  const [intakeResult, setIntakeResult] = useState<IntakeResult | null>(null);
  const [intakeStep, setIntakeStep] = useState<IntakeStep>('input');

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
  const canSubmitRequest = actorId !== null && departmentId !== '';

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

  function resetIntake() {
    setIntakeText('');
    setIntakeResult(null);
    setIntakeStep('input');
  }

  function applyDraft(result: IntakeResult) {
    if (result.draft?.departmentId != null) {
      setDepartmentId(String(result.draft.departmentId));
    } else {
      setDepartmentId('');
    }
    setTitle(result.draft?.summary ?? '');
    setDescription(result.draft?.description ?? '');
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
    resetIntake();
  }

  async function submitCreate() {
    if (actorId === null || departmentId === '') return;
    const created = await createRequest(actorId, actorId, Number(departmentId), title, description);
    setTitle('');
    setDescription('');
    if (departments[0]) {
      setDepartmentId(String(departments[0].id));
    }
    resetIntake();
    await refresh(created.id, actorId);
  }

  function onCreate(event: FormEvent) {
    event.preventDefault();
    void run(submitCreate);
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

  function onAnalyze(event: FormEvent) {
    event.preventDefault();
    if (actorId === null) return;
    setIntakeResult(null);
    setIntakeStep('input');
    void run(async () => {
      const result = await analyzeIntake(actorId, intakeText);
      setIntakeResult(result);
      setIntakeStep(chooseIntakeStep(result));
    });
  }

  function onProblemSolved(solved: boolean) {
    if (solved) {
      setIntakeStep('resolved');
      return;
    }
    if (hasMissingRequiredInformation(intakeResult)) {
      setIntakeStep('input');
      return;
    }
    if (hasActionableIntakeDraft(intakeResult?.draft)) {
      setIntakeStep('offer');
      return;
    }
    setIntakeStep('input');
  }

  function onPrepareRequest(prepare: boolean) {
    if (
      !intakeResult ||
      hasMissingRequiredInformation(intakeResult) ||
      !hasActionableIntakeDraft(intakeResult.draft)
    ) {
      return;
    }
    if (!prepare) {
      setIntakeStep('declined');
      return;
    }
    applyDraft(intakeResult);
    setIntakeStep('draft');
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

      <section className="card">
        <h2>Request Intake</h2>
        <p className="muted">
          Describe what you need. Suggestions are advisory only; nothing is submitted until you
          click Create Request.
        </p>

        {intakeStep === 'input' || intakeStep === 'troubleshoot' || intakeStep === 'offer' ? (
          <form className="stack" onSubmit={onAnalyze}>
            <label>
              What do you need?
              <textarea
                value={intakeText}
                onChange={(event) => setIntakeText(event.target.value)}
                rows={4}
                disabled={busy}
              />
            </label>
            <button className="btn-primary" type="submit" disabled={busy || actorId === null}>
              Analyze
            </button>
          </form>
        ) : null}

        {intakeResult && intakeResult.missingInformation.length > 0 ? (
          <div className="notice" data-testid="intake-missing-information">
            <p>Some information is missing:</p>
            <ul>
              {intakeResult.missingInformation.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {intakeSuggestions(intakeResult).length > 0 ? (
          <div className="notice" data-testid="intake-suggestions">
            <p>Optional details that may help:</p>
            <ul>
              {intakeSuggestions(intakeResult).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {intakeResult &&
        (intakeStep === 'input' || intakeStep === 'troubleshoot' || intakeStep === 'offer') &&
        (hasMissingRequiredInformation(intakeResult) ||
          (intakeStep === 'input' && !hasActionableIntakeDraft(intakeResult.draft))) ? (
          <p className="muted" data-testid="intake-need-more">
            Please provide the missing details so we can understand your request and help
            you get it to the right department.
          </p>
        ) : null}

        {intakeStep === 'troubleshoot' && intakeResult ? (
          <div className="stack">
            <p className="muted">Try these steps first. They are suggestions, not required actions.</p>
            <ol className="steps" data-testid="troubleshooting-steps">
              {intakeResult.troubleshootingSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <p>Did this solve the problem?</p>
            <div className="actions">
              <button className="btn-primary" type="button" disabled={busy} onClick={() => onProblemSolved(true)}>
                Yes, it's solved
              </button>
              <button className="btn-secondary" type="button" disabled={busy} onClick={() => onProblemSolved(false)}>
                No, still unresolved
              </button>
            </div>
          </div>
        ) : null}

        {intakeStep === 'offer' && !hasMissingRequiredInformation(intakeResult) ? (
          <div className="stack">
            {intakeResult?.situation === 'need' ? (
              <p className="muted">
                This looks like a straightforward request, so troubleshooting is not needed.
              </p>
            ) : (
              <p className="muted">If the problem is still unresolved, you can prepare a request.</p>
            )}
            <p>Do you want to prepare a request?</p>
            <div className="actions">
              <button className="btn-primary" type="button" disabled={busy} onClick={() => onPrepareRequest(true)}>
                Prepare a request
              </button>
              <button className="btn-secondary" type="button" disabled={busy} onClick={() => onPrepareRequest(false)}>
                No thanks
              </button>
            </div>
          </div>
        ) : null}

        {intakeStep === 'resolved' ? (
          <div className="stack">
            <p className="muted">Glad those steps helped. No request was created.</p>
            <button className="btn-secondary" type="button" onClick={resetIntake}>
              Describe something else
            </button>
          </div>
        ) : null}

        {intakeStep === 'declined' ? (
          <div className="stack">
            <p className="muted">No request was created.</p>
            <button className="btn-secondary" type="button" onClick={resetIntake}>
              Describe something else
            </button>
          </div>
        ) : null}

        {intakeStep === 'draft' ? (
          <form className="stack" onSubmit={onCreate}>
            <p className="muted">
              Review and edit this draft. Create Request uses the normal request submission flow.
            </p>
            <label>
              Department
              <select
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
                required
              >
                <option value="">Select a department</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Title
              <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} />
            </label>
            <label>
              Description
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={4}
                maxLength={2000}
              />
            </label>
            <div className="actions">
              <button className="btn-primary" type="submit" disabled={busy || !canSubmitRequest}>
                Create Request
              </button>
              <button className="btn-secondary" type="button" onClick={resetIntake}>
                Start over
              </button>
            </div>
          </form>
        ) : null}
      </section>

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
                <option value="">Select a department</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Title
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={200}
              />
            </label>
            <label>
              Description
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                maxLength={2000}
              />
            </label>
            <button className="btn-primary" type="submit" disabled={busy || !canSubmitRequest}>
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
              <div>
                <dt>Title</dt>
                <dd>{request.title ? request.title : '—'}</dd>
              </div>
              <div className="details-wide">
                <dt>Description</dt>
                <dd>{request.description ? request.description : '—'}</dd>
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
