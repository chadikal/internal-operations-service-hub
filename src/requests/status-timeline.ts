export type TimelineApprovalState = 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'DENIED' | null;
export type TimelinePolicy = 'NONE' | 'DEPARTMENT_ADMIN' | 'SUPER_ADMIN' | null;

export type TimelineRequest = {
  submittedAt: string;
  status: 'SUBMITTED' | 'IN_PROGRESS' | 'COMPLETED';
  approvalState: TimelineApprovalState;
  capturedApprovalPolicy: TimelinePolicy;
  currentOwnerId: number | null;
  claimedAt?: string | null;
  submitter: { name: string };
  currentOwner: { name: string } | null;
  approvalDecision: {
    decision: 'APPROVED' | 'DENIED';
    decidedAt: string;
    approver: { name: string };
  } | null;
};

export type TimelineChange = {
  newStatus: string;
  changedAt: string;
  changedByEmployee: { name: string };
};

export type TimelineStep = {
  label: string;
  detail: string | null;
};

function approvalRequired(request: TimelineRequest) {
  if (request.approvalState === 'NOT_REQUIRED') return false;
  if (
    request.approvalState === 'PENDING' ||
    request.approvalState === 'APPROVED' ||
    request.approvalState === 'DENIED'
  ) {
    return true;
  }
  return request.capturedApprovalPolicy === 'DEPARTMENT_ADMIN' || request.capturedApprovalPolicy === 'SUPER_ADMIN';
}

function when(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function by(name: string, at?: string) {
  return at ? `by ${name} · ${when(at)}` : `by ${name}`;
}

export function buildStatusTimeline(request: TimelineRequest, changes: TimelineChange[]): TimelineStep[] {
  const steps: TimelineStep[] = [
    { label: 'Submitted', detail: by(request.submitter.name, request.submittedAt) },
  ];

  if (approvalRequired(request)) {
    steps.push({ label: 'Awaiting Approval', detail: null });
    const decision = request.approvalDecision;
    const denied = request.approvalState === 'DENIED' || decision?.decision === 'DENIED';
    const approved = request.approvalState === 'APPROVED' || decision?.decision === 'APPROVED';
    if (denied) {
      steps.push({
        label: 'Denied',
        detail: decision?.decision === 'DENIED' ? by(decision.approver.name, decision.decidedAt) : null,
      });
      return steps;
    }
    if (approved) {
      steps.push({
        label: 'Approved',
        detail: decision?.decision === 'APPROVED' ? by(decision.approver.name, decision.decidedAt) : null,
      });
    } else {
      return steps;
    }
  }

  const progressed = changes.some((change) => change.newStatus === 'IN_PROGRESS' || change.newStatus === 'COMPLETED');
  const claimed = request.currentOwnerId != null || progressed;
  steps.push({ label: 'Unclaimed', detail: null });
  if (claimed) {
    steps.push({
      label: 'Claimed',
      detail: request.currentOwner
        ? request.claimedAt
          ? by(request.currentOwner.name, request.claimedAt)
          : by(request.currentOwner.name)
        : null,
    });
  }
  for (const change of changes) {
    if (change.newStatus === 'IN_PROGRESS') {
      steps.push({ label: 'In Progress', detail: by(change.changedByEmployee.name, change.changedAt) });
    } else if (change.newStatus === 'COMPLETED') {
      steps.push({ label: 'Completed', detail: by(change.changedByEmployee.name, change.changedAt) });
    }
  }
  return steps;
}

export function statusTimelineChain(request: TimelineRequest, changes: TimelineChange[]) {
  return buildStatusTimeline(request, changes)
    .map((step) => step.label)
    .join(' → ');
}
