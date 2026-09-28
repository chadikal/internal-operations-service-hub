import { FormEvent, useEffect, useState } from 'react';
import {
  analyzeIntake,
  ApiError,
  claimRequest,
  createRequest,
  Department,
  getDepartments,
  getHistory,
  getMe,
  getRequest,
  getRequestTypes,
  hasActionableIntakeDraft,
  HistoryRecord,
  IntakeResult,
  login,
  logout,
  requestPasswordReset,
  resetPassword,
  RequestType,
  ServiceRequest,
  SessionUser,
  StaleSessionResult,
  beginClientSession,
  endClientSession,
  currentSessionGeneration,
  signupCompany,
  inviteStaff,
  transition,
  verifyEmail,
  acceptInvitation,
} from './api';
import { PendingInvite, savePendingInvites, takePendingInvites } from './pending-invites';
import {
  AdminShell,
  DashboardPage,
  DepartmentsPage,
  EmployeesPage,
  workspaceRoleLabel,
} from './admin';
import { canActAsHandler, storedCanHandle } from './roles';
import { AccountSettings } from './account-settings';
import { AdminRequestsPage } from './admin-requests';
import { ApprovalInbox } from './approvals';
import {
  AcceptInviteForm,
  CheckEmail,
  ForgotPasswordForm,
  ResetPasswordForm,
  SignupForm,
  VerifyEmailForm,
} from './onboarding';
import { PasswordField } from './password-field';
import { FormOverlay } from './form-overlay';
import { chooseIntakeStep, hasMissingRequiredInformation, IntakeStep, RequestWorkspace } from './request-workspace';
import { AdminView, adminPath, isAdminPath, parseAdminView, parseStaffView, staffPath, StaffView } from './routing';
import { DepartmentEmployeesPage, MyRequestsPage, StaffDashboard, StaffRequestList } from './staff';

function formFromLocation(): 'create' | 'intake' | null {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/requests/new') return 'create';
  if (path === '/requests/intake') return 'intake';
  const value = new URLSearchParams(window.location.search).get('form');
  if (value === 'create' || value === 'intake') return value;
  return null;
}

function rewriteLegacyComposePath() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/requests/new') {
    window.history.replaceState({}, '', '/my-requests?form=create');
  } else if (path === '/requests/intake') {
    window.history.replaceState({}, '', '/my-requests?form=intake');
  }
}

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
  if (role !== 'SUPER_ADMIN') {
    return;
  }
  const next = view !== 'home' ? adminPath(view) : '/';
  if (window.location.pathname !== next) {
    window.history.replaceState({}, '', next);
  }
}

export default function App() {
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
  const [request, setRequest] = useState<ServiceRequest | null>(null);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [intakeText, setIntakeText] = useState('');
  const [intakeResult, setIntakeResult] = useState<IntakeResult | null>(null);
  const [intakeStep, setIntakeStep] = useState<IntakeStep>('input');
  const [gate, setGate] = useState<'login' | 'signup' | 'check-email' | 'forgot' | 'reset-sent'>('login');
  const [pendingEmail, setPendingEmail] = useState('');
  const [notice, setNotice] = useState('');
  const [verifyToken, setVerifyToken] = useState(() => new URLSearchParams(window.location.search).get('verify'));
  const [inviteToken, setInviteToken] = useState(() => new URLSearchParams(window.location.search).get('invite'));
  const [resetToken, setResetToken] = useState(() => new URLSearchParams(window.location.search).get('reset'));
  const [view, setView] = useState<AdminView | 'home'>(() => viewFromLocation(undefined));
  const [staffView, setStaffView] = useState<StaffView>(() => parseStaffView(window.location.pathname));
  const [urlSearch, setUrlSearch] = useState(() => window.location.search);
  const [formMode, setFormMode] = useState<'create' | 'intake' | null>(() => formFromLocation());

  const canSubmitRequest = user !== null && departmentId !== '' && requestTypeId !== '';

  function resetWorkspaceData() {
    setDepartments([]);
    setRequestTypes([]);
    setDepartmentId('');
    setRequestTypeId('');
    setTitle('');
    setDescription('');
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
    setFormMode(null);
    syncUrl(undefined, 'home');
  }

  async function sendPreparedInvites(session: SessionUser) {
    if (session.role !== 'SUPER_ADMIN' || !session.email) return;
    const email = session.email;
    const pending = takePendingInvites(email);
    if (pending.length === 0) return;
    try {
      const departments = await getDepartments();
      const failed: PendingInvite[] = [];
      for (const invite of pending) {
        const department = departments.find(
          (item) => item.name.toLowerCase() === invite.departmentName.toLowerCase(),
        );
        if (!department) {
          failed.push(invite);
          continue;
        }
        try {
          await inviteStaff({
            name: invite.name,
            email: invite.email,
            departmentId: department.id,
            role: invite.role,
            canHandle: storedCanHandle(invite.role, invite.canHandle),
          });
        } catch (error) {
          if (error instanceof StaleSessionResult || (error instanceof ApiError && error.status === 401)) {
            failed.push(invite);
            break;
          }
          failed.push(invite);
        }
      }
      if (failed.length > 0) savePendingInvites(email, failed);
    } catch {
      savePendingInvites(email, pending);
    }
  }

  function applySession(session: SessionUser, options?: { dashboard?: boolean }) {
    beginClientSession(session);
    resetWorkspaceData();
    setUser(session);
    void sendPreparedInvites(session);
    if (options?.dashboard) {
      setFormMode(null);
      setUrlSearch('');
      if (session.role === 'SUPER_ADMIN') {
        setView('dashboard');
        setStaffView('dashboard');
        window.history.replaceState({}, '', adminPath('dashboard'));
      } else {
        setView('home');
        setStaffView('dashboard');
        window.history.replaceState({}, '', '/');
      }
      return currentSessionGeneration();
    }
    const nextView = viewFromLocation(session.role);
    setView(nextView);
    if (session.role !== 'SUPER_ADMIN') {
      if (!isAdminPath(window.location.pathname)) {
        rewriteLegacyComposePath();
      }
      const nextStaff = isAdminPath(window.location.pathname) ? 'dashboard' : parseStaffView(window.location.pathname);
      setStaffView(nextStaff);
      const path = staffPath(nextStaff);
      if (window.location.pathname !== path) {
        window.history.replaceState({}, '', path);
      }
    }
    setFormMode(formFromLocation());
    syncUrl(session.role, nextView);
    return currentSessionGeneration();
  }

  function goTo(next: AdminView, query?: Record<string, string>) {
    const keepsForm = next === 'my-requests' && (query?.form === 'create' || query?.form === 'intake');
    if (!keepsForm) setFormMode(null);
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
      setStaffView(parseStaffView(window.location.pathname));
      setUrlSearch(window.location.search);
      setFormMode(formFromLocation());
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
      setStaffView('dashboard');
      window.history.replaceState({}, '', '/');
    }
  }, [user, view]);

  useEffect(() => {
    if (!user || (view !== 'requests' && formMode === null)) {
      return;
    }
    const generation = currentSessionGeneration();
    void Promise.all([getDepartments(), getRequestTypes()]).then(
      ([nextDepartments, nextTypes]) => {
        if (currentSessionGeneration() !== generation) {
          return;
        }
        setDepartments(nextDepartments);
        setRequestTypes(nextTypes);
        setDepartmentId((current) => {
          const nextDepartmentId =
            current && nextDepartments.some((department) => String(department.id) === current)
              ? current
              : nextDepartments[0]
                ? String(nextDepartments[0].id)
                : '';
          setRequestTypeId((typeId) => {
            if (
              typeId &&
              nextTypes.some(
                (item) => String(item.id) === typeId && String(item.departmentId) === nextDepartmentId,
              )
            ) {
              return typeId;
            }
            return firstRequestTypeId(nextTypes, nextDepartmentId);
          });
          return nextDepartmentId;
        });
      },
    );
  }, [user, view, formMode]);

  useEffect(() => {
    const generation = currentSessionGeneration();
    getMe()
      .then(async (session) => {
        if (currentSessionGeneration() !== generation) {
          return;
        }
        const started = applySession(session);
        const [nextDepartments, nextTypes] = await Promise.all([
          getDepartments(),
          getRequestTypes(),
        ]);
        if (currentSessionGeneration() !== started) {
          return;
        }
        setDepartments(nextDepartments);
        setRequestTypes(nextTypes);
        const nextDepartmentId = nextDepartments[0] ? String(nextDepartments[0].id) : '';
        setDepartmentId(nextDepartmentId);
        setRequestTypeId(firstRequestTypeId(nextTypes, nextDepartmentId));
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
    setRequestTypeId(matchesDepartment ? suggestedType : '');
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

  function onClaim() {
    if (!request || !user || !canActAsHandler(user.role, user.canHandle)) return;
    void run(async () => {
      await claimRequest(request.id);
      await refresh(request.id);
    });
  }

  function onTransition(to: 'IN_PROGRESS' | 'COMPLETED') {
    if (!request || !user || !canActAsHandler(user.role, user.canHandle) || request.currentOwnerId !== user.id) return;
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
      const started = applySession(session, { dashboard: true });
      const [nextDepartments, nextTypes] = await Promise.all([getDepartments(), getRequestTypes()]);
      if (currentSessionGeneration() !== started) {
        return;
      }
      setDepartments(nextDepartments);
      setRequestTypes(nextTypes);
      const nextDepartmentId = nextDepartments[0] ? String(nextDepartments[0].id) : '';
      setDepartmentId(nextDepartmentId);
      setRequestTypeId(firstRequestTypeId(nextTypes, nextDepartmentId));
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
    setResetToken(null);
  }

  const workspace = user ? (
    <RequestWorkspace
      user={user}
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
      request={request}
      history={history}
      busy={busy}
      intakeText={intakeText}
      setIntakeText={setIntakeText}
      intakeResult={intakeResult}
      intakeStep={intakeStep}
      canSubmitRequest={canSubmitRequest}
      onCreate={onCreate}
      onClaim={onClaim}
      onTransition={onTransition}
      onAnalyze={onAnalyze}
      onProblemSolved={onProblemSolved}
      onPrepareRequest={onPrepareRequest}
      resetIntake={resetIntake}
      showDetails={user.role !== 'SUPER_ADMIN'}
      focus={formMode === 'intake' ? 'intake' : 'create'}
    />
  ) : null;

  const formOverlay =
    formMode !== null ? (
      <FormOverlay
        title={formMode === 'intake' ? 'AI Intake' : 'New Request'}
        returnFocusId={formMode === 'intake' ? 'launch-ai-intake' : 'launch-new-request'}
        onClose={closeForm}
      >
        {workspace}
      </FormOverlay>
    ) : null;

  function openForm(mode: 'create' | 'intake') {
    setFormMode(mode);
    if (user?.role === 'SUPER_ADMIN') {
      goTo('my-requests', { form: mode });
      return;
    }
    setStaffView('my-requests');
    const path = `/my-requests?form=${mode}`;
    if (`${window.location.pathname}${window.location.search}` !== path) {
      window.history.pushState({}, '', path);
    }
    setUrlSearch(`?form=${mode}`);
  }

  function closeForm() {
    setFormMode(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('form');
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
    setUrlSearch(url.search);
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
      <div className="page auth-page">
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

  if (resetToken) {
    return (
      <div className="page auth-page">
        <header className="header">
          <h1>Internal Operations Service Hub</h1>
          <p>Choose a new password</p>
        </header>
        {error ? (
          <div className="alert" role="alert">
            {error}
          </div>
        ) : null}
        <ResetPasswordForm
          token={resetToken}
          busy={busy}
          onReset={(token, nextPassword) =>
            run(async () => {
              await resetPassword(token, nextPassword);
              endClientSession();
              setUser(null);
              clearAuthQuery();
              setPassword('');
              setGate('login');
              setNotice('Password updated. Log in with the new password.');
              setError('');
            })
          }
        />
      </div>
    );
  }

  if (inviteToken) {
    return (
      <div className="page auth-page">
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
      <div className="page auth-page">
        <header className="header">
          <h1>Internal Operations Service Hub</h1>
          <p>Sign in to create and track internal department requests</p>
        </header>
        {error ? (
          <div className="alert" role="alert">
            {error}
          </div>
        ) : null}
        {notice && gate === 'login' ? (
          <p className="notice" role="status">
            {notice}
          </p>
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
              onLeave={() => {
                setGate('login');
                setError('');
              }}
              onSubmit={(input) =>
                run(async () => {
                  const result = await signupCompany(
                    input.companyName,
                    input.name,
                    input.email,
                    input.password,
                    input.departments,
                  );
                  savePendingInvites(result.email, input.invitations);
                  setPendingEmail(result.email);
                  setGate('check-email');
                })
              }
            />
          </>
        ) : null}
        {gate === 'forgot' ? (
          <>
            <ForgotPasswordForm
              busy={busy}
              onSubmit={(nextEmail) =>
                run(async () => {
                  const result = await requestPasswordReset(nextEmail);
                  setNotice(result.message);
                  setGate('reset-sent');
                  setError('');
                })
              }
            />
            <button
              className="link-button"
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
        {gate === 'reset-sent' ? (
          <section className="card auth-card">
            <h2>Check your email</h2>
            <p className="muted">{notice}</p>
            <button
              className="btn-secondary"
              type="button"
              onClick={() => {
                setGate('login');
                setNotice('');
                setError('');
              }}
            >
              Back to log in
            </button>
          </section>
        ) : null}
        {gate === 'login' ? (
          <section className="card auth-card">
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
              <PasswordField
                label="Password"
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
              />
              <button
                className="link-button"
                type="button"
                onClick={() => {
                  setGate('forgot');
                  setError('');
                  setNotice('');
                }}
              >
                Forgot password?
              </button>
              <button className="btn-primary" type="submit" disabled={busy}>
                Log in
              </button>
            </form>
            <hr className="auth-divider" />
            <p className="auth-aside">
              New workspace?{' '}
              <button
                className="link-button"
                type="button"
                onClick={() => {
                  setGate('signup');
                  setError('');
                  setNotice('');
                }}
              >
                Create one
              </button>
            </p>
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
          <DashboardPage
            onNavigate={goTo}
            onUnauthorized={clearAccountWorkspace}
            onOpenCompose={openForm}
          />
        ) : null}
        {adminView === 'employees' ? (
          <EmployeesPage user={user} busy={busy} run={run} onUnauthorized={clearAccountWorkspace} />
        ) : null}
        {adminView === 'departments' ? (
          <DepartmentsPage busy={busy} run={run} onUnauthorized={clearAccountWorkspace} />
        ) : null}
        {adminView === 'requests' ? (
          <AdminRequestsPage
            createdRequestId={request?.id ?? null}
            onUnauthorized={clearAccountWorkspace}
            urlSearch={urlSearch}
          />
        ) : null}
        {adminView === 'my-requests' ? (
          <>
            <MyRequestsPage
              listVersion={request?.id ?? 0}
              onUnauthorized={clearAccountWorkspace}
              onCreate={() => openForm('create')}
              onIntake={() => openForm('intake')}
            />
            {formOverlay}
          </>
        ) : null}
        {adminView === 'approvals' ? <ApprovalInbox urlSearch={urlSearch} /> : null}
        {adminView === 'settings' ? (
          <AccountSettings
            user={user}
            onUnauthorized={clearAccountWorkspace}
            onUpdated={(patch) => setUser((current) => (current ? { ...current, ...patch } : current))}
          />
        ) : null}
      </AdminShell>
    );
  }

  return (
    <AdminShell
      user={user}
      view="dashboard"
      busy={busy}
      onNavigate={goTo}
      onLogout={onLogout}
      navigation={{
        label: workspaceRoleLabel(user.role, user.canHandle),
        links: staffLinks(user, staffView, (next) => {
          setStaffView(next);
          setFormMode(null);
          const path = staffPath(next);
          if (`${window.location.pathname}${window.location.search}` !== path) {
            window.history.pushState({}, '', path);
          }
          setUrlSearch(window.location.search);
        }),
      }}
    >
      {error ? (
        <div className="alert" role="alert">
          {error}
        </div>
      ) : null}
      {staffView === 'dashboard' ? (
        <StaffDashboard
          user={user}
          onUnauthorized={clearAccountWorkspace}
          onCreate={() => openForm('create')}
          onIntake={() => openForm('intake')}
          onOpen={(next, query) => {
            setStaffView(next);
            setFormMode(null);
            const params = new URLSearchParams();
            for (const [key, value] of Object.entries(query ?? {})) {
              if (value) params.set(key, value);
            }
            const qs = params.toString();
            const path = `${staffPath(next)}${qs ? `?${qs}` : ''}`;
            if (`${window.location.pathname}${window.location.search}` !== path) {
              window.history.pushState({}, '', path);
            }
            setUrlSearch(window.location.search);
          }}
        />
      ) : null}
      {staffView === 'requests' && canActAsHandler(user.role, user.canHandle) ? (
        <StaffRequestList user={user} onUnauthorized={clearAccountWorkspace} />
      ) : null}
      {staffView === 'my-requests' ? (
        <>
          <MyRequestsPage
            listVersion={request?.id ?? 0}
            onUnauthorized={clearAccountWorkspace}
            onCreate={() => openForm('create')}
            onIntake={() => openForm('intake')}
          />
          {formOverlay}
        </>
      ) : null}
      {staffView === 'employees' && user.role === 'DEPARTMENT_ADMIN' ? (
        <DepartmentEmployeesPage user={user} onUnauthorized={clearAccountWorkspace} />
      ) : null}
      {staffView === 'approvals' && user.role === 'DEPARTMENT_ADMIN' ? (
        <ApprovalInbox urlSearch={urlSearch} />
      ) : null}
      {staffView === 'settings' ? (
        <AccountSettings
          user={user}
          onUnauthorized={clearAccountWorkspace}
          onUpdated={(patch) => setUser((current) => (current ? { ...current, ...patch } : current))}
        />
      ) : null}
    </AdminShell>
  );
}

function staffLinks(
  user: SessionUser,
  current: StaffView,
  onSelect: (view: StaffView) => void,
) {
  const links: {
    key: string;
    label: string;
    current: boolean;
    onSelect: () => void;
  }[] = [
    {
      key: 'dashboard',
      label: 'Dashboard',
      current: current === 'dashboard',
      onSelect: () => onSelect('dashboard'),
    },
  ];
  if (canActAsHandler(user.role, user.canHandle)) {
    links.push({
      key: 'requests',
      label: 'Requests',
      current: current === 'requests',
      onSelect: () => onSelect('requests'),
    });
  }
  links.push({
    key: 'my-requests',
    label: 'My Requests',
    current: current === 'my-requests',
    onSelect: () => onSelect('my-requests'),
  });
  if (user.role === 'DEPARTMENT_ADMIN') {
    links.push({
      key: 'approvals',
      label: 'Approvals',
      current: current === 'approvals',
      onSelect: () => onSelect('approvals'),
    });
    links.push({
      key: 'employees',
      label: 'Staff',
      current: current === 'employees',
      onSelect: () => onSelect('employees'),
    });
  }
  links.push({
    key: 'settings',
    label: 'Settings',
    current: current === 'settings',
    onSelect: () => onSelect('settings'),
  });
  return links;
}
