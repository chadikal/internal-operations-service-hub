import { FormEvent, useEffect, useState } from 'react';
import {
  ApiError,
  createDepartment,
  Department,
  DepartmentTemplate,
  DepartmentTemplateId,
  inviteStaff,
  StaleSessionResult,
} from './api';
import {
  confirmedSuggestions,
  draftsFromTemplate,
  DraftSuggestion,
  TemplatePicker,
  TemplateSuggestionEditor,
} from './department-templates';

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
        This creates your company and your Super Admin account. The workspace starts with IT, HR,
        and Finance, which you can rename or delete. You will verify your email before the
        workspace is active. Staff join only when you invite them.
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

export function AddDepartmentForm({
  busy,
  run,
  templates,
  onAdded,
}: {
  busy: boolean;
  run: (action: () => Promise<void>) => void;
  templates: DepartmentTemplate[];
  onAdded: () => Promise<void>;
}) {
  const defaultTemplate = templates.find((item) => item.id === 'CUSTOM_EMPTY') ?? templates[0];
  const [departmentName, setDepartmentName] = useState('');
  const [templateId, setTemplateId] = useState(defaultTemplate?.id ?? 'CUSTOM_EMPTY');
  const [drafts, setDrafts] = useState<DraftSuggestion[]>(() => draftsFromTemplate(defaultTemplate));
  const [notice, setNotice] = useState('');
  const [formError, setFormError] = useState('');
  const selected = templates.find((item) => item.id === templateId);

  useEffect(() => {
    if (templates.length === 0) {
      return;
    }
    if (templates.some((item) => item.id === templateId)) {
      return;
    }
    const next = templates.find((item) => item.id === 'CUSTOM_EMPTY') ?? templates[0];
    if (next) {
      setTemplateId(next.id);
      setDrafts(draftsFromTemplate(next));
    }
  }, [templates, templateId]);

  function onDepartment(event: FormEvent) {
    event.preventDefault();
    run(async () => {
      setNotice('');
      setFormError('');
      try {
        await createDepartment(departmentName, {
          templateId: templateId as DepartmentTemplateId,
          requestTypes: confirmedSuggestions(drafts),
        });
        setDepartmentName('');
        const empty = templates.find((item) => item.id === 'CUSTOM_EMPTY') ?? templates[0];
        if (empty) {
          setTemplateId(empty.id);
          setDrafts(draftsFromTemplate(empty));
        } else {
          setDrafts([]);
        }
        setNotice('Department added.');
        await onAdded();
      } catch (error) {
        setFormError(error instanceof Error ? error.message : 'Could not add the department');
        if (error instanceof StaleSessionResult || (error instanceof ApiError && error.status === 401)) {
          throw error;
        }
      }
    });
  }

  return (
    <section className="card">
      <h2>Add department</h2>
      <p className="muted">
        New departments belong to this company only. Choose an optional template, review any
        suggested types, and keep the department name independent of that template.
      </p>
      {notice ? <p className="muted">{notice}</p> : null}
      {formError ? (
        <div className="alert" role="alert">
          {formError}
        </div>
      ) : null}
      <form className="stack" onSubmit={onDepartment}>
        <label>
          Department name
          <input
            value={departmentName}
            onChange={(event) => setDepartmentName(event.target.value)}
            required
            maxLength={200}
          />
        </label>
        <TemplatePicker
          label="Department template"
          templates={templates}
          value={templateId}
          onChange={(nextId) => {
            setTemplateId(nextId as DepartmentTemplateId);
            setDrafts(draftsFromTemplate(templates.find((item) => item.id === nextId)));
          }}
        />
        {selected?.unspecifiedNotice ? (
          <p className="muted" role="status">
            {selected.unspecifiedNotice}
          </p>
        ) : null}
        {selected?.id === 'CUSTOM_EMPTY' ? (
          <p className="muted">Custom/Empty suggests no request types.</p>
        ) : null}
        <TemplateSuggestionEditor drafts={drafts} scope="new department" onChange={setDrafts} />
        <button className="btn-secondary" type="submit" disabled={busy}>
          Add department
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
          canHandle: role === 'SUPER_ADMIN' ? false : canHandle,
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
              if (next === 'SUPER_ADMIN') {
                setCanHandle(false);
              }
            }}
          >
            <option value="EMPLOYEE">Employee</option>
            <option value="DEPARTMENT_ADMIN">Department Admin</option>
            <option value="SUPER_ADMIN">Super Admin</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={role === 'SUPER_ADMIN' ? false : canHandle}
            onChange={(event) => setCanHandle(event.target.checked)}
            disabled={role === 'SUPER_ADMIN'}
          />{' '}
          Can handle requests
        </label>
        <button className="btn-primary" type="submit" disabled={busy || departmentId === ''}>
          Send invitation
        </button>
      </form>
    </section>
  );
}
