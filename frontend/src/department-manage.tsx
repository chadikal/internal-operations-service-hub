import { FormEvent, useEffect, useState } from 'react';
import {
  ApiError,
  applyDepartmentTemplateTypes,
  ApprovalPolicy,
  createDepartment,
  createRequestType,
  deleteRequestType,
  currentSessionGeneration,
  deleteDepartment,
  Department,
  DepartmentOverviewRow,
  DepartmentTemplate,
  DepartmentTemplateId,
  getDepartmentOverview,
  getDepartments,
  getDepartmentTemplates,
  getRequestTypes,
  RequestType,
  StaleSessionResult,
  updateDepartment,
  updateRequestType,
} from './api';
import {
  confirmedSuggestions,
  draftsFromTemplate,
  DraftSuggestion,
  MinusIcon,
  PlusIcon,
  TemplatePicker,
  TemplateSuggestionEditor,
} from './department-templates';
import { FormOverlay } from './form-overlay';

function discardIfDirty(dirty: boolean) {
  if (!dirty) return true;
  return window.confirm('Discard unsaved changes?');
}

function failMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function shouldBubble(error: unknown) {
  return error instanceof StaleSessionResult || (error instanceof ApiError && error.status === 401);
}

function policyLabel(policy: ApprovalPolicy) {
  if (policy === 'DEPARTMENT_ADMIN') return 'Department Admin';
  if (policy === 'SUPER_ADMIN') return 'Super Admin';
  return 'None';
}

function sameDrafts(left: DraftSuggestion[], right: DraftSuggestion[]) {
  if (left.length !== right.length) return false;
  return left.every(
    (item, index) => item.name === right[index]?.name && item.approvalPolicy === right[index]?.approvalPolicy,
  );
}

export function policyName(policy: ApprovalPolicy) {
  return policyLabel(policy);
}

export function DepartmentWorkspace({
  busy,
  run,
  onUnauthorized,
}: {
  busy: boolean;
  run: (action: () => Promise<void>) => void;
  onUnauthorized: () => void;
}) {
  const [overview, setOverview] = useState<DepartmentOverviewRow[] | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [requestTypes, setRequestTypes] = useState<RequestType[]>([]);
  const [templates, setTemplates] = useState<DepartmentTemplate[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [deleting, setDeleting] = useState<Department | null>(null);
  const [addingType, setAddingType] = useState(false);
  const [editingType, setEditingType] = useState<RequestType | null>(null);
  const [usingTemplate, setUsingTemplate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function refresh(generation = currentSessionGeneration()) {
    const [nextOverview, nextDepartments, nextTypes, nextTemplates] = await Promise.all([
      getDepartmentOverview(),
      getDepartments(),
      getRequestTypes(),
      getDepartmentTemplates(),
    ]);
    if (currentSessionGeneration() !== generation) throw new StaleSessionResult();
    setOverview(nextOverview.items);
    setDepartments(nextDepartments);
    setRequestTypes(nextTypes);
    setTemplates(nextTemplates);
  }

  useEffect(() => {
    const generation = currentSessionGeneration();
    setLoading(true);
    setError('');
    refresh(generation)
      .catch((err: unknown) => {
        if (err instanceof StaleSessionResult) return;
        if (err instanceof ApiError && err.status === 401) {
          onUnauthorized();
          return;
        }
        setError(err instanceof Error ? err.message : 'Could not load departments');
      })
      .finally(() => {
        if (currentSessionGeneration() === generation) setLoading(false);
      });
  }, []);

  const editingTypes = requestTypes.filter((item) => item.departmentId === editing?.id);
  const nestedOverlay = addingType || editingType != null || usingTemplate;

  async function reload() {
    setError('');
    try {
      await refresh();
    } catch (err) {
      if (err instanceof StaleSessionResult) return;
      setError(err instanceof Error ? err.message : 'Could not refresh departments');
      if (err instanceof ApiError && err.status === 401) throw err;
    }
  }

  return (
    <div>
      <header className="workspace-header section-heading">
        <h2>Departments</h2>
        <button id="add-department" className="btn-primary" type="button" onClick={() => setCreating(true)}>
          Add department
        </button>
      </header>
      {notice ? (
        <p className="muted" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <div className="alert" role="alert">
          {error}
        </div>
      ) : null}
      {loading ? <p>Loading departments…</p> : null}
      {!loading && overview && overview.length === 0 ? (
        <p className="muted" data-testid="departments-empty">
          No departments yet.
        </p>
      ) : null}
      {!loading && overview && overview.length > 0 ? (
        <div className="table-wrap" data-testid="department-list">
          <table className="data-table" data-testid="department-overview">
            <thead>
              <tr>
                <th scope="col">Department</th>
                <th scope="col">Employees</th>
                <th scope="col">Department Admins</th>
                <th scope="col">Requests</th>
                <th scope="col">Awaiting approval</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {overview.map((row) => {
                const department = departments.find((item) => item.id === row.id);
                return (
                  <tr key={row.id} data-testid={`department-row-${row.name}`}>
                    <td>{row.name}</td>
                    <td>{row.employees}</td>
                    <td>{row.departmentAdmins.length > 0 ? row.departmentAdmins.join(', ') : 'None'}</td>
                    <td>{row.requests}</td>
                    <td>{row.awaitingApproval}</td>
                    <td>
                      {department ? (
                        <div className="row-actions">
                          <button
                            id={`edit-department-${department.id}`}
                            className="icon-button"
                            type="button"
                            aria-label={`Edit ${department.name}`}
                            title={`Edit ${department.name}`}
                            onClick={() => setEditing(department)}
                          >
                            <PencilIcon />
                          </button>
                          <button
                            id={`delete-department-${department.id}`}
                            className="icon-button"
                            type="button"
                            aria-label={`Delete ${department.name}`}
                            title={`Delete ${department.name}`}
                            onClick={() => setDeleting(department)}
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {creating ? (
        <CreateDepartmentOverlay
          templates={templates}
          busy={busy}
          run={run}
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setNotice('Department added.');
            setCreating(false);
            await reload();
          }}
        />
      ) : null}
      {editing ? (
        <EditDepartmentOverlay
          department={editing}
          types={editingTypes}
          busy={busy}
          suspendKeys={nestedOverlay}
          run={run}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setNotice('');
            setEditing(null);
            await reload();
          }}
          onAddType={() => setAddingType(true)}
          onEditType={setEditingType}
          onRemoveType={async (item) => {
            await deleteRequestType(item.id);
            await reload();
          }}
          onUseTemplate={() => setUsingTemplate(true)}
        />
      ) : null}
      {deleting ? (
        <DeleteDepartmentDialog
          department={deleting}
          busy={busy}
          run={run}
          onClose={() => setDeleting(null)}
          onDeleted={async () => {
            setNotice('');
            setDeleting(null);
            await reload();
          }}
        />
      ) : null}
      {editing && addingType ? (
        <AddRequestTypeOverlay
          department={editing}
          busy={busy}
          run={run}
          onClose={() => setAddingType(false)}
          onAdded={async () => {
            setNotice('');
            setAddingType(false);
            await reload();
          }}
        />
      ) : null}
      {editingType ? (
        <EditRequestTypeOverlay
          item={editingType}
          busy={busy}
          run={run}
          onClose={() => setEditingType(null)}
          onSaved={async () => {
            setNotice('');
            setEditingType(null);
            await reload();
          }}
        />
      ) : null}
      {editing && usingTemplate ? (
        <UseTemplateOverlay
          department={editing}
          templates={templates}
          busy={busy}
          run={run}
          onClose={() => setUsingTemplate(false)}
          onApplied={async () => {
            setNotice('');
            setUsingTemplate(false);
            await reload();
          }}
        />
      ) : null}
    </div>
  );
}

function CreateDepartmentOverlay({
  templates,
  busy,
  run,
  onClose,
  onCreated,
}: {
  templates: DepartmentTemplate[];
  busy: boolean;
  run: (action: () => Promise<void>) => void;
  onClose: () => void;
  onCreated: (department: Department) => Promise<void>;
}) {
  const defaultTemplate = templates.find((item) => item.id === 'CUSTOM_EMPTY') ?? templates[0];
  const [departmentName, setDepartmentName] = useState('');
  const [templateId, setTemplateId] = useState(defaultTemplate?.id ?? 'CUSTOM_EMPTY');
  const [drafts, setDrafts] = useState<DraftSuggestion[]>(() => draftsFromTemplate(defaultTemplate));
  const [formError, setFormError] = useState('');
  const selected = templates.find((item) => item.id === templateId);
  const initialDrafts = draftsFromTemplate(defaultTemplate);
  const dirty =
    departmentName !== '' ||
    templateId !== (defaultTemplate?.id ?? 'CUSTOM_EMPTY') ||
    !sameDrafts(drafts, initialDrafts);

  useEffect(() => {
    if (templates.length === 0 || templates.some((item) => item.id === templateId)) return;
    const next = templates.find((item) => item.id === 'CUSTOM_EMPTY') ?? templates[0];
    if (next) {
      setTemplateId(next.id);
      setDrafts(draftsFromTemplate(next));
    }
  }, [templates, templateId]);

  function close() {
    if (!discardIfDirty(dirty)) return;
    onClose();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    run(async () => {
      setFormError('');
      try {
        const created = await createDepartment(departmentName, {
          templateId: templateId as DepartmentTemplateId,
          requestTypes: confirmedSuggestions(drafts),
        });
        await onCreated(created);
      } catch (error) {
        setFormError(failMessage(error, 'Could not add the department'));
        if (shouldBubble(error)) throw error;
      }
    });
  }

  return (
    <FormOverlay title="Add department" returnFocusId="add-department" onClose={close} wide>
      {formError ? (
        <div className="alert" role="alert">
          {formError}
        </div>
      ) : null}
      <form className="stack" onSubmit={onSubmit}>
        <label>
          Department name
          <input value={departmentName} onChange={(event) => setDepartmentName(event.target.value)} required maxLength={200} />
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
        {selected?.id === 'CUSTOM_EMPTY' ? <p className="muted">Custom/Empty suggests no request types.</p> : null}
        <TemplateSuggestionEditor drafts={drafts} scope="new department" onChange={setDrafts} />
        <div className="dialog-actions">
          <button className="btn-secondary" type="button" onClick={close}>
            Cancel
          </button>
          <button className="btn-primary" type="submit" disabled={busy}>
            Create department
          </button>
        </div>
      </form>
    </FormOverlay>
  );
}

function EditDepartmentOverlay({
  department,
  types,
  busy,
  suspendKeys,
  run,
  onClose,
  onSaved,
  onAddType,
  onEditType,
  onRemoveType,
  onUseTemplate,
}: {
  department: Department;
  types: RequestType[];
  busy: boolean;
  suspendKeys: boolean;
  run: (action: () => Promise<void>) => void;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onAddType: () => void;
  onEditType: (item: RequestType) => void;
  onRemoveType: (item: RequestType) => Promise<void>;
  onUseTemplate: () => void;
}) {
  const [name, setName] = useState(department.name);
  const [formError, setFormError] = useState('');
  const dirty = name !== department.name;

  function close() {
    if (!discardIfDirty(dirty)) return;
    onClose();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    run(async () => {
      setFormError('');
      try {
        await updateDepartment(department.id, name);
        await onSaved();
      } catch (error) {
        setFormError(failMessage(error, 'Could not rename the department'));
        if (shouldBubble(error)) throw error;
      }
    });
  }

  return (
    <FormOverlay
      title="Edit department"
      returnFocusId={`edit-department-${department.id}`}
      onClose={close}
      wide
      listenForKeys={!suspendKeys}
    >
      {formError ? (
        <div className="alert" role="alert">
          {formError}
        </div>
      ) : null}
      <form className="stack" onSubmit={onSubmit}>
        <label>
          Department name
          <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={200} />
        </label>
        <div data-testid={`request-types-for-${department.name}`}>
          <h3>Request types</h3>
          {types.length === 0 ? <p className="muted">No request types yet.</p> : null}
          {types.length > 0 ? (
            <ul className="plain-list">
              {types.map((item) => (
                <li key={item.id} className="type-row">
                  <span>
                    {item.name} · {policyLabel(item.approvalPolicy)}
                  </span>
                  <div className="row-actions">
                    <button
                      id={`edit-request-type-${item.id}`}
                      className="icon-button"
                      type="button"
                      aria-label={`Edit ${item.name}`}
                      title={`Edit ${item.name}`}
                      onClick={() => onEditType(item)}
                    >
                      <PencilIcon />
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`Remove ${item.name}`}
                      title={`Remove ${item.name}`}
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm(`Remove ${item.name}?`)) return;
                        run(async () => {
                          setFormError('');
                          try {
                            await onRemoveType(item);
                          } catch (error) {
                            setFormError(failMessage(error, 'Could not remove the request type'));
                            if (shouldBubble(error)) throw error;
                          }
                        });
                      }}
                    >
                      <MinusIcon />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="dialog-actions">
            <button id="add-request-type" className="btn-secondary icon-label" type="button" onClick={onAddType}>
              <PlusIcon /> Add request type
            </button>
            <button id="use-template" className="btn-secondary" type="button" onClick={onUseTemplate}>
              Use template
            </button>
          </div>
        </div>
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

function DeleteDepartmentDialog({
  department,
  busy,
  run,
  onClose,
  onDeleted,
}: {
  department: Department;
  busy: boolean;
  run: (action: () => Promise<void>) => void;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [formError, setFormError] = useState('');

  function onDelete() {
    run(async () => {
      setFormError('');
      try {
        await deleteDepartment(department.id);
        await onDeleted();
      } catch (error) {
        setFormError(failMessage(error, 'Could not delete the department'));
        if (shouldBubble(error)) throw error;
      }
    });
  }

  return (
    <FormOverlay title="Delete department" returnFocusId={`delete-department-${department.id}`} onClose={onClose}>
      {formError ? (
        <div className="alert" role="alert">
          {formError}
        </div>
      ) : null}
      <p>Are you sure you want to delete {department.name}?</p>
      <div className="dialog-actions">
        <button className="btn-secondary" type="button" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" type="button" disabled={busy} onClick={onDelete}>
          Delete
        </button>
      </div>
    </FormOverlay>
  );
}

function AddRequestTypeOverlay({
  department,
  busy,
  run,
  onClose,
  onAdded,
}: {
  department: Department;
  busy: boolean;
  run: (action: () => Promise<void>) => void;
  onClose: () => void;
  onAdded: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [policy, setPolicy] = useState<ApprovalPolicy>('NONE');
  const [formError, setFormError] = useState('');
  const dirty = name !== '' || policy !== 'NONE';

  function close() {
    if (!discardIfDirty(dirty)) return;
    onClose();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    run(async () => {
      setFormError('');
      try {
        await createRequestType(department.id, name, policy);
        await onAdded();
      } catch (error) {
        setFormError(failMessage(error, 'Could not add the request type'));
        if (shouldBubble(error)) throw error;
      }
    });
  }

  return (
    <FormOverlay title="Add request type" returnFocusId="add-request-type" onClose={close}>
      {formError ? (
        <div className="alert" role="alert">
          {formError}
        </div>
      ) : null}
      <form className="stack" onSubmit={onSubmit}>
        <label>
          New type for {department.name}
          <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={200} />
        </label>
        <label>
          Approval policy for new {department.name} type
          <select value={policy} onChange={(event) => setPolicy(event.target.value as ApprovalPolicy)}>
            <option value="NONE">None</option>
            <option value="DEPARTMENT_ADMIN">Department Admin</option>
            <option value="SUPER_ADMIN">Super Admin</option>
          </select>
        </label>
        <div className="dialog-actions">
          <button className="btn-secondary" type="button" onClick={close}>
            Cancel
          </button>
          <button className="btn-primary" type="submit" disabled={busy}>
            Add request type
          </button>
        </div>
      </form>
    </FormOverlay>
  );
}

function EditRequestTypeOverlay({
  item,
  busy,
  run,
  onClose,
  onSaved,
}: {
  item: RequestType;
  busy: boolean;
  run: (action: () => Promise<void>) => void;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(item.name);
  const [policy, setPolicy] = useState<ApprovalPolicy>(item.approvalPolicy);
  const [formError, setFormError] = useState('');
  const dirty = name !== item.name || policy !== item.approvalPolicy;

  function close() {
    if (!discardIfDirty(dirty)) return;
    onClose();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    run(async () => {
      setFormError('');
      try {
        await updateRequestType(item.id, { name, approvalPolicy: policy });
        await onSaved();
      } catch (error) {
        setFormError(failMessage(error, 'Could not update the request type'));
        if (shouldBubble(error)) throw error;
      }
    });
  }

  return (
    <FormOverlay title="Edit request type" returnFocusId={`edit-request-type-${item.id}`} onClose={close}>
      {formError ? (
        <div className="alert" role="alert">
          {formError}
        </div>
      ) : null}
      <form className="stack" onSubmit={onSubmit}>
        <label>
          New name for {item.name}
          <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={200} />
        </label>
        <label>
          Approval policy for {item.name}
          <select value={policy} onChange={(event) => setPolicy(event.target.value as ApprovalPolicy)}>
            <option value="NONE">None</option>
            <option value="DEPARTMENT_ADMIN">Department Admin</option>
            <option value="SUPER_ADMIN">Super Admin</option>
          </select>
        </label>
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

function UseTemplateOverlay({
  department,
  templates,
  busy,
  run,
  onClose,
  onApplied,
}: {
  department: Department;
  templates: DepartmentTemplate[];
  busy: boolean;
  run: (action: () => Promise<void>) => void;
  onClose: () => void;
  onApplied: () => Promise<void>;
}) {
  const [templateId, setTemplateId] = useState('');
  const [drafts, setDrafts] = useState<DraftSuggestion[]>([]);
  const [formError, setFormError] = useState('');
  const selected = templates.find((item) => item.id === templateId);
  const dirty = templateId !== '';

  function close() {
    if (!discardIfDirty(dirty)) return;
    onClose();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (templateId === '') return;
    run(async () => {
      setFormError('');
      try {
        await applyDepartmentTemplateTypes(department.id, {
          templateId: templateId as DepartmentTemplateId,
          requestTypes: confirmedSuggestions(drafts),
        });
        await onApplied();
      } catch (error) {
        setFormError(failMessage(error, 'Could not apply the template'));
        if (shouldBubble(error)) throw error;
      }
    });
  }

  return (
    <FormOverlay title="Use template" returnFocusId="use-template" onClose={close} wide>
      {formError ? (
        <div className="alert" role="alert">
          {formError}
        </div>
      ) : null}
      <form className="stack" onSubmit={onSubmit}>
        <TemplatePicker
          label={`Template to apply to ${department.name}`}
          templates={templates}
          value={templateId}
          allowNone
          onChange={(nextId) => {
            setTemplateId(nextId);
            setDrafts(draftsFromTemplate(templates.find((item) => item.id === nextId)));
          }}
        />
        {selected?.unspecifiedNotice ? (
          <p className="muted" role="status">
            {selected.unspecifiedNotice}
          </p>
        ) : null}
        {selected?.id === 'CUSTOM_EMPTY' ? <p className="muted">Custom/Empty suggests no request types.</p> : null}
        {templateId ? (
          <TemplateSuggestionEditor drafts={drafts} scope={department.name} onChange={setDrafts} />
        ) : null}
        <div className="dialog-actions">
          <button className="btn-secondary" type="button" onClick={close}>
            Cancel
          </button>
          <button className="btn-primary" type="submit" disabled={busy || templateId === ''}>
            Apply suggested types to {department.name}
          </button>
        </div>
      </form>
    </FormOverlay>
  );
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
