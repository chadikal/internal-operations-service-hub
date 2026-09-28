import { AccountRole, ApprovalPolicy, ApprovalState, Prisma, RequestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type PeopleCounts = {
  total: number;
  admins: number;
  handlers: number;
  employees: number;
};

export type RequestWorkCounts = {
  total: number;
  submitted: number;
  inProgress: number;
  completed: number;
  claimed: number;
  unclaimed: number;
  active: number;
};

export type ApprovalCounts = {
  total: number;
  awaiting: number;
  approved: number;
  denied: number;
};

export type MyRequestCounts = {
  total: number;
  submitted: number;
  completed: number;
  inProgress: number;
  unclaimed: number;
  awaitingApproval: number;
  approved: number;
  denied: number;
};

const requiredPolicy: Prisma.RequestWhereInput[] = [
  { capturedApprovalPolicy: { in: [ApprovalPolicy.DEPARTMENT_ADMIN, ApprovalPolicy.SUPER_ADMIN] } },
  { capturedApprovalPolicy: null },
];

const awaitingApproval: Prisma.RequestWhereInput = {
  OR: [
    { approvalState: ApprovalState.PENDING, OR: requiredPolicy },
    {
      approvalState: null,
      capturedApprovalPolicy: { in: [ApprovalPolicy.DEPARTMENT_ADMIN, ApprovalPolicy.SUPER_ADMIN] },
    },
  ],
};

const approvedApproval: Prisma.RequestWhereInput = {
  approvalState: ApprovalState.APPROVED,
  OR: requiredPolicy,
};

const deniedApproval: Prisma.RequestWhereInput = {
  approvalState: ApprovalState.DENIED,
  OR: requiredPolicy,
};

export function approvalBucketWhere(
  bucket: 'all' | 'awaiting' | 'approved' | 'denied',
): Prisma.RequestWhereInput {
  if (bucket === 'awaiting') return awaitingApproval;
  if (bucket === 'approved') return approvedApproval;
  if (bucket === 'denied') return deniedApproval;
  return { OR: [awaitingApproval, approvedApproval, deniedApproval] };
}

/** Requests submitted by someone else that this admin is allowed to decide. */
export function eligibleApprovalScope(actor: {
  id: number;
  companyId: number;
  role: AccountRole;
  departmentId: number | null;
}): Prisma.RequestWhereInput {
  const others = { submittedBy: { not: actor.id } };
  if (actor.role === AccountRole.SUPER_ADMIN) {
    return {
      companyId: actor.companyId,
      capturedApprovalPolicy: ApprovalPolicy.SUPER_ADMIN,
      ...others,
    };
  }
  return {
    companyId: actor.companyId,
    departmentId: actor.departmentId ?? -1,
    capturedApprovalPolicy: ApprovalPolicy.DEPARTMENT_ADMIN,
    ...others,
  };
}

function withScope(scope: Prisma.RequestWhereInput, extra: Prisma.RequestWhereInput): Prisma.RequestWhereInput {
  return { AND: [scope, extra] };
}

export async function countPeople(prisma: PrismaService, scope: Prisma.EmployeeWhereInput): Promise<PeopleCounts> {
  const [total, admins, handlers, employees] = await Promise.all([
    prisma.employee.count({ where: scope }),
    prisma.employee.count({
      where: { AND: [scope, { role: { in: [AccountRole.SUPER_ADMIN, AccountRole.DEPARTMENT_ADMIN] } }] },
    }),
    prisma.employee.count({ where: { AND: [scope, { canHandle: true }] } }),
    prisma.employee.count({ where: { AND: [scope, { role: AccountRole.EMPLOYEE }] } }),
  ]);
  return { total, admins, handlers, employees };
}

export async function countRequestWork(
  prisma: PrismaService,
  scope: Prisma.RequestWhereInput,
): Promise<RequestWorkCounts> {
  const [grouped, claimed, unclaimed] = await Promise.all([
    prisma.request.groupBy({
      by: ['status'],
      where: scope,
      _count: { _all: true },
    }),
    prisma.request.count({ where: withScope(scope, { currentOwnerId: { not: null } }) }),
    prisma.request.count({ where: withScope(scope, { currentOwnerId: null }) }),
  ]);
  const byStatus: Record<RequestStatus, number> = {
    SUBMITTED: 0,
    IN_PROGRESS: 0,
    COMPLETED: 0,
  };
  for (const row of grouped) {
    byStatus[row.status] = row._count._all;
  }
  const submitted = byStatus.SUBMITTED;
  const inProgress = byStatus.IN_PROGRESS;
  const completed = byStatus.COMPLETED;
  return {
    total: submitted + inProgress + completed,
    submitted,
    inProgress,
    completed,
    claimed,
    unclaimed,
    active: submitted + inProgress,
  };
}

export async function countApprovals(
  prisma: PrismaService,
  scope: Prisma.RequestWhereInput,
): Promise<ApprovalCounts> {
  const [awaiting, approved, denied] = await Promise.all([
    prisma.request.count({ where: withScope(scope, awaitingApproval) }),
    prisma.request.count({ where: withScope(scope, approvedApproval) }),
    prisma.request.count({ where: withScope(scope, deniedApproval) }),
  ]);
  return { total: awaiting + approved + denied, awaiting, approved, denied };
}

export async function countMyRequests(
  prisma: PrismaService,
  companyId: number,
  accountId: number,
): Promise<MyRequestCounts> {
  const scope = { companyId, submittedBy: accountId };
  const [work, approvals] = await Promise.all([countRequestWork(prisma, scope), countApprovals(prisma, scope)]);
  return {
    total: work.total,
    submitted: work.submitted,
    completed: work.completed,
    inProgress: work.inProgress,
    unclaimed: work.unclaimed,
    awaitingApproval: approvals.awaiting,
    approved: approvals.approved,
    denied: approvals.denied,
  };
}
