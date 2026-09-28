import { FormEvent, useState } from 'react';
import {
  DEPARTMENT_TEMPLATE_CATALOG,
  CatalogTemplate,
  TemplatePolicy,
} from '../../src/auth/department-template-catalog.ts';
import { PasswordField } from './password-field';
import { storedCanHandle } from './roles';
import { PendingInvite } from './pending-invites';

export type SignupDepartment = {
  name: string;
  requestTypes: { name: string; approvalPolicy: TemplatePolicy }[];
};

type DraftType = { key: string; name: string; approvalPolicy: TemplatePolicy };
type DraftDepartment = { key: string; name: string; requestTypes: DraftType[] };
type DraftInvite = PendingInvite & { key: string; departmentKey: string };
type StaffRole = PendingInvite['role'];

let draftKey = 0;
function nextKey() {
  draftKey += 1;
  return `setup-${draftKey}`;
}

function typesFromTemplate(template: CatalogTemplate): DraftType[] {
  return template.suggestions.map((item) => ({
    key: nextKey(),
    name: item.name,
    approvalPolicy: item.approvalPolicy,
  }));
}

function defaultDepartments(): DraftDepartment[] {
  return DEPARTMENT_TEMPLATE_CATALOG.filter((item) => item.id === 'IT' || item.id === 'HR' || item.id === 'FINANCE').map(
    (template) => ({
      key: nextKey(),
      name: template.name,
      requestTypes: typesFromTemplate(template),
    }),
  );
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function departmentProblems(departments: DraftDepartment[]) {
  const names = departments.map((department) => department.name.trim());
  if (names.some((name) => name.length === 0)) return 'Each department needs a name.';
  if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) {
    return 'Department names must be unique.';
  }
  for (const department of departments) {
    const typeNames = department.requestTypes.map((item) => item.name.trim());
    if (typeNames.some((name) => name.length === 0)) {
      return `Each request type in ${department.name.trim()} needs a name.`;
    }
    if (new Set(typeNames.map((name) => name.toLowerCase())).size !== typeNames.length) {
      return `Request type names in ${department.name.trim()} must be unique.`;
    }
  }
  return '';
}

const STEPS = [
  { id: 'company', label: 'Company' },
  { id: 'departments', label: 'Departments' },
  { id: 'staff', label: 'Staff' },
] as const;

export function WorkspaceWizard({
  busy,
  onSubmit,
  onLeave,
}: {
  busy: boolean;
  onSubmit: (input: {
    companyName: string;
    name: string;
    email: string;
    password: string;
    departments: SignupDepartment[];
    invitations: PendingInvite[];
  }) => void;
  onLeave: () => void;
}) {
  const [step, setStep] = useState(0);
  const [companyName, setCompanyName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [departments, setDepartments] = useState<DraftDepartment[]>(defaultDepartments);
  const [invitations, setInvitations] = useState<DraftInvite[]>([]);
  const [formError, setFormError] = useState('');

  const companyReady =
    companyName.trim().length > 0 &&
    name.trim().length > 0 &&
    validEmail(email) &&
    password.length >= 12 &&
    password === confirmPassword;
  const departmentError = departmentProblems(departments);
  const inviteError = invitationProblems(invitations, departments);

  function leave() {
    const dirty = companyName !== '' || name !== '' || email !== '' || password !== '' || confirmPassword !== '';
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    onLeave();
  }

  function back() {
    setFormError('');
    if (step === 0) {
      leave();
      return;
    }
    setStep((current) => current - 1);
  }

  function next() {
    if (step === 0 && !companyReady) {
      setFormError(companyMessage());
      return;
    }
    if (step === 1 && departmentError) {
      setFormError(departmentError);
      return;
    }
    setFormError('');
    setStep((current) => current + 1);
  }

  function companyMessage() {
    if (companyName.trim().length === 0) return 'Company name is required.';
    if (name.trim().length === 0) return 'Your name is required.';
    if (!validEmail(email)) return 'A valid email is required.';
    if (password.length < 12) return 'Password must be at least 12 characters.';
    if (password !== confirmPassword) return 'Password and confirm password must match.';
    return '';
  }

  function finish(event: FormEvent) {
    event.preventDefault();
    if (inviteError) {
      setFormError(inviteError);
      return;
    }
    setFormError('');
    onSubmit({
      companyName: companyName.trim(),
      name: name.trim(),
      email: email.trim(),
      password,
      departments: departments.map((department) => ({
        name: department.name.trim(),
        requestTypes: department.requestTypes.map((item) => ({
          name: item.name.trim(),
          approvalPolicy: item.approvalPolicy,
        })),
      })),
      invitations: invitations.map((invite) => ({
        name: invite.name.trim(),
        email: invite.email.trim(),
        departmentName: departments.find((department) => department.key === invite.departmentKey)?.name.trim() ?? '',
        role: invite.role,
        canHandle: storedCanHandle(invite.role, invite.canHandle),
      })),
    });
  }

  return (
    <section className="card auth-card" data-testid="workspace-wizard">
      <div className="wizard-top">
        <button className="icon-button" type="button" aria-label="Back" onClick={back}>
          <ArrowLeftIcon />
        </button>
        <ol className="wizard-dots" aria-label="Setup progress">
          {STEPS.map((item, index) => (
            <li key={item.id} aria-current={index === step ? 'step' : undefined}>
              <span className={index === step ? 'wizard-dot wizard-dot-current' : 'wizard-dot'} />
              <span>{item.label}</span>
            </li>
          ))}
        </ol>
      </div>
      <h2>{step === 0 ? 'Company Information' : step === 1 ? 'Set Up Departments' : 'Invite Staff'}</h2>
      {formError ? (
        <div className="alert" role="alert">
          {formError}
        </div>
      ) : null}
      {step === 0 ? (
        <form className="stack" onSubmit={(event) => event.preventDefault()}>
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
          <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="new-password" minLength={12} />
          <PasswordField
            label="Confirm password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
            minLength={12}
          />
          <div className="wizard-actions">
            <button className="btn-primary" type="button" disabled={!companyReady} onClick={next}>
              Next
            </button>
          </div>
        </form>
      ) : null}
      {step === 1 ? (
        <DepartmentStep
          departments={departments}
          onChange={(nextDepartments) => {
            setDepartments(nextDepartments);
            setInvitations((current) =>
              current.map((invite) =>
                nextDepartments.some((department) => department.key === invite.departmentKey)
                  ? invite
                  : { ...invite, departmentKey: '' },
              ),
            );
          }}
          onNext={next}
        />
      ) : null}
      {step === 2 ? (
        <StaffStep
          departments={departments}
          invitations={invitations}
          busy={busy}
          canFinish={!inviteError}
          onChange={setInvitations}
          onFinish={finish}
        />
      ) : null}
    </section>
  );
}

function DepartmentStep({
  departments,
  onChange,
  onNext,
}: {
  departments: DraftDepartment[];
  onChange: (next: DraftDepartment[]) => void;
  onNext: () => void;
}) {
  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        onNext();
      }}
    >
      {departments.length === 0 ? <p className="muted">No departments yet. Add one, or continue without any.</p> : null}
      {departments.map((department) => (
        <article className="wizard-block" key={department.key} data-testid={`setup-department-${department.name || 'new'}`}>
          <div className="wizard-row">
            <label>
              Department name
              <input
                value={department.name}
                aria-label={`Department name ${department.name || 'new'}`}
                onChange={(event) =>
                  onChange(departments.map((item) => (item.key === department.key ? { ...item, name: event.target.value } : item)))
                }
                maxLength={200}
              />
            </label>
            <button
              className="icon-button"
              type="button"
              aria-label={`Remove department ${department.name || 'new'}`}
              onClick={() => onChange(departments.filter((item) => item.key !== department.key))}
            >
              <MinusIcon />
            </button>
          </div>
          <label>
            Use template
            <select
              aria-label={`Use template for ${department.name || 'new department'}`}
              value=""
              onChange={(event) => {
                const template = DEPARTMENT_TEMPLATE_CATALOG.find((item) => item.id === event.target.value);
                if (!template) return;
                onChange(
                  departments.map((item) =>
                    item.key === department.key ? { ...item, requestTypes: typesFromTemplate(template) } : item,
                  ),
                );
              }}
            >
              <option value="">Choose a template</option>
              {DEPARTMENT_TEMPLATE_CATALOG.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
          {department.requestTypes.map((item) => (
            <div className="wizard-row" key={item.key}>
              <label>
                Request type
                <input
                  value={item.name}
                  aria-label={`Request type ${item.name || 'new'} in ${department.name || 'department'}`}
                  onChange={(event) =>
                    onChange(
                      departments.map((entry) =>
                        entry.key === department.key
                          ? {
                              ...entry,
                              requestTypes: entry.requestTypes.map((type) =>
                                type.key === item.key ? { ...type, name: event.target.value } : type,
                              ),
                            }
                          : entry,
                      ),
                    )
                  }
                  maxLength={200}
                />
              </label>
              <label>
                Approval policy
                <select
                  aria-label={`Approval policy for ${item.name || 'new type'} in ${department.name || 'department'}`}
                  value={item.approvalPolicy}
                  onChange={(event) =>
                    onChange(
                      departments.map((entry) =>
                        entry.key === department.key
                          ? {
                              ...entry,
                              requestTypes: entry.requestTypes.map((type) =>
                                type.key === item.key
                                  ? { ...type, approvalPolicy: event.target.value as TemplatePolicy }
                                  : type,
                              ),
                            }
                          : entry,
                      ),
                    )
                  }
                >
                  <option value="NONE">None</option>
                  <option value="DEPARTMENT_ADMIN">Department Admin</option>
                  <option value="SUPER_ADMIN">Super Admin</option>
                </select>
              </label>
              <button
                className="icon-button"
                type="button"
                aria-label={`Remove request type ${item.name || 'new'} from ${department.name || 'department'}`}
                onClick={() =>
                  onChange(
                    departments.map((entry) =>
                      entry.key === department.key
                        ? { ...entry, requestTypes: entry.requestTypes.filter((type) => type.key !== item.key) }
                        : entry,
                    ),
                  )
                }
              >
                <MinusIcon />
              </button>
            </div>
          ))}
          <button
            className="icon-button"
            type="button"
            aria-label={`Add request type to ${department.name || 'department'}`}
            onClick={() =>
              onChange(
                departments.map((entry) =>
                  entry.key === department.key
                    ? {
                        ...entry,
                        requestTypes: [...entry.requestTypes, { key: nextKey(), name: '', approvalPolicy: 'NONE' }],
                      }
                    : entry,
                ),
              )
            }
          >
            <PlusIcon />
          </button>
        </article>
      ))}
      <button
        className="icon-button"
        type="button"
        aria-label="Add department"
        onClick={() => onChange([...departments, { key: nextKey(), name: '', requestTypes: [] }])}
      >
        <PlusIcon />
      </button>
      <div className="wizard-actions">
        <button className="btn-primary" type="submit" disabled={Boolean(departmentProblems(departments))}>
          Next
        </button>
      </div>
    </form>
  );
}

function StaffStep({
  departments,
  invitations,
  busy,
  canFinish,
  onChange,
  onFinish,
}: {
  departments: DraftDepartment[];
  invitations: DraftInvite[];
  busy: boolean;
  canFinish: boolean;
  onChange: (next: DraftInvite[]) => void;
  onFinish: (event: FormEvent) => void;
}) {
  return (
    <form className="stack" onSubmit={onFinish}>
      <p className="muted">Inviting staff is optional. Invitations are sent after you verify your email and sign in.</p>
      {invitations.map((invite) => (
        <article className="wizard-block" key={invite.key}>
          <div className="wizard-row">
            <label>
              Staff name
              <input
                value={invite.name}
                aria-label="Staff name"
                onChange={(event) => updateInvite(invitations, invite.key, { name: event.target.value }, onChange)}
                maxLength={200}
              />
            </label>
            <button
              className="icon-button"
              type="button"
              aria-label={`Remove invitation ${invite.name || invite.email || ''}`.trim()}
              onClick={() => onChange(invitations.filter((item) => item.key !== invite.key))}
            >
              <MinusIcon />
            </button>
          </div>
          <label>
            Staff email
            <input
              type="email"
              value={invite.email}
              aria-label="Staff email"
              onChange={(event) => updateInvite(invitations, invite.key, { email: event.target.value }, onChange)}
            />
          </label>
          <label>
            Staff department
            <select
              aria-label="Staff department"
              value={invite.departmentKey}
              onChange={(event) => updateInvite(invitations, invite.key, { departmentKey: event.target.value }, onChange)}
            >
              <option value="">Select a department</option>
              {departments.map((department) => (
                <option key={department.key} value={department.key}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Staff role
            <select
              aria-label="Staff role"
              value={invite.role}
              onChange={(event) => {
                const role = event.target.value as StaffRole;
                updateInvite(
                  invitations,
                  invite.key,
                  {
                    role,
                    canHandle:
                      role === 'EMPLOYEE'
                        ? invite.role === 'EMPLOYEE'
                          ? invite.canHandle
                          : false
                        : storedCanHandle(role, invite.canHandle),
                  },
                  onChange,
                );
              }}
            >
              <option value="EMPLOYEE">Employee</option>
              <option value="DEPARTMENT_ADMIN">Department Admin</option>
              <option value="SUPER_ADMIN">Super Admin</option>
            </select>
          </label>
          {invite.role === 'EMPLOYEE' ? (
            <label>
              Handler access
              <select
                aria-label="Handler access"
                value={invite.canHandle ? 'true' : 'false'}
                onChange={(event) =>
                  updateInvite(invitations, invite.key, { canHandle: event.target.value === 'true' }, onChange)
                }
              >
                <option value="false">Employee — Cannot handle requests</option>
                <option value="true">Handler — Can handle requests</option>
              </select>
            </label>
          ) : null}
        </article>
      ))}
      <button
        className="icon-button"
        type="button"
        aria-label="Add staff"
        onClick={() =>
          onChange([
            ...invitations,
            {
              key: nextKey(),
              name: '',
              email: '',
              departmentName: '',
              departmentKey: '',
              role: 'EMPLOYEE',
              canHandle: false,
            },
          ])
        }
      >
        <PlusIcon />
      </button>
      <div className="wizard-actions">
        <button className="btn-primary" type="submit" disabled={busy || !canFinish}>
          Create workspace
        </button>
      </div>
    </form>
  );
}

function invitationProblems(invitations: DraftInvite[], departments: DraftDepartment[]) {
  const emails = invitations.map((invite) => invite.email.trim().toLowerCase());
  if (new Set(emails.filter(Boolean)).size !== emails.filter(Boolean).length) {
    return 'Staff email addresses must be unique.';
  }
  for (const invite of invitations) {
    if (invite.name.trim().length === 0) return 'Each invitation needs a name.';
    if (!validEmail(invite.email)) return 'Each invitation needs a valid email.';
    if (!departments.some((department) => department.key === invite.departmentKey && department.name.trim())) {
      return 'Each invitation needs a department from this setup.';
    }
  }
  return '';
}

function updateInvite(
  invitations: DraftInvite[],
  key: string,
  patch: Partial<DraftInvite>,
  onChange: (next: DraftInvite[]) => void,
) {
  onChange(invitations.map((invite) => (invite.key === key ? { ...invite, ...patch } : invite)));
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
