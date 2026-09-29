import { FormEvent, useEffect, useState } from 'react';
import {
  ApiError,
  Department,
  changePassword,
  getDepartments,
  getRequestTypes,
  RequestType,
  SessionUser,
  StaleSessionResult,
  currentSessionGeneration,
  updateCompanyName,
  updateDepartment,
  updateProfile,
} from './api';
import { workspaceRoleLabel } from './admin';
import { policyName } from './department-manage';
import { PasswordField } from './password-field';
import { canSubmitNewPassword, confirmPasswordError, shortPasswordError } from './password-rules';

type SettingsSection = 'profile' | 'security' | 'company' | 'department';

export function AccountSettings({
  user,
  onUnauthorized,
  onUpdated,
}: {
  user: SessionUser;
  onUnauthorized: () => void;
  onUpdated: (patch: { name?: string; companyName?: string }) => void;
}) {
  const sections: { id: SettingsSection; label: string }[] = [
    { id: 'profile', label: 'Profile' },
    { id: 'security', label: 'Security' },
  ];
  if (user.role === 'SUPER_ADMIN') sections.push({ id: 'company', label: 'Company' });
  if (user.role === 'DEPARTMENT_ADMIN') sections.push({ id: 'department', label: 'My Department' });
  const [section, setSection] = useState<SettingsSection>('profile');
  const [dirty, setDirty] = useState(false);

  function choose(next: SettingsSection) {
    if (next === section) return;
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    setDirty(false);
    setSection(next);
  }

  return (
    <div data-testid="account-settings">
      <header className="workspace-header">
        <h2>Settings</h2>
      </header>
      <div className="settings-layout">
        <div className="request-tabs" role="tablist" aria-label="Settings sections">
          {sections.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={section === item.id}
              className={section === item.id ? 'request-tab request-tab-current' : 'request-tab'}
              onClick={() => choose(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {section === 'profile' ? (
          <ProfileSection user={user} onUnauthorized={onUnauthorized} onUpdated={onUpdated} onDirty={setDirty} />
        ) : null}
        {section === 'security' ? (
          <SecuritySection onUnauthorized={onUnauthorized} onDirty={setDirty} />
        ) : null}
        {section === 'company' ? (
          <CompanySection user={user} onUnauthorized={onUnauthorized} onUpdated={onUpdated} onDirty={setDirty} />
        ) : null}
        {section === 'department' ? (
          <MyDepartmentSection user={user} onUnauthorized={onUnauthorized} onDirty={setDirty} />
        ) : null}
      </div>
    </div>
  );
}

function ProfileSection({
  user,
  onUnauthorized,
  onUpdated,
  onDirty,
}: {
  user: SessionUser;
  onUnauthorized: () => void;
  onUpdated: (patch: { name?: string }) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [name, setName] = useState(user.name);
  const [departmentName, setDepartmentName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const changed = name.trim() !== user.name;

  useEffect(() => {
    onDirty(changed);
    return () => onDirty(false);
  }, [changed, onDirty]);

  useEffect(() => {
    if (user.departmentId == null) return;
    const generation = currentSessionGeneration();
    getDepartments()
      .then((departments) => {
        if (currentSessionGeneration() !== generation) return;
        const mine = departments.find((item) => item.id === user.departmentId);
        setDepartmentName(mine?.name ?? '');
      })
      .catch((err: unknown) => {
        if (err instanceof StaleSessionResult) return;
        if (err instanceof ApiError && err.status === 401) onUnauthorized();
      });
  }, [user.departmentId, onUnauthorized]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!changed) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const updated = await updateProfile(name.trim());
      setName(updated.name);
      onUpdated({ name: updated.name });
      onDirty(false);
      setNotice('Saved.');
    } catch (err: unknown) {
      if (err instanceof StaleSessionResult) return;
      if (err instanceof ApiError && err.status === 401) {
        onUnauthorized();
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not save your profile');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" data-testid="settings-profile" onSubmit={(event) => void save(event)}>
      {error ? (
        <div className="alert" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <p className="muted" role="status">
          {notice}
        </p>
      ) : null}
      <label>
        Name
        <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={200} />
      </label>
      <label>
        Email
        <input value={user.email ?? ''} readOnly />
      </label>
      <label>
        Role
        <input value={workspaceRoleLabel(user.role, user.canHandle)} readOnly />
      </label>
      {user.departmentId != null && departmentName ? (
        <label>
          Department
          <input value={departmentName} readOnly />
        </label>
      ) : null}
      <button className="btn-primary" type="submit" disabled={busy || !changed}>
        Save changes
      </button>
    </form>
  );
}

function SecuritySection({
  onUnauthorized,
  onDirty,
}: {
  onUnauthorized: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const changed = currentPassword !== '' || newPassword !== '' || confirmPassword !== '';

  useEffect(() => {
    onDirty(changed);
    return () => onDirty(false);
  }, [changed, onDirty]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!canSubmitNewPassword(newPassword, confirmPassword)) return;
    setBusy(true);
    try {
      await changePassword({ currentPassword, newPassword, confirmPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setMessage('Password changed.');
    } catch (err: unknown) {
      if (err instanceof StaleSessionResult) return;
      if (err instanceof ApiError && err.status === 401) {
        onUnauthorized();
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not change the password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="settings-security">
      {error ? (
        <div className="alert" role="alert">
          {error}
        </div>
      ) : null}
      {message ? (
        <p className="muted" role="status">
          {message}
        </p>
      ) : null}
      <form className="stack" noValidate onSubmit={(event) => void save(event)}>
        <PasswordField
          label="Current password"
          value={currentPassword}
          onChange={setCurrentPassword}
          autoComplete="current-password"
        />
        <PasswordField
          label="New password"
          value={newPassword}
          onChange={setNewPassword}
          autoComplete="new-password"
          error={shortPasswordError(newPassword)}
        />
        <PasswordField
          label="Confirm new password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          autoComplete="new-password"
          error={confirmPasswordError(newPassword, confirmPassword)}
        />
        <button
          className="btn-primary"
          type="submit"
          disabled={busy || currentPassword.length === 0 || !canSubmitNewPassword(newPassword, confirmPassword)}
        >
          Change password
        </button>
      </form>
    </div>
  );
}

function CompanySection({
  user,
  onUnauthorized,
  onUpdated,
  onDirty,
}: {
  user: SessionUser;
  onUnauthorized: () => void;
  onUpdated: (patch: { companyName?: string }) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [name, setName] = useState(user.companyName);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const changed = name.trim() !== user.companyName;

  useEffect(() => {
    onDirty(changed);
    return () => onDirty(false);
  }, [changed, onDirty]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!changed) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const updated = await updateCompanyName(name.trim());
      setName(updated.companyName);
      onUpdated({ companyName: updated.companyName });
      onDirty(false);
      setNotice('Saved.');
    } catch (err: unknown) {
      if (err instanceof StaleSessionResult) return;
      if (err instanceof ApiError && err.status === 401) {
        onUnauthorized();
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not save the company');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" data-testid="settings-company" onSubmit={(event) => void save(event)}>
      {error ? (
        <div className="alert" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <p className="muted" role="status">
          {notice}
        </p>
      ) : null}
      <label>
        Company name
        <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={200} />
      </label>
      <button className="btn-primary" type="submit" disabled={busy || !changed}>
        Save changes
      </button>
    </form>
  );
}

function MyDepartmentSection({
  user,
  onUnauthorized,
  onDirty,
}: {
  user: SessionUser;
  onUnauthorized: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [department, setDepartment] = useState<Department | null>(null);
  const [name, setName] = useState('');
  const [types, setTypes] = useState<RequestType[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const changed = department != null && name.trim() !== department.name;

  useEffect(() => {
    onDirty(changed);
    return () => onDirty(false);
  }, [changed, onDirty]);

  useEffect(() => {
    const generation = currentSessionGeneration();
    setLoading(true);
    Promise.all([getDepartments(), getRequestTypes()])
      .then(([departments, requestTypes]) => {
        if (currentSessionGeneration() !== generation) return;
        const mine = departments.find((item) => item.id === user.departmentId) ?? null;
        setDepartment(mine);
        setName(mine?.name ?? '');
        setTypes(requestTypes.filter((item) => item.departmentId === user.departmentId));
      })
      .catch((err: unknown) => {
        if (err instanceof StaleSessionResult) return;
        if (err instanceof ApiError && err.status === 401) {
          onUnauthorized();
          return;
        }
        setError(err instanceof Error ? err.message : 'Could not load your department');
      })
      .finally(() => {
        if (currentSessionGeneration() === generation) setLoading(false);
      });
  }, [user.departmentId, onUnauthorized]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!department || !changed) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const updated = await updateDepartment(department.id, name.trim());
      setDepartment(updated);
      setName(updated.name);
      onDirty(false);
      setNotice('Department saved.');
    } catch (err: unknown) {
      if (err instanceof StaleSessionResult) return;
      if (err instanceof ApiError && err.status === 401) {
        onUnauthorized();
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not save the department');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="muted">Loading department…</p>;
  if (!department && error) {
    return (
      <div className="alert" role="alert">
        {error}
      </div>
    );
  }
  if (!department) return <p className="muted">You do not have a department.</p>;

  return (
    <div data-testid="settings-department">
      {error ? (
        <div className="alert" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <p className="muted" role="status">
          {notice}
        </p>
      ) : null}
      <form className="stack" onSubmit={(event) => void save(event)}>
        <label>
          Department name
          <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={200} />
        </label>
        <button className="btn-primary" type="submit" disabled={busy || !changed}>
          Save department
        </button>
      </form>
      <h3>Request types</h3>
      {types.length === 0 ? <p className="muted">No request types yet.</p> : null}
      {types.length > 0 ? (
        <ul className="plain-list">
          {types.map((type) => (
            <li key={type.id}>
              {type.name}
              <span className="muted"> · {policyName(type.approvalPolicy)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
