import { ReactNode } from 'react';
import { HistoryRecord, ServiceRequest } from './api';
import { ApprovalFacts } from './approvals';
import { requestStageLabel } from './request-stage';
import { StatusHistory } from './status-history';

function policyLabel(policy: ServiceRequest['capturedApprovalPolicy']) {
  if (policy === 'DEPARTMENT_ADMIN') return 'Department Admin';
  if (policy === 'SUPER_ADMIN') return 'Super Admin';
  if (policy === 'NONE') return 'None';
  return '—';
}

export function AuthorizedRequestDetail({
  request,
  history,
  actions,
  note,
}: {
  request: ServiceRequest;
  history: HistoryRecord[];
  actions?: ReactNode;
  note?: string;
}) {
  return (
    <article className="card request-detail" data-testid="request-detail">
      <div className="card-heading">
        <h2>{request.title ? request.title : 'Untitled request'}</h2>
      </div>
      <dl className="details">
        <div>
          <dt>Request Stage</dt>
          <dd>
            <span className="badge" data-testid="request-stage">
              {requestStageLabel(request)}
            </span>
          </dd>
        </div>
        <div>
          <dt>Request type</dt>
          <dd>{request.requestType ? request.requestType.name : '—'}</dd>
        </div>
        <div>
          <dt>Destination</dt>
          <dd>{request.department.name}</dd>
        </div>
        <div>
          <dt>Submitter</dt>
          <dd>{request.submitter.name}</dd>
        </div>
        <div>
          <dt>Submitted</dt>
          <dd>{new Date(request.submittedAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Approval policy</dt>
          <dd>{policyLabel(request.capturedApprovalPolicy)}</dd>
        </div>
        <ApprovalFacts request={request} />
        <div>
          <dt>Claimed by</dt>
          <dd>{request.currentOwner ? request.currentOwner.name : 'Unclaimed'}</dd>
        </div>
        <div className="details-wide">
          <dt>Description</dt>
          <dd>{request.description ? request.description : '—'}</dd>
        </div>
      </dl>
      {actions}
      {note ? <p className="muted">{note}</p> : null}
      <h3>Status history</h3>
      <StatusHistory request={request} history={history} />
    </article>
  );
}
