import { ApprovalPolicy, ApprovalState, ServiceRequest } from './api';

export function requestStageLabel(request: {
  approvalState: ApprovalState | null;
  capturedApprovalPolicy: ApprovalPolicy | null;
  currentOwnerId: number | null;
  status: ServiceRequest['status'];
}) {
  const waiting =
    request.approvalState == null &&
    (request.capturedApprovalPolicy === 'DEPARTMENT_ADMIN' ||
      request.capturedApprovalPolicy === 'SUPER_ADMIN');
  if (request.approvalState === 'DENIED') return 'Denied';
  if (request.approvalState === 'PENDING' || waiting) return 'Awaiting approval';
  if (request.status === 'COMPLETED') return 'Completed';
  if (request.status === 'IN_PROGRESS') return 'In progress';
  if (request.currentOwnerId != null) return 'Claimed';
  if (request.approvalState === 'APPROVED') return 'Approved · awaiting handler';
  return 'Awaiting handler';
}

export function stageClass(label: string) {
  if (label === 'Denied' || label === 'Awaiting approval') return 'badge badge-denied';
  if (label === 'Completed') return 'badge badge-completed';
  if (label === 'In progress' || label === 'Claimed') return 'badge badge-progress';
  return 'badge badge-submitted';
}

export function formatSubmitted(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

