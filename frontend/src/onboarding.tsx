import { FormEvent, useState } from 'react';
import { PasswordField } from './password-field';
import { canSubmitNewPassword, confirmPasswordError, shortPasswordError } from './password-rules';
import { ApiError, Department, inviteStaff, StaleSessionResult } from './api';
import { storedCanHandle } from './roles';

export { WorkspaceWizard as SignupForm } from './workspace-wizard';

export function CheckEmail({ email, onBack }: { email: string; onBack: () => void }) {
  return (
    <section className="card">
      <h2>Check your email</h2>
      <p className="muted">
        A verification link was sent to {email}. The workspace and your Super Admin account stay
        inactive until you open that link.
      </p>
      <button className="btn-secondary" type="button" onClick={onBack}>
        Back to log in
      </button>
    </section>
  );
}

export function VerifyEmailForm({
  token,
  busy,
  onVerify,
}: {
  token: string;
  busy: boolean;
  onVerify: (token: string) => void;
}) {
  return (
    <section className="card">
      <h2>Verify email</h2>
      <p className="muted">Confirm this address to activate the company workspace.</p>
      <button className="btn-primary" type="button" disabled={busy} onClick={() => void onVerify(token)}>
        Verify email
      </button>
    </section>
  );
}

export function AcceptInviteForm({
  token,
  busy,
  onAccept,
}: {
  token: string;
  busy: boolean;
  onAccept: (token: string, password: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  function onForm(event: FormEvent) {
    event.preventDefault();
    if (!canSubmitNewPassword(password, confirmPassword)) return;
    void onAccept(token, password);
  }

  return (
    <section className="card">
      <h2>Set your password</h2>
      <p className="muted">Use the invitation from your company Super Admin. This page does not create a new company.</p>
      <form className="stack" noValidate onSubmit={onForm}>
        <PasswordField
          label="New password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          error={shortPasswordError(password)}
        />
        <PasswordField
          label="Confirm password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          autoComplete="new-password"
          error={confirmPasswordError(password, confirmPassword)}
        />
        <button className="btn-primary" type="submit" disabled={busy || !canSubmitNewPassword(password, confirmPassword)}>
          Activate account
        </button>
      </form>
    </section>
  );
}

export function ForgotPasswordForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (email: string) => void;
}) {
  const [email, setEmail] = useState('');

  function onForm(event: FormEvent) {
    event.preventDefault();
    void onSubmit(email);
  }

  return (
    <section className="card auth-card">
      <h2>Forgot password</h2>
      <p className="muted">
        Enter the email for your account. If it can be reset, the link arrives there.
      </p>
      <form className="stack" onSubmit={onForm}>
        <label>
          Email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required />
        </label>
        <button className="btn-primary" type="submit" disabled={busy}>
          Send reset link
        </button>
      </form>
    </section>
  );
}

export function ResetPasswordForm({
  token,
  busy,
  onReset,
}: {
  token: string;
  busy: boolean;
  onReset: (token: string, password: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  function onForm(event: FormEvent) {
    event.preventDefault();
    if (!canSubmitNewPassword(password, confirmPassword)) return;
    void onReset(token, password);
  }

  return (
    <section className="card auth-card">
      <h2>Choose a new password</h2>
      <p className="muted">This link works once. After it is used, sign in with the new password.</p>
      <form className="stack" noValidate onSubmit={onForm}>
        <PasswordField
          label="New password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          error={shortPasswordError(password)}
        />
        <PasswordField
          label="Confirm password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          autoComplete="new-password"
          error={confirmPasswordError(password, confirmPassword)}
        />
        <button className="btn-primary" type="submit" disabled={busy || !canSubmitNewPassword(password, confirmPassword)}>
          Update password
        </button>
      </form>
    </section>
  );
}


export function InviteStaffForm({
  departments,
  busy,
  run,
  onInvited,
}: {
  departments: Department[];
  busy: boolean;
  run: (action: () => Promise<void>) => void;
  onInvited: () => Promise<void>;
}) {
  const [staffName, setStaffName] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [role, setRole] = useState<'EMPLOYEE' | 'DEPARTMENT_ADMIN' | 'SUPER_ADMIN'>('EMPLOYEE');
  const [canHandle, setCanHandle] = useState(false);
  const [notice, setNotice] = useState('');
  const [formError, setFormError] = useState('');

  function onInvite(event: FormEvent) {
    event.preventDefault();
    if (departmentId === '') return;
    run(async () => {
      setNotice('');
      setFormError('');
      try {
        await inviteStaff({
          email: staffEmail,
          name: staffName,
          departmentId: Number(departmentId),
          role,
          canHandle: storedCanHandle(role, canHandle),
        });
        setStaffName('');
        setStaffEmail('');
        setCanHandle(false);
        setNotice('Invitation sent. They set their own password.');
        await onInvited();
      } catch (error) {
        setFormError(error instanceof Error ? error.message : 'Could not send the invitation');
        if (error instanceof StaleSessionResult || (error instanceof ApiError && error.status === 401)) {
          throw error;
        }
      }
    });
  }

  return (
    <section className="card">
      <h2>Invite staff</h2>
      <p className="muted">
        Invite people into this company. Handler eligibility is separate from role. Super Admin
        accounts cannot handle, own, or claim requests.
      </p>
      {notice ? <p className="muted">{notice}</p> : null}
      {formError ? (
        <div className="alert" role="alert">
          {formError}
        </div>
      ) : null}
      <form className="stack" onSubmit={onInvite}>
        <label>
          Staff name
          <input value={staffName} onChange={(event) => setStaffName(event.target.value)} required maxLength={200} />
        </label>
        <label>
          Staff email
          <input type="email" value={staffEmail} onChange={(event) => setStaffEmail(event.target.value)} required />
        </label>
        <label>
          Staff department
          <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} required>
            <option value="">Select a department</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Staff role
          <select
            value={role}
            onChange={(event) => {
              const next = event.target.value as typeof role;
              setRole(next);
              setCanHandle(next === 'EMPLOYEE' ? (role === 'EMPLOYEE' ? canHandle : false) : storedCanHandle(next, canHandle));
            }}
          >
            <option value="EMPLOYEE">Employee</option>
            <option value="DEPARTMENT_ADMIN">Department Admin</option>
            <option value="SUPER_ADMIN">Super Admin</option>
          </select>
        </label>
        {role === 'EMPLOYEE' ? (
          <label>
            Handler access
            <select value={canHandle ? 'true' : 'false'} onChange={(event) => setCanHandle(event.target.value === 'true')}>
              <option value="false">Employee — Cannot handle requests</option>
              <option value="true">Handler — Can handle requests</option>
            </select>
          </label>
        ) : null}
        <button className="btn-primary" type="submit" disabled={busy || departmentId === ''}>
          Send invitation
        </button>
      </form>
    </section>
  );
}
