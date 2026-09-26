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
  getRequestTypes,
  hasActionableIntakeDraft,
  HistoryRecord,
  IntakeResult,
  login,
  logout,
  RequestType,
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
  AdminShell,
  ComingLaterPage,
  DashboardPage,
  DepartmentsPage,
  EmployeesPage,
} from './admin';
import { AdminRequestsPage } from './admin-requests';
import {
  AcceptInviteForm,
  CheckEmail,
  SignupForm,
  VerifyEmailForm,
} from './onboarding';
import { chooseIntakeStep, hasMissingRequiredInformation, IntakeStep, RequestWorkspace } from './request-workspace';
import { AdminView, adminPath, isAdminPath, parseAdminView } from './routing';

function viewFromLocation(role: string | undefined): AdminView | 'home' {
  if (role !== 'SUPER_ADMIN') {
    return 'home';
  }
  return parseAdminView(window.location.pathname) ?? 'dashboard';
}

function firstRequestTypeId(types: RequestType[], departmentId: string): string {
  const match = types.find((item) => String(item.departmentId) === departmentId);
  return match ? String(match.id) : '';
}

function syncUrl(role: string | undefined, view: AdminView | 'home') {
  const next = role === 'SUPER_ADMIN' && view !== 'home' ? adminPath(view) : '/';
  if (window.location.pathname !== next) {
    window.history.replaceState({}, '', next);
  }
}

export default function App() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [requestTypes, setRequestTypes] = useState<RequestType[]>([]);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [requestTypeId, setRequestTypeId] = useState('');
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
  const [view, setView] = useState<AdminView | 'home'>(() => viewFromLocation(undefined));
  const [urlSearch, setUrlSearch] = useState(() => window.location.search);

  const canSubmitRequest = user !== null && departmentId !== '' && requestTypeId !== '';

  function resetWorkspaceData() {
    setEmployees([]);
    setDepartments([]);
    setRequestTypes([]);
    setDepartmentId('');
    setRequestTypeId('');
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

  function clearAccountWorkspace() {
    setUser(null);
    resetWorkspaceData();
    setView('home');
    syncUrl(undefined, 'home');
  }

  function applySession(session: SessionUser) {
    beginClientSession(session);
    resetWorkspaceData();
    setUser(session);
    const nextView = viewFromLocation(session.role);
    setView(nextView);
    syncUrl(session.role, nextView);
    return currentSessionGeneration();
  }

  function goTo(next: AdminView, query?: Record<string, string>) {
    setView(next);
    const path = adminPath(next, query);
    const current = `${window.location.pathname}${window.location.search}`;
    if (current !== path) {
      window.history.pushState({}, '', path);
    }
    setUrlSearch(window.location.search);
  }

  useEffect(() => {
    function onPopState() {
      setView(viewFromLocation(user?.role));
      setUrlSearch(window.location.search);
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [user?.role]);

  useEffect(() => {
    if (user?.role === 'SUPER_ADMIN' && !isAdminPath(window.location.pathname)) {
      syncUrl(user.role, view === 'home' ? 'dashboard' : view);
    }
    if (user && user.role !== 'SUPER_ADMIN' && isAdminPath(window.location.pathname)) {
      setView('home');
      syncUrl(user.role, 'home');
    }
  }, [user, view]);

  useEffect(() => {
    if (!user || view !== 'requests') {
      return;
    }
    const generation = currentSessionGeneration();
    void Promise.all([getEmployees(), getDepartments(), getRequestTypes()]).then(
      ([nextEmployees, nextDepartments, nextTypes]) => {
        if (currentSessionGeneration() !== generation) {
          return;
        }
        setEmployees(nextEmployees);
        setDepartments(nextDepartments);
        setRequestTypes(nextTypes);
        const nextDepartmentId =
          departmentId && nextDepartments.some((department) => String(department.id) === departmentId)
            ? departmentId
            : nextDepartments[0]
              ? String(nextDepartments[0].id)
              : '';
        setDepartmentId(nextDepartmentId);
        setRequestTypeId((current) => {
          if (
            current &&
            nextTypes.some(
              (item) => String(item.id) === current && String(item.departmentId) === nextDepartmentId,
            )
          ) {
            return current;
          }
          return firstRequestTypeId(nextTypes, nextDepartmentId);
        });
        setOwnerId((current) => {
          const handlers = nextEmployees.filter((employee) => employee.canHandle === true);
          if (current && handlers.some((employee) => String(employee.id) === current)) {
            return current;
          }
          return handlers[0] ? String(handlers[0].id) : '';
        });
      },
    );
  }, [user, view]);

  useEffect(() => {
    const generation = currentSessionGeneration();
    getMe()
      .then(async (session) => {
        if (currentSessionGeneration() !== generation) {
          return;
        }
        const started = applySession(session);
        const [nextEmployees, nextDepartments, nextTypes] = await Promise.all([
          getEmployees(),
          getDepartments(),
          getRequestTypes(),
        ]);
        if (currentSessionGeneration() !== started) {
          return;
        }
        setEmployees(nextEmployees);
        setDepartments(nextDepartments);
        setRequestTypes(nextTypes);
        const nextDepartmentId = nextDepartments[0] ? String(nextDepartments[0].id) : '';
        setDepartmentId(nextDepartmentId);
        setRequestTypeId(firstRequestTypeId(nextTypes, nextDepartmentId));
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
    const nextDepartmentId = result.draft?.departmentId != null ? String(result.draft.departmentId) : '';
    setDepartmentId(nextDepartmentId);
    const suggestedType = result.draft?.requestTypeId != null ? String(result.draft.requestTypeId) : '';
    const matchesDepartment = requestTypes.some(
      (item) => String(item.id) === suggestedType && String(item.departmentId) === nextDepartmentId,
    );
    setRequestTypeId(matchesDepartment ? suggestedType : firstRequestTypeId(requestTypes, nextDepartmentId));
    setTitle(result.draft?.summary ?? '');
    setDescription(result.draft?.description ?? '');
  }

  async function submitCreate() {
    if (user === null || departmentId === '' || requestTypeId === '') return;
    const generation = currentSessionGeneration();
    const created = await createRequest(
      user.id,
      Number(departmentId),
      Number(requestTypeId),
      title,
      description,
    );
    if (currentSessionGeneration() !== generation) {
      throw new StaleSessionResult();
    }
    setTitle('');
    setDescription('');
    if (departments[0]) {
      const nextDepartmentId = String(departments[0].id);
      setDepartmentId(nextDepartmentId);
      setRequestTypeId(firstRequestTypeId(requestTypes, nextDepartmentId));
    } else {
      setDepartmentId('');
      setRequestTypeId('');
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
      request.status === 'COMPLETED'
    ) {
      return;
    }
    const eligibleOwners = employees.filter(
      (employee) => employee.canHandle === true && Number(employee.id) !== Number(request.submittedBy),
    );
    if (eligibleOwners.length === 0) {
      return;
    }
    const ownerSelectValue = eligibleOwners.some((employee) => String(employee.id) === ownerId)
      ? ownerId
      : String(eligibleOwners[0].id);
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

  function onLogin(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const session = await login(email, password);
      const started = applySession(session);
      const [nextEmployees, nextDepartments, nextTypes] = await Promise.all([
        getEmployees(),
        getDepartments(),
        getRequestTypes(),
      ]);
      if (currentSessionGeneration() !== started) {
        return;
      }
      setEmployees(nextEmployees);
      setDepartments(nextDepartments);
      setRequestTypes(nextTypes);
      const nextDepartmentId = nextDepartments[0] ? String(nextDepartments[0].id) : '';
      setDepartmentId(nextDepartmentId);
      setRequestTypeId(firstRequestTypeId(nextTypes, nextDepartmentId));
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

  const workspace = user ? (
    <RequestWorkspace
      user={user}
      employees={employees}
      departments={departments}
      requestTypes={requestTypes}
      departmentId={departmentId}
      setDepartmentId={setDepartmentId}
      requestTypeId={requestTypeId}
      setRequestTypeId={setRequestTypeId}
      title={title}
      setTitle={setTitle}
      description={description}
      setDescription={setDescription}
      ownerId={ownerId}
      setOwnerId={setOwnerId}
      loadId={loadId}
      setLoadId={setLoadId}
      request={request}
      history={history}
      busy={busy}
      intakeText={intakeText}
      setIntakeText={setIntakeText}
      intakeResult={intakeResult}
      intakeStep={intakeStep}
      canSubmitRequest={canSubmitRequest}
      onCreate={onCreate}
      onLoad={onLoad}
      onAssignOwner={onAssignOwner}
      onTransition={onTransition}
      onAnalyze={onAnalyze}
      onProblemSolved={onProblemSolved}
      onPrepareRequest={onPrepareRequest}
      resetIntake={resetIntake}
      showLoadForm={user.role !== 'SUPER_ADMIN'}
      showDetails={user.role !== 'SUPER_ADMIN'}
    />
  ) : null;

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

  if (user.role === 'SUPER_ADMIN') {
    const adminView = view === 'home' ? 'dashboard' : view;
    return (
      <AdminShell user={user} view={adminView} busy={busy} onNavigate={goTo} onLogout={onLogout}>
        {error ? (
          <div className="alert" role="alert">
            {error}
          </div>
        ) : null}
        {adminView === 'dashboard' ? (
          <DashboardPage onNavigate={goTo} onUnauthorized={clearAccountWorkspace} />
        ) : null}
        {adminView === 'employees' ? (
          <EmployeesPage busy={busy} run={run} onUnauthorized={clearAccountWorkspace} />
        ) : null}
        {adminView === 'departments' ? (
          <DepartmentsPage busy={busy} run={run} onUnauthorized={clearAccountWorkspace} />
        ) : null}
        {adminView === 'requests' ? (
          <AdminRequestsPage
            createdRequestId={request?.id ?? null}
            compose={workspace}
            onUnauthorized={clearAccountWorkspace}
            urlSearch={urlSearch}
          />
        ) : null}
        {adminView === 'approvals' ? (
          <ComingLaterPage
            title="Approvals"
            detail="The approval inbox is not implemented. This page does not list pending approvals."
          />
        ) : null}
        {adminView === 'settings' ? (
          <ComingLaterPage
            title="Settings"
            detail="Company details are not implemented. Request types and their approval policies are managed on the Departments page. This page has no working controls."
          />
        ) : null}
      </AdminShell>
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

      {workspace}
    </div>
  );
}
