import { FormEvent, useState } from 'react';
import {
  ApiError,
  CompanyEmployee,
  Department,
  deactivateCompanyEmployee,
  deactivateDepartmentEmployee,
  inviteStaff,
  StaleSessionResult,
  updateCompanyEmployee,
  updateDepartmentEmployee,
} from './api';
import { FormOverlay } from './form-overlay';
import { canActAsHandler, staffRoleLabel, storedCanHandle } from './roles';

function discardIfDirty(dirty: boolean) {
  if (!dirty) return true;
  return window.confirm('Discard unsaved changes?');
}

function failMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function InviteStaffButton({ onClick }: { onClick: () => void }) {
  return (
    <button id="invite-staff" className="btn-primary" type="button" onClick={onClick}>
      Invite Staff
    </button>
  );
}

export function StaffRowActions({
  employee,
  onEdit,
  onRemove,
}: {
  employee: CompanyEmployee;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="row-actions">
      <button id={`edit-staff-${employee.id}`} className="icon-button" type="button" aria-label={`Edit ${employee.name}`} title={`Edit ${employee.name}`} onClick={onEdit}>
        <PencilIcon />
      </button>
      {employee.active ? (
        <button
          id={`remove-staff-${employee.id}`}
          className="icon-button"
          type="button"
          aria-label={`Remove ${employee.name}`}
          title={`Remove ${employee.name}`}
          onClick={onRemove}
        >
          <TrashIcon />
        </button>
      ) : null}
    </div>
  );
}

export function canManageStaff(
  actor: { id: number; role: string; departmentId: number | null },
  employee: CompanyEmployee,
) {
  if (employee.id === actor.id) return false;
  if (actor.role === 'SUPER_ADMIN') return true;
  return actor.role === 'DEPARTMENT_ADMIN' && employee.role === 'EMPLOYEE' && employee.department?.id === actor.departmentId;
}

export function InviteStaffOverlay({
  mode,
  departments,
  fixedDepartment,
  busy,
  run,
  onClose,
  onInvited,
}: {
  mode: 'company' | 'department';
  departments: Department[];
  fixedDepartment?: Department | null;
  busy: boolean;
  run: (action: () => Promise<void>) => void;
  onClose: () => void;
  onInvited: () => Promise<void>;
}) {
  const [staffName, setStaffName] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [departmentId, setDepartmentId] = useState(fixedDepartment ? String(fixedDepartment.id) : '');
  const [role, setRole] = useState<'EMPLOYEE' | 'DEPARTMENT_ADMIN' | 'SUPER_ADMIN'>('EMPLOYEE');
  const [canHandle, setCanHandle] = useState(false);
  const [formError, setFormError] = useState('');
  const departmentLocked = mode === 'department';
  const roleLocked = mode === 'department';
  const showHandler = role === 'EMPLOYEE';
  const dirty =
    staffName !== '' ||
    staffEmail !== '' ||
    (!departmentLocked && departmentId !== '') ||
    (!roleLocked && role !== 'EMPLOYEE') ||
    canHandle;

  function close() {
    if (!discardIfDirty(dirty)) return;
    onClose();
  }

  function onInvite(event: FormEvent) {
    event.preventDefault();
    const nextDepartment = departmentLocked ? fixedDepartment?.id : Number(departmentId);
    if (!nextDepartment) return;
    const nextRole = roleLocked ? 'EMPLOYEE' : role;
    run(async () => {
      setFormError('');
      try {
        await inviteStaff({
          email: staffEmail,
          name: staffName,
          departmentId: nextDepartment,
          role: nextRole,
          canHandle: storedCanHandle(nextRole, canHandle),
        });
        await onInvited();
        onClose();
      } catch (error) {
        setFormError(failMessage(error, 'Could not send the invitation'));
        if (error instanceof StaleSessionResult || (error instanceof ApiError && error.status === 401)) {
          throw error;
        }
      }
    });
  }

  return (
    <FormOverlay title="Invite staff" returnFocusId="invite-staff" onClose={close}>
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
        {departmentLocked ? (
          <p>
            Department <strong>{fixedDepartment?.name ?? 'Your department'}</strong>
          </p>
        ) : (
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
        )}
        {roleLocked ? (
          <p>
            Role <strong>Employee</strong>
          </p>
        ) : (
          <label>
            Staff role
            <select
              value={role}
              onChange={(event) => {
                const next = event.target.value as typeof role;
                setRole(next);
                setCanHandle(
                  next === 'EMPLOYEE' ? (role === 'EMPLOYEE' ? canHandle : false) : storedCanHandle(next, canHandle),
                );
              }}
            >
              <option value="EMPLOYEE">Employee</option>
              <option value="DEPARTMENT_ADMIN">Department Admin</option>
              <option value="SUPER_ADMIN">Super Admin</option>
            </select>
          </label>
        )}
        {showHandler ? (
          <label>
            Handler access
            <select
              aria-label="Handler access"
              value={canHandle ? 'true' : 'false'}
              onChange={(event) => setCanHandle(event.target.value === 'true')}
            >
              <option value="false">Employee — Cannot handle requests</option>
              <option value="true">Handler — Can handle requests</option>
            </select>
          </label>
        ) : null}
        <div className="dialog-actions">
          <button className="btn-secondary" type="button" onClick={close}>
            Cancel
          </button>
          <button className="btn-primary" type="submit" disabled={busy || (!departmentLocked && departmentId === '')}>
            Send invitation
          </button>
        </div>
      </form>
    </FormOverlay>
  );
}

export function EditStaffOverlay({
  mode,
  employee,
  departments,
  busy,
  run,
  onClose,
  onSaved,
}: {
  mode: 'company' | 'department';
  employee: CompanyEmployee;
  departments: Department[];
  busy: boolean;
  run: (action: () => Promise<void>) => void;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(employee.name);
  const [departmentId, setDepartmentId] = useState(employee.department ? String(employee.department.id) : '');
  const [role, setRole] = useState(employee.role);
  const [canHandle, setCanHandle] = useState(employee.canHandle);
  const [active, setActive] = useState(employee.active);
  const [formError, setFormError] = useState('');
  const company = mode === 'company';
  const showHandler = role === 'EMPLOYEE';
  const dirty =
    name !== employee.name ||
    (company && departmentId !== (employee.department ? String(employee.department.id) : '')) ||
    (company && role !== employee.role) ||
    (showHandler && canHandle !== employee.canHandle) ||
    (company && active !== employee.active);

  function close() {
    if (!discardIfDirty(dirty)) return;
    onClose();
  }

  function onSave(event: FormEvent) {
    event.preventDefault();
    run(async () => {
      setFormError('');
      try {
        if (company) {
          await updateCompanyEmployee(employee.id, {
            name,
            ...(departmentId ? { departmentId: Number(departmentId) } : {}),
            role: role as 'EMPLOYEE' | 'DEPARTMENT_ADMIN' | 'SUPER_ADMIN',
            canHandle: storedCanHandle(role, canHandle),
            active,
          });
        } else {
          await updateDepartmentEmployee(employee.id, { name, canHandle: storedCanHandle(role, canHandle) });
        }
        await onSaved();
        onClose();
      } catch (error) {
        setFormError(failMessage(error, 'Could not save this staff account'));
        if (error instanceof StaleSessionResult || (error instanceof ApiError && error.status === 401)) {
          throw error;
        }
      }
    });
  }

  return (
    <FormOverlay title="Edit staff" returnFocusId={`edit-staff-${employee.id}`} onClose={close}>
      {formError ? (
        <div className="alert" role="alert">
          {formError}
        </div>
      ) : null}
      <form className="stack" onSubmit={onSave}>
        <label>
          Staff name
          <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={200} />
        </label>
        <p>
          Email <strong>{employee.email ?? '—'}</strong>
        </p>
        {company ? (
          <label>
            Staff department
            <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} required={role !== 'SUPER_ADMIN'}>
              {role === 'SUPER_ADMIN' ? <option value="">No department</option> : null}
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p>
            Department <strong>{employee.department?.name ?? '—'}</strong>
          </p>
        )}
        {company ? (
          <label>
            Staff role
            <select
              value={role}
              onChange={(event) => {
                const next = event.target.value;
                setRole(next);
                setCanHandle(
                  next === 'EMPLOYEE' ? (role === 'EMPLOYEE' ? canHandle : false) : storedCanHandle(next, canHandle),
                );
              }}
            >
              <option value="EMPLOYEE">Employee</option>
              <option value="DEPARTMENT_ADMIN">Department Admin</option>
              <option value="SUPER_ADMIN">Super Admin</option>
            </select>
          </label>
        ) : (
          <p>
            Role <strong>{staffRoleLabel(employee.role, employee.canHandle)}</strong>
          </p>
        )}
        {showHandler ? (
          <label>
            Handler access
            <select
              aria-label="Handler access"
              value={canHandle ? 'true' : 'false'}
              onChange={(event) => setCanHandle(event.target.value === 'true')}
            >
              <option value="false">Employee — Cannot handle requests</option>
              <option value="true">Handler — Can handle requests</option>
            </select>
          </label>
        ) : null}
        {company ? (
          <label>
            Account status
            <select aria-label="Account status" value={active ? 'true' : 'false'} onChange={(event) => setActive(event.target.value === 'true')}>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </label>
        ) : null}
        <div className="dialog-actions">
          <button className="btn-secondary" type="button" onClick={close}>
            Cancel
          </button>
          <button className="btn-primary" type="submit" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </FormOverlay>
  );
}

export function RemoveStaffDialog({
  employee,
  mode,
  busy,
  run,
  onClose,
  onRemoved,
}: {
  employee: CompanyEmployee;
  mode: 'company' | 'department';
  busy: boolean;
  run: (action: () => Promise<void>) => void;
  onClose: () => void;
  onRemoved: () => Promise<void>;
}) {
  const [formError, setFormError] = useState('');

  function onRemove() {
    run(async () => {
      setFormError('');
      try {
        if (mode === 'company') await deactivateCompanyEmployee(employee.id);
        else await deactivateDepartmentEmployee(employee.id);
        await onRemoved();
        onClose();
      } catch (error) {
        setFormError(failMessage(error, 'Could not remove this staff account'));
        if (error instanceof StaleSessionResult || (error instanceof ApiError && error.status === 401)) {
          throw error;
        }
      }
    });
  }

  return (
    <FormOverlay title="Remove staff" returnFocusId={`remove-staff-${employee.id}`} onClose={onClose}>
      {formError ? (
        <div className="alert" role="alert">
          {formError}
        </div>
      ) : null}
      <p>Are you sure you want to remove {employee.name}?</p>
      <div className="dialog-actions">
        <button className="btn-secondary" type="button" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" type="button" disabled={busy} onClick={onRemove}>
          Remove
        </button>
      </div>
    </FormOverlay>
  );
}

export function handlerCell(employee: CompanyEmployee) {
  return canActAsHandler(employee.role, employee.canHandle) ? 'Yes' : 'No';
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 20h4l10-10-4-4L4 16v4z" />
      <path d="M12 6l4 4" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M9 7V5h6v2" />
      <path d="M7 7l1 12h8l1-12" />
    </svg>
  );
}
