import { FormEvent, useEffect, useState } from 'react';
import {
  analyzeIntake,
  ApiError,
  assignOwner,
  createRequest,
  Department,
  Employee,
  getDepartments,
  getEmployees,
  getHistory,
  getMe,
  getRequest,
  hasActionableIntakeDraft,
  HistoryRecord,
  IntakeResult,
  login,
  logout,
  ServiceRequest,
  SessionUser,
  StaleSessionResult,
  beginClientSession,
  currentSessionGeneration,
  signupCompany,
  transition,
  verifyEmail,
  acceptInvitation,
} from './api';
import {
  AcceptInviteForm,
  CheckEmail,
  CompanyTools,
  SignupForm,
  VerifyEmailForm,
} from './onboarding';

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

export default function App() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
  const [gate, setGate] = useState<'login' | 'signup' | 'check-email'>('login');
  const [pendingEmail, setPendingEmail] = useState('');
  const [verifyToken, setVerifyToken] = useState(() => new URLSearchParams(window.location.search).get('verify'));
  const [inviteToken, setInviteToken] = useState(() => new URLSearchParams(window.location.search).get('invite'));

  const canHandle = user?.canHandle === true;
  const eligibleOwners = employees.filter(
    (employee) =>
      employee.canHandle === true &&
      (request == null || Number(employee.id) !== Number(request.submittedBy)),
  );
  const isCurrentOwner =
    user != null && request != null && Number(request.currentOwnerId) === Number(user.id);
  const ownerSelectValue = eligibleOwners.some((employee) => String(employee.id) === ownerId)
    ? ownerId
    : eligibleOwners[0]
      ? String(eligibleOwners[0].id)
      : '';
  const canSubmitRequest = user !== null && departmentId !== '';

  function clearAccountWorkspace() {
    setUser(null);
    setEmployees([]);
    setDepartments([]);
    setDepartmentId('');
    setTitle('');
    setDescription('');
    setOwnerId('');
    setLoadId('');
    setRequest(null);
    setHistory([]);
    setEmail('');
    setPassword('');
    setIntakeText('');
    setIntakeResult(null);
    setIntakeStep('input');
  }

  function applySession(session: SessionUser) {
    beginClientSession(session);
    clearAccountWorkspace();
    setUser(session);
    return currentSessionGeneration();
  }

  useEffect(() => {
    const generation = currentSessionGeneration();
    getMe()
      .then(async (session) => {
        if (currentSessionGeneration() !== generation) {
          return;
        }
        const started = applySession(session);
        const [nextEmployees, nextDepartments] = await Promise.all([getEmployees(), getDepartments()]);
        if (currentSessionGeneration() !== started) {
          return;
        }
        setEmployees(nextEmployees);
        setDepartments(nextDepartments);
        if (nextDepartments[0]) setDepartmentId(String(nextDepartments[0].id));
        const firstHandler = nextEmployees.find((employee) => employee.canHandle === true);
        if (firstHandler) setOwnerId(String(firstHandler.id));
      })
      .catch((err: unknown) => {
        if (err instanceof StaleSessionResult) {
          return;
        }
        if (err instanceof ApiError && err.status === 401) {
          clearAccountWorkspace();
          return;
        }
        setUser(null);
      })
      .finally(() => setReady(true));
  }, []);

  async function refresh(id: number) {
    const generation = currentSessionGeneration();
    const requestPromise = getRequest(id);
    const historyPromise = getHistory(id);
    requestPromise.catch(() => undefined);
    historyPromise.catch(() => undefined);
    const [nextRequest, nextHistory] = await Promise.all([requestPromise, historyPromise]);
    if (currentSessionGeneration() !== generation) {
      throw new StaleSessionResult();
    }
    setRequest(nextRequest);
    setHistory(nextHistory);
  }

  async function run(action: () => Promise<void>) {
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (err) {
      if (err instanceof StaleSessionResult) {
        return;
      }
      if (err instanceof ApiError && err.status === 401) {
        clearAccountWorkspace();
      }
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

  async function submitCreate() {
    if (user === null || departmentId === '') return;
    const generation = currentSessionGeneration();
    const created = await createRequest(user.id, Number(departmentId), title, description);
    if (currentSessionGeneration() !== generation) {
      throw new StaleSessionResult();
    }
    setTitle('');
    setDescription('');
    if (departments[0]) {
      setDepartmentId(String(departments[0].id));
    }
    setIntakeText('');
    setIntakeResult(null);
    setIntakeStep('input');
    await refresh(created.id);
  }

  function onCreate(event: FormEvent) {
    event.preventDefault();
    void run(submitCreate);
  }

  function onLoad(event: FormEvent) {
    event.preventDefault();
    if (user === null) return;
    void run(async () => {
      try {
        await refresh(Number(loadId));
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
      !user ||
      user.canHandle !== true ||
      request.status === 'COMPLETED' ||
      eligibleOwners.length === 0
    ) {
      return;
    }
    void run(async () => {
      await assignOwner(request.id, Number(ownerSelectValue));
      await refresh(request.id);
    });
  }

  function onTransition(to: 'IN_PROGRESS' | 'COMPLETED') {
    if (!request || !user || user.canHandle !== true || request.currentOwnerId !== user.id) return;
    void run(async () => {
      await transition(request.id, to, user.id);
      await refresh(request.id);
    });
  }

  function onAnalyze(event: FormEvent) {
    event.preventDefault();
    if (user === null) return;
    setIntakeResult(null);
    setIntakeStep('input');
    void run(async () => {
      const generation = currentSessionGeneration();
      const result = await analyzeIntake(intakeText);
      if (currentSessionGeneration() !== generation) {
        throw new StaleSessionResult();
      }
      setIntakeResult(result);
      if (result.situation === 'problem' && result.troubleshootingSteps.length > 0) {
        setIntakeStep('troubleshoot');
      } else if (hasActionableIntakeDraft(result.draft)) {
        setIntakeStep('offer');
      } else {
        setIntakeStep('input');
      }
    });
  }

  function onProblemSolved(solved: boolean) {
    if (solved) {
      setIntakeStep('resolved');
      return;
    }
    if (hasActionableIntakeDraft(intakeResult?.draft)) {
      setIntakeStep('offer');
      return;
    }
    setIntakeStep('input');
  }

  function onPrepareRequest(prepare: boolean) {
    if (!intakeResult || !hasActionableIntakeDraft(intakeResult.draft)) return;
    if (!prepare) {
      setIntakeStep('declined');
      return;
    }
    applyDraft(intakeResult);
    setIntakeStep('draft');
  }

  function onLogin(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const session = await login(email, password);
      const started = applySession(session);
      const [nextEmployees, nextDepartments] = await Promise.all([getEmployees(), getDepartments()]);
      if (currentSessionGeneration() !== started) {
        return;
      }
      setEmployees(nextEmployees);
      setDepartments(nextDepartments);
      if (nextDepartments[0]) setDepartmentId(String(nextDepartments[0].id));
      const firstHandler = nextEmployees.find((employee) => employee.canHandle === true);
      if (firstHandler) setOwnerId(String(firstHandler.id));
    });
  }

  function onLogout() {
    void run(async () => {
      await logout();
      clearAccountWorkspace();
    });
  }

  function clearAuthQuery() {
    window.history.replaceState({}, '', window.location.pathname);
    setVerifyToken(null);
    setInviteToken(null);
  }

  async function reloadLookups(generation: number) {
    const [nextEmployees, nextDepartments] = await Promise.all([getEmployees(), getDepartments()]);
    if (currentSessionGeneration() !== generation) {
      return;
    }
    setEmployees(nextEmployees);
    setDepartments(nextDepartments);
    if (nextDepartments[0]) setDepartmentId(String(nextDepartments[0].id));
    const firstHandler = nextEmployees.find((employee) => employee.canHandle === true);
    if (firstHandler) setOwnerId(String(firstHandler.id));
  }

  if (!ready) {
    return (
      <div className="page">
        <p>Loading…</p>
      </div>
    );
  }

  if (verifyToken) {
    return (
      <div className="page">
        <header className="header">
          <h1>Internal Operations Service Hub</h1>
          <p>Verify your email to activate the company workspace</p>
        </header>
        {error ? (
          <div className="alert" role="alert">
            {error}
          </div>
        ) : null}
        <VerifyEmailForm
          token={verifyToken}
          busy={busy}
          onVerify={(token) =>
            run(async () => {
              await verifyEmail(token);
              clearAuthQuery();
              setGate('login');
              setError('');
            })
          }
        />
      </div>
    );
  }

  if (inviteToken) {
    return (
      <div className="page">
        <header className="header">
          <h1>Internal Operations Service Hub</h1>
          <p>Set a password for your invited account</p>
        </header>
        {error ? (
          <div className="alert" role="alert">
            {error}
          </div>
        ) : null}
        <AcceptInviteForm
          token={inviteToken}
          busy={busy}
          onAccept={(token, password) =>
            run(async () => {
              await acceptInvitation(token, password);
              clearAuthQuery();
              setGate('login');
              setPassword('');
              setError('');
            })
          }
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="page">
        <header className="header">
          <h1>Internal Operations Service Hub</h1>
          <p>Sign in to create and track internal department requests</p>
        </header>
        {error ? (
          <div className="alert" role="alert">
            {error}
          </div>
        ) : null}
        {gate === 'check-email' ? (
          <CheckEmail
            email={pendingEmail}
            onBack={() => {
              setGate('login');
              setError('');
            }}
          />
        ) : null}
        {gate === 'signup' ? (
          <>
            <SignupForm
              busy={busy}
              onSubmit={(input) =>
                run(async () => {
                  const result = await signupCompany(input.companyName, input.name, input.email, input.password);
                  setPendingEmail(result.email);
                  setGate('check-email');
                })
              }
            />
            <button
              className="btn-secondary"
              type="button"
              onClick={() => {
                setGate('login');
                setError('');
              }}
            >
              Back to log in
            </button>
          </>
        ) : null}
        {gate === 'login' ? (
          <section className="card">
            <h2>Log in</h2>
            <form className="stack" onSubmit={onLogin}>
              <label>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="username"
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              <button className="btn-primary" type="submit" disabled={busy}>
                Log in
              </button>
            </form>
            <button className="btn-secondary" type="button" onClick={() => setGate('signup')}>
              Create a company workspace
            </button>
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <div className="page">
      <header className="header">
        <h1>Internal Operations Service Hub</h1>
        <p>Create and track internal department requests</p>
        <div className="actor-switcher">
          <span data-testid="signed-in-name">Signed in as {user.name}</span>
          <span>{user.companyName}</span>
          <button className="btn-secondary" type="button" onClick={onLogout} disabled={busy}>
            Log out
          </button>
        </div>
      </header>

      {error ? (
        <div className="alert" role="alert">
          {error}
        </div>
      ) : null}

      {user.role === 'SUPER_ADMIN' ? (
        <CompanyTools
          departments={departments}
          busy={busy}
          run={run}
          onChanged={async () => {
            await reloadLookups(currentSessionGeneration());
          }}
        />
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
            <button className="btn-primary" type="submit" disabled={busy}>
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

        {intakeStep === 'input' &&
        intakeResult &&
        !hasActionableIntakeDraft(intakeResult.draft) ? (
          <p className="muted" data-testid="intake-need-more">
            Please provide a little more detail so we can understand your request and help
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

        {intakeStep === 'offer' ? (
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
            Requests are submitted as {user.name}.
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
            <button className="btn-secondary" type="submit" disabled={busy}>
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
