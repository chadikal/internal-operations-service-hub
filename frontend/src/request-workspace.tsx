import { FormEvent } from 'react';
import {
  Department,
  Employee,
  hasActionableIntakeDraft,
  HistoryRecord,
  IntakeResult,
  RequestType,
  ServiceRequest,
  SessionUser,
} from './api';

export type IntakeStep = 'input' | 'troubleshoot' | 'offer' | 'draft' | 'resolved' | 'declined';

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

function hasMissingRequiredInformation(result: IntakeResult | null): boolean {
  return (result?.missingInformation.length ?? 0) > 0;
}

function intakeSuggestions(result: IntakeResult | null): string[] {
  return result?.suggestions ?? [];
}

export function chooseIntakeStep(result: IntakeResult): IntakeStep {
  if (result.situation === 'problem' && result.troubleshootingSteps.length > 0) {
    return 'troubleshoot';
  }
  if (hasMissingRequiredInformation(result)) {
    return 'input';
  }
  if (hasActionableIntakeDraft(result.draft)) {
    return 'offer';
  }
  return 'input';
}

export { hasMissingRequiredInformation };

function policyLabel(policy: ServiceRequest['capturedApprovalPolicy']) {
  if (policy === 'DEPARTMENT_ADMIN') return 'Department Admin';
  if (policy === 'SUPER_ADMIN') return 'Super Admin';
  if (policy === 'NONE') return 'None';
  return '—';
}

function DepartmentAndTypeFields({
  departments,
  requestTypes,
  departmentId,
  setDepartmentId,
  requestTypeId,
  setRequestTypeId,
}: {
  departments: Department[];
  requestTypes: RequestType[];
  departmentId: string;
  setDepartmentId: (value: string) => void;
  requestTypeId: string;
  setRequestTypeId: (value: string) => void;
}) {
  const typesForDepartment = requestTypes.filter((item) => String(item.departmentId) === departmentId);
  return (
    <>
      <label>
        Department
        <select
          value={departmentId}
          onChange={(event) => {
            const next = event.target.value;
            setDepartmentId(next);
            const first = requestTypes.find((item) => String(item.departmentId) === next);
            setRequestTypeId(first ? String(first.id) : '');
          }}
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
        Request type
        <select
          value={requestTypeId}
          onChange={(event) => setRequestTypeId(event.target.value)}
          required
        >
          <option value="">Select a request type</option>
          {typesForDepartment.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      {departmentId !== '' && typesForDepartment.length === 0 ? (
        <p className="muted">
          This department has no request types yet. A Super Admin must add one before a request can
          be submitted.
        </p>
      ) : null}
    </>
  );
}

export function RequestWorkspace({
  user,
  employees,
  departments,
  requestTypes,
  departmentId,
  setDepartmentId,
  requestTypeId,
  setRequestTypeId,
  title,
  setTitle,
  description,
  setDescription,
  ownerId,
  setOwnerId,
  loadId,
  setLoadId,
  request,
  history,
  busy,
  intakeText,
  setIntakeText,
  intakeResult,
  intakeStep,
  canSubmitRequest,
  onCreate,
  onLoad,
  onAssignOwner,
  onTransition,
  onAnalyze,
  onProblemSolved,
  onPrepareRequest,
  resetIntake,
  showLoadForm = true,
  showDetails = true,
}: {
  user: SessionUser;
  employees: Employee[];
  departments: Department[];
  requestTypes: RequestType[];
  departmentId: string;
  setDepartmentId: (value: string) => void;
  requestTypeId: string;
  setRequestTypeId: (value: string) => void;
  title: string;
  setTitle: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
  ownerId: string;
  setOwnerId: (value: string) => void;
  loadId: string;
  setLoadId: (value: string) => void;
  request: ServiceRequest | null;
  history: HistoryRecord[];
  busy: boolean;
  intakeText: string;
  setIntakeText: (value: string) => void;
  intakeResult: IntakeResult | null;
  intakeStep: IntakeStep;
  canSubmitRequest: boolean;
  onCreate: (event: FormEvent) => void;
  onLoad: (event: FormEvent) => void;
  onAssignOwner: (event: FormEvent) => void;
  onTransition: (to: 'IN_PROGRESS' | 'COMPLETED') => void;
  onAnalyze: (event: FormEvent) => void;
  onProblemSolved: (solved: boolean) => void;
  onPrepareRequest: (prepare: boolean) => void;
  resetIntake: () => void;
  showLoadForm?: boolean;
  showDetails?: boolean;
}) {
  const canHandle = user.canHandle === true;
  const eligibleOwners = employees.filter(
    (employee) =>
      employee.canHandle === true &&
      (request == null || Number(employee.id) !== Number(request.submittedBy)),
  );
  const isCurrentOwner = request != null && Number(request.currentOwnerId) === Number(user.id);
  const ownerSelectValue = eligibleOwners.some((employee) => String(employee.id) === ownerId)
    ? ownerId
    : eligibleOwners[0]
      ? String(eligibleOwners[0].id)
      : '';

  return (
    <>
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

        {intakeSuggestions(intakeResult).length > 0 ? (
          <div className="notice" data-testid="intake-suggestions">
            <p>Optional details that may help:</p>
            <ul>
              {intakeSuggestions(intakeResult).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {intakeResult &&
        (intakeStep === 'input' || intakeStep === 'troubleshoot' || intakeStep === 'offer') &&
        (hasMissingRequiredInformation(intakeResult) ||
          (intakeStep === 'input' && !hasActionableIntakeDraft(intakeResult.draft))) ? (
          <p className="muted" data-testid="intake-need-more">
            Please provide the missing details so we can understand your request and help
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

        {intakeStep === 'offer' && !hasMissingRequiredInformation(intakeResult) ? (
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
            <DepartmentAndTypeFields
              departments={departments}
              requestTypes={requestTypes}
              departmentId={departmentId}
              setDepartmentId={setDepartmentId}
              requestTypeId={requestTypeId}
              setRequestTypeId={setRequestTypeId}
            />
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
            <DepartmentAndTypeFields
              departments={departments}
              requestTypes={requestTypes}
              departmentId={departmentId}
              setDepartmentId={setDepartmentId}
              requestTypeId={requestTypeId}
              setRequestTypeId={setRequestTypeId}
            />
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

        {showLoadForm ? (
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
        ) : null}
      </div>

      {showDetails && request ? (
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
                <dt>Request type</dt>
                <dd>{request.requestType ? request.requestType.name : '—'}</dd>
              </div>
              <div>
                <dt>Approval policy</dt>
                <dd>{policyLabel(request.capturedApprovalPolicy)}</dd>
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
    </>
  );
}
