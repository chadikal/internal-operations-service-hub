import { FormEvent, useState } from 'react';
import { createDepartment, Department, inviteStaff } from './api';

export function SignupForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (input: { companyName: string; name: string; email: string; password: string }) => void;
}) {
  const [companyName, setCompanyName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  function onForm(event: FormEvent) {
    event.preventDefault();
    void onSubmit({ companyName, name, email, password });
  }

  return (
    <section className="card">
      <h2>Create a company workspace</h2>
      <p className="muted">
        This creates your company and your Super Admin account. You will verify your email before
        the workspace is active. Staff join only when you invite them.
      </p>
      <form className="stack" onSubmit={onForm}>
        <label>
          Company name
          <input value={companyName} onChange={(event) => setCompanyName(event.target.value)} required maxLength={200} />
        </label>
        <label>
          Your name
          <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={200} />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            minLength={12}
            required
          />
        </label>
        <button className="btn-primary" type="submit" disabled={busy}>
          Create workspace
        </button>
      </form>
    </section>
  );
}

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

  function onForm(event: FormEvent) {
    event.preventDefault();
    void onAccept(token, password);
  }

  return (
    <section className="card">
      <h2>Set your password</h2>
      <p className="muted">Use the invitation from your company Super Admin. This page does not create a new company.</p>
      <form className="stack" onSubmit={onForm}>
        <label>
          New password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            minLength={12}
            required
          />
        </label>
        <button className="btn-primary" type="submit" disabled={busy}>
          Activate account
        </button>
      </form>
    </section>
  );
}

export function CompanyTools({
  departments,
  busy,
  run,
  onChanged,
}: {
  departments: Department[];
  busy: boolean;
  run: (action: () => Promise<void>) => void;
  onChanged: () => Promise<void>;
}) {
  const [departmentName, setDepartmentName] = useState('');
  const [staffName, setStaffName] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [role, setRole] = useState<'EMPLOYEE' | 'DEPARTMENT_ADMIN' | 'SUPER_ADMIN'>('EMPLOYEE');
  const [canHandle, setCanHandle] = useState(false);
  const [notice, setNotice] = useState('');

  function onDepartment(event: FormEvent) {
    event.preventDefault();
    run(async () => {
      setNotice('');
      await createDepartment(departmentName);
      setDepartmentName('');
      setNotice('Department added.');
      await onChanged();
    });
  }

  function onInvite(event: FormEvent) {
    event.preventDefault();
    if (departmentId === '') return;
    run(async () => {
      setNotice('');
      await inviteStaff({
        email: staffEmail,
        name: staffName,
        departmentId: Number(departmentId),
        role,
        canHandle,
      });
      setStaffName('');
      setStaffEmail('');
      setCanHandle(false);
      setNotice('Invitation sent. They set their own password.');
      await onChanged();
    });
  }

  return (
    <section className="card">
      <h2>Company workspace</h2>
      <p className="muted">Add a department, then invite staff into this company. They choose their own password.</p>
      {notice ? <p className="muted">{notice}</p> : null}
      <form className="stack" onSubmit={onDepartment}>
        <label>
          Department name
          <input value={departmentName} onChange={(event) => setDepartmentName(event.target.value)} required maxLength={200} />
        </label>
        <button className="btn-secondary" type="submit" disabled={busy}>
          Add department
        </button>
      </form>
      <form className="stack" onSubmit={onInvite}>
        <h3>Invite staff</h3>
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
          Role
          <select value={role} onChange={(event) => setRole(event.target.value as typeof role)}>
            <option value="EMPLOYEE">Employee</option>
            <option value="DEPARTMENT_ADMIN">Department Admin</option>
            <option value="SUPER_ADMIN">Super Admin</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={canHandle} onChange={(event) => setCanHandle(event.target.checked)} /> Can
          handle requests
        </label>
        <button className="btn-primary" type="submit" disabled={busy || departmentId === ''}>
          Send invitation
        </button>
      </form>
    </section>
  );
}
