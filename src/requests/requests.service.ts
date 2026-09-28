import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  RequestStatus as PrismaRequestStatus,
  AccountRole,
  ApprovalPolicy,
  ApprovalState,
  ApprovalDecisionOutcome,
} from '@prisma/client';
import { AssignOwnerDto } from './dto/assign-owner.dto';
import { CreateRequestDto } from './dto/create-request.dto';
import { DecideApprovalDto } from './dto/decide-approval.dto';
import { TransitionRequestDto } from './dto/transition-request.dto';
import { canHandleRequests } from '../auth/handler-access';
import { PrismaService } from '../prisma/prisma.service';
import { countMyRequests, approvalBucketWhere, eligibleApprovalScope } from './dashboard-counts';
import { ListApprovalsQueryDto } from './dto/list-approvals.query';
import { ListQueueQueryDto, RequestQueue } from './dto/list-queue.query';
import { RequestStatus } from './request-status.enum';

const ALLOWED_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  [RequestStatus.SUBMITTED]: [RequestStatus.IN_PROGRESS],
  [RequestStatus.IN_PROGRESS]: [RequestStatus.COMPLETED],
  [RequestStatus.COMPLETED]: [],
};

const personSelect = { id: true, name: true } as const;

const requestInclude = {
  submitter: { select: personSelect },
  department: true,
  requestType: { select: { id: true, name: true } },
  currentOwner: { select: personSelect },
  approvalDecision: {
    include: { approver: { select: personSelect } },
  },
} as const;

type Actor = {
  id: number;
  companyId: number;
  canHandle: boolean;
  role: AccountRole;
  departmentId: number | null;
  active: boolean;
};

type DecisionRequest = {
  companyId: number;
  submittedBy: number;
  departmentId: number;
  capturedApprovalPolicy: ApprovalPolicy | null;
  approvalState: ApprovalState | null;
};

type ViewableRequest = DecisionRequest & {
  currentOwnerId: number | null;
};

const DEPARTMENT_ADMIN_WAIT_NOTICE =
  'No other Department Admin in the destination department can decide this request. It stays pending.';
const SUPER_ADMIN_WAIT_NOTICE =
  'No other Super Admin can decide this request. It stays pending.';

@Injectable()
export class RequestsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(actorId: number, dto: CreateRequestDto) {
    const actor = await this.requireActor(actorId);
    if (dto.submittedBy !== actor.id) {
      throw new ForbiddenException('You can only submit requests as yourself');
    }

    await this.ensureEmployee(dto.submittedBy, actor.companyId);
    await this.ensureDepartment(dto.departmentId, actor.companyId);
    const requestType = await this.ensureRequestType(dto.requestTypeId, dto.departmentId, actor.companyId);

    const submittedAt = new Date();
    const request = await this.prisma.request.create({
      data: {
        companyId: actor.companyId,
        submittedBy: dto.submittedBy,
        departmentId: dto.departmentId,
        requestTypeId: requestType.id,
        capturedApprovalPolicy: requestType.approvalPolicy,
        approvalState: initialApprovalState(requestType.approvalPolicy),
        currentOwnerId: null,
        status: PrismaRequestStatus.SUBMITTED,
        statusUpdatedAt: submittedAt,
        submittedAt,
        title: optionalText(dto.title),
        description: optionalText(dto.description),
      },
      include: requestInclude,
    });

    return this.present(request);
  }

  async summary(actorId: number) {
    const actor = await this.requireActor(actorId);
    const submitted = await this.prisma.request.findMany({
      where: { companyId: actor.companyId, submittedBy: actor.id },
      select: queueCountSelect,
    });
    const handling = this.canUseHandlerQueues(actor)
      ? {
          available: await this.prisma.request.count({ where: claimableWhere(actor) }),
          claimed: await this.prisma.request.count({ where: claimedWhere(actor) }),
          completed: await this.prisma.request.count({ where: completedOwnedWhere(actor) }),
        }
      : null;
    const departmentApprovals =
      actor.role === AccountRole.DEPARTMENT_ADMIN
        ? await this.prisma.request.count({ where: departmentApprovalWhere(actor) })
        : null;
    return {
      submissions: countStages(submitted),
      handling,
      departmentApprovals,
      myRequests: await countMyRequests(this.prisma, actor.companyId, actor.id),
    };
  }

  async listQueue(actorId: number, query: ListQueueQueryDto) {
    const actor = await this.requireActor(actorId);
    this.assertQueueAccess(actor, query.queue);
    this.assertQueueFilters(query);
    const where = this.queueWhere(actor, query.queue);
    if (query.approvalState === 'UNSET') {
      where.approvalState = null;
    } else if (query.approvalState) {
      where.approvalState = query.approvalState;
    }
    if (query.workStatus) {
      where.status = query.workStatus;
    }
    if (query.assignment === 'unclaimed') {
      where.currentOwnerId = null;
    } else if (query.assignment === 'claimed') {
      where.currentOwnerId = { not: null };
    }
    const search = searchWhere(query.q);
    if (search) {
      where.AND = search;
    }
    const rows = await this.prisma.request.findMany({
      where,
      select: queueItemSelect,
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return {
      queue: query.queue,
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        submittedAt: row.submittedAt.toISOString(),
        approvalState: row.approvalState,
        capturedApprovalPolicy: row.capturedApprovalPolicy,
        currentOwnerId: row.currentOwnerId,
        status: row.status,
        submitter: row.submitter,
        department: { id: row.department.id, name: row.department.name },
      })),
    };
  }

  async findOne(actorId: number, id: number) {
    const actor = await this.requireActor(actorId);
    const request = await this.getRequestOrThrow(id, actor.companyId);
    this.assertCanView(actor, request);
    return this.present(request);
  }

  async listApprovals(actorId: number, query: ListApprovalsQueryDto = {}) {
    const actor = await this.requireActor(actorId);
    if (!actor.active || !isApprovalReviewer(actor)) {
      throw new ForbiddenException('You are not allowed to review approvals');
    }
    const bucket = query.status ?? 'awaiting';
    const where = { AND: [eligibleApprovalScope(actor), approvalBucketWhere(bucket)] };
    const requests = await this.prisma.request.findMany({
      where,
      include: requestInclude,
      orderBy: { id: 'asc' },
    });
    return {
      items: await Promise.all(
        requests.map(async (request) => {
          const body = await this.present(request);
          const canOpen = this.canViewRequest(actor, request);
          const canDecide = this.canDecideNow(actor, request);
          if (canOpen) {
            return { ...body, canOpen, canDecide };
          }
          return {
            ...body,
            description: null,
            approvalNotice: null,
            approvalDecision: null,
            canOpen,
            canDecide,
          };
        }),
      ),
    };
  }

  async decide(actorId: number, id: number, dto: DecideApprovalDto) {
    const actor = await this.requireActor(actorId);
    const request = await this.getRequestOrThrow(id, actor.companyId);
    this.assertCanDecide(actor, request);
    const reason = dto.decision === 'DENIED' ? requiredDenialReason(dto.reason) : null;
    const decidedAt = new Date();
    const outcome =
      dto.decision === 'APPROVED' ? ApprovalDecisionOutcome.APPROVED : ApprovalDecisionOutcome.DENIED;
    const nextState = dto.decision === 'APPROVED' ? ApprovalState.APPROVED : ApprovalState.DENIED;

    try {
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.request.updateMany({
          where: {
            id,
            companyId: actor.companyId,
            OR: [
              { approvalState: ApprovalState.PENDING },
              {
                approvalState: null,
                capturedApprovalPolicy: {
                  in: [ApprovalPolicy.DEPARTMENT_ADMIN, ApprovalPolicy.SUPER_ADMIN],
                },
              },
            ],
          },
          data: { approvalState: nextState },
        });
        if (updated.count !== 1) {
          throw new ConflictException('This request already has an approval decision');
        }
        await tx.approvalDecision.create({
          data: {
            companyId: actor.companyId,
            requestId: id,
            decision: outcome,
            reason,
            approverId: actor.id,
            approverRole: actor.role,
            decidedAt,
          },
        });
      });
    } catch (error) {
      if (error instanceof ConflictException || !isUniqueConstraint(error)) {
        throw error;
      }
      throw new ConflictException('This request already has an approval decision');
    }

    const decided = await this.getRequestOrThrow(id, actor.companyId);
    return this.present(decided);
  }

  async getHistory(actorId: number, id: number) {
    const actor = await this.requireActor(actorId);
    await this.findOne(actorId, id);
    const history = await this.prisma.requestStatusHistory.findMany({
      where: { requestId: id, companyId: actor.companyId },
      include: { changedByEmployee: { select: { id: true, name: true } } },
      orderBy: { id: 'asc' },
    });
    return history.map((record) => ({
      id: record.id,
      requestId: record.requestId,
      previousStatus: record.previousStatus,
      newStatus: record.newStatus,
      changedBy: record.changedBy,
      changedAt: record.changedAt.toISOString(),
      changedByEmployee: {
        id: record.changedByEmployee.id,
        name: record.changedByEmployee.name,
      },
    }));
  }

  async assignOwner(actorId: number, id: number, _dto: AssignOwnerDto) {
    const actor = await this.requireActor(actorId);
    await this.getRequestOrThrow(id, actor.companyId);
    throw new ForbiddenException(
      'Another person cannot be assigned. An eligible handler claims the request.',
    );
  }

  async claim(actorId: number, id: number) {
    const actor = await this.requireActor(actorId);
    if (!actor.active) {
      throw new ForbiddenException('You are not allowed to claim requests');
    }
    this.assertCanHandle(actor);
    const existing = await this.getRequestOrThrow(id, actor.companyId);
    if (existing.submittedBy === actor.id) {
      throw new ForbiddenException('You cannot claim a request you submitted');
    }
    if (actor.departmentId == null || existing.departmentId !== actor.departmentId) {
      throw new ForbiddenException('You can claim requests only in your department');
    }
    this.assertClaimApproval(existing);
    if (existing.currentOwnerId != null) {
      throw new ConflictException('This request already has an owner');
    }

    const updated = await this.prisma.request.updateMany({
      where: {
        id,
        companyId: actor.companyId,
        departmentId: actor.departmentId,
        currentOwnerId: null,
        submittedBy: { not: actor.id },
        OR: [
          { approvalState: { in: [ApprovalState.NOT_REQUIRED, ApprovalState.APPROVED] } },
          {
            approvalState: null,
            OR: [
              { capturedApprovalPolicy: null },
              { capturedApprovalPolicy: ApprovalPolicy.NONE },
            ],
          },
        ],
      },
      data: { currentOwnerId: actor.id, claimedAt: new Date() },
    });
    if (updated.count !== 1) {
      const again = await this.getRequestOrThrow(id, actor.companyId);
      if (again.currentOwnerId != null) {
        throw new ConflictException('This request already has an owner');
      }
      this.assertClaimApproval(again);
      throw new ConflictException('This request already has an owner');
    }

    return this.present(await this.getRequestOrThrow(id, actor.companyId));
  }

  async transition(actorId: number, id: number, dto: TransitionRequestDto) {
    const actor = await this.requireActor(actorId);
    const request = await this.getRequestOrThrow(id, actor.companyId);
    this.assertCanHandle(actor);
    this.assertApprovalAllowsHandling(request);

    if (dto.changedBy !== actor.id) {
      throw new ForbiddenException('changedBy must match the acting user');
    }

    const currentStatus = request.status as RequestStatus;
    const allowedNext = ALLOWED_TRANSITIONS[currentStatus];
    if (!allowedNext.includes(dto.to)) {
      throw new ConflictException(
        `Transition from ${currentStatus} to ${dto.to} is not allowed`,
      );
    }

    if (request.currentOwnerId === null) {
      throw new ConflictException(
        'A current owner must be assigned before a status transition',
      );
    }

    if (dto.changedBy !== request.currentOwnerId) {
      throw new ConflictException(
        'Only the current owner can update the request status',
      );
    }

    const previousStatus = request.status;
    const changedAt = new Date();

    const [updated] = await this.prisma.$transaction([
      this.prisma.request.update({
        where: { id },
        data: {
          status: dto.to as PrismaRequestStatus,
          statusUpdatedAt: changedAt,
        },
        include: requestInclude,
      }),
      this.prisma.requestStatusHistory.create({
        data: {
          companyId: actor.companyId,
          requestId: id,
          previousStatus,
          newStatus: dto.to as PrismaRequestStatus,
          changedBy: dto.changedBy,
          changedAt,
        },
      }),
    ]);

    return this.present(updated);
  }

  private async requireActor(actorId: number) {
    const actor = await this.prisma.employee.findUnique({
      where: { id: actorId },
      select: {
        id: true,
        companyId: true,
        canHandle: true,
        role: true,
        departmentId: true,
        active: true,
      },
    });
    if (!actor) {
      throw new BadRequestException(`Employee ${actorId} was not found`);
    }
    return actor;
  }

  private assertCanHandle(actor: { canHandle: boolean; role: AccountRole }) {
    if (!canHandleRequests(actor)) {
      throw new ForbiddenException('You are not allowed to handle requests');
    }
  }

  private assertCanView(actor: Actor, request: ViewableRequest) {
    if (this.canViewRequest(actor, request)) {
      return;
    }
    throw new ForbiddenException('You are not allowed to view this request');
  }

  viewerCanOpen(
    actor: {
      id: number;
      companyId: number;
      canHandle: boolean;
      role: AccountRole;
      departmentId: number | null;
      active: boolean;
    },
    request: {
      companyId: number;
      submittedBy: number;
      departmentId: number;
      capturedApprovalPolicy: ApprovalPolicy | null;
      approvalState: ApprovalState | null;
      currentOwnerId: number | null;
    },
  ) {
    return this.canViewRequest(actor, request);
  }

  private canViewRequest(actor: Actor, request: ViewableRequest) {
    if (request.submittedBy === actor.id) {
      return true;
    }
    if (canDecideApproval(actor, request)) {
      return true;
    }
    if (!this.canUseHandlerQueues(actor)) {
      return false;
    }
    if (request.currentOwnerId === actor.id) {
      return true;
    }
    return this.isCurrentlyClaimableBy(actor, request);
  }

  private isCurrentlyClaimableBy(actor: Actor, request: ViewableRequest) {
    return (
      actor.departmentId != null &&
      request.departmentId === actor.departmentId &&
      request.currentOwnerId == null &&
      request.submittedBy !== actor.id &&
      this.approvalAllowsClaim(request)
    );
  }

  private canDecideNow(actor: Actor, request: ViewableRequest) {
    return (
      this.approvalDecisionApplies(request) &&
      request.submittedBy !== actor.id &&
      actor.active &&
      canDecideApproval(actor, request) &&
      this.awaitingApprovalDecision(request)
    );
  }

  private assertCanDecide(actor: Actor, request: ViewableRequest) {
    if (!this.approvalDecisionApplies(request)) {
      if (!this.canViewWithoutDecision(actor, request)) {
        throw new ForbiddenException('You are not allowed to decide this request');
      }
      throw new ConflictException('This request does not require an approval decision');
    }
    if (request.submittedBy === actor.id) {
      throw new ForbiddenException('You cannot approve or deny your own request');
    }
    if (!actor.active || !canDecideApproval(actor, request)) {
      throw new ForbiddenException('You are not allowed to decide this request');
    }
    if (!this.awaitingApprovalDecision(request)) {
      throw new ConflictException('This request already has an approval decision');
    }
  }

  private canViewWithoutDecision(actor: Actor, request: ViewableRequest) {
    return this.canViewRequest(actor, request);
  }

  private assertClaimApproval(request: {
    approvalState: ApprovalState | null;
    capturedApprovalPolicy: ApprovalPolicy | null;
  }) {
    if (request.approvalState === ApprovalState.PENDING || this.legacyApprovalStillRequired(request)) {
      throw new ConflictException('This request is waiting for approval and cannot be handled yet');
    }
    if (request.approvalState === ApprovalState.DENIED) {
      throw new ConflictException('A denied request cannot be handled');
    }
    if (!this.approvalAllowsClaim(request)) {
      throw new ConflictException('This request cannot be claimed');
    }
  }

  private assertApprovalAllowsHandling(request: {
    approvalState: ApprovalState | null;
    capturedApprovalPolicy: ApprovalPolicy | null;
  }) {
    if (request.approvalState === ApprovalState.PENDING || this.legacyApprovalStillRequired(request)) {
      throw new ConflictException('This request is waiting for approval and cannot be handled yet');
    }
    if (request.approvalState === ApprovalState.DENIED) {
      throw new ConflictException('A denied request cannot be handled');
    }
  }

  private approvalAllowsClaim(request: {
    approvalState: ApprovalState | null;
    capturedApprovalPolicy: ApprovalPolicy | null;
  }) {
    return (
      request.approvalState === ApprovalState.NOT_REQUIRED ||
      request.approvalState === ApprovalState.APPROVED ||
      (request.approvalState == null &&
        (request.capturedApprovalPolicy == null ||
          request.capturedApprovalPolicy === ApprovalPolicy.NONE))
    );
  }

  private legacyApprovalStillRequired(request: {
    approvalState: ApprovalState | null;
    capturedApprovalPolicy: ApprovalPolicy | null;
  }) {
    return (
      request.approvalState == null &&
      (request.capturedApprovalPolicy === ApprovalPolicy.DEPARTMENT_ADMIN ||
        request.capturedApprovalPolicy === ApprovalPolicy.SUPER_ADMIN)
    );
  }

  private awaitingApprovalDecision(request: {
    approvalState: ApprovalState | null;
    capturedApprovalPolicy: ApprovalPolicy | null;
  }) {
    return request.approvalState === ApprovalState.PENDING || this.legacyApprovalStillRequired(request);
  }

  private approvalDecisionApplies(request: {
    approvalState: ApprovalState | null;
    capturedApprovalPolicy: ApprovalPolicy | null;
  }) {
    if (
      request.capturedApprovalPolicy == null ||
      request.capturedApprovalPolicy === ApprovalPolicy.NONE ||
      request.approvalState === ApprovalState.NOT_REQUIRED
    ) {
      return false;
    }
    return true;
  }

  private async getRequestOrThrow(id: number, companyId: number) {
    const request = await this.prisma.request.findFirst({
      where: { id, companyId },
      include: requestInclude,
    });
    if (!request) {
      throw new NotFoundException(`Request ${id} was not found`);
    }
    return request;
  }

  private async ensureEmployee(id: number, companyId: number) {
    const employee = await this.prisma.employee.findFirst({
      where: { id, companyId },
      select: { id: true, canHandle: true, role: true },
    });
    if (!employee) {
      throw new BadRequestException(`Employee ${id} was not found`);
    }
    return employee;
  }

  private async ensureDepartment(id: number, companyId: number) {
    const department = await this.prisma.department.findFirst({
      where: { id, companyId },
    });
    if (!department) {
      throw new BadRequestException(`Department ${id} was not found`);
    }
  }

  private async ensureRequestType(id: number, departmentId: number, companyId: number) {
    const requestType = await this.prisma.requestType.findFirst({
      where: { id, departmentId, companyId },
      select: { id: true, approvalPolicy: true },
    });
    if (!requestType) {
      throw new BadRequestException(`Request type ${id} was not found`);
    }
    return requestType;
  }

  private async present(
    request: DecisionRequest & {
      id: number;
      requestTypeId: number | null;
      currentOwnerId: number | null;
      status: PrismaRequestStatus;
      claimedAt: Date | null;
      statusUpdatedAt: Date;
      submittedAt: Date;
      title: string | null;
      description: string | null;
      submitter: { id: number; name: string };
      department: { id: number; name: string };
      requestType: { id: number; name: string } | null;
      currentOwner: { id: number; name: string } | null;
      approvalDecision: {
        decision: ApprovalDecisionOutcome;
        reason: string | null;
        approverId: number;
        approverRole: AccountRole;
        decidedAt: Date;
        approver: { id: number; name: string };
      } | null;
    },
  ) {
    const noEligibleApprover = await this.noEligibleApprover(request);
    return {
      ...this.toRequestResponse(request),
      approvalState: request.approvalState,
      noEligibleApprover,
      approvalNotice: noEligibleApprover ? waitNotice(request.capturedApprovalPolicy) : null,
      approvalDecision: request.approvalDecision
        ? {
            decision: request.approvalDecision.decision,
            reason: request.approvalDecision.reason,
            approverId: request.approvalDecision.approverId,
            approverRole: request.approvalDecision.approverRole,
            decidedAt: request.approvalDecision.decidedAt.toISOString(),
            approver: {
              id: request.approvalDecision.approver.id,
              name: request.approvalDecision.approver.name,
            },
          }
        : null,
    };
  }

  private async noEligibleApprover(request: DecisionRequest) {
    if (!this.awaitingApprovalDecision(request)) {
      return false;
    }
    const count = await this.prisma.employee.count({
      where: eligibleApproverWhere(request),
    });
    return count === 0;
  }

  private canUseHandlerQueues(actor: Actor) {
    return actor.active && canHandleRequests(actor);
  }

  private assertQueueAccess(actor: Actor, queue: RequestQueue) {
    if (!actor.active) {
      throw new ForbiddenException('You are not allowed to view requests');
    }
    if (queue === 'submitted') {
      return;
    }
    if (queue === 'department') {
      if (actor.role !== AccountRole.DEPARTMENT_ADMIN) {
        throw new ForbiddenException('You are not allowed to view department approval requests');
      }
      return;
    }
    if (!this.canUseHandlerQueues(actor)) {
      throw new ForbiddenException('You are not allowed to handle requests');
    }
  }

  private assertQueueFilters(query: ListQueueQueryDto) {
    if (query.assignment && query.queue !== 'submitted') {
      throw new BadRequestException('Claim status filters only the requests you submitted');
    }
    if (query.queue === 'available' && (query.approvalState || query.workStatus)) {
      throw new BadRequestException('Available requests are already limited to work you can claim');
    }
    if (query.queue === 'completed' && (query.approvalState || query.workStatus)) {
      throw new BadRequestException('Completed requests are already limited to work you finished');
    }
    if (query.queue === 'claimed' && query.approvalState) {
      throw new BadRequestException('Use work status to filter requests you have claimed');
    }
    if (query.queue === 'claimed' && query.workStatus === 'COMPLETED') {
      throw new BadRequestException('Completed work is on the Completed list');
    }
    if (query.queue === 'department' && query.workStatus) {
      throw new BadRequestException('Filter department approval requests by approval state');
    }
  }

  private queueWhere(actor: Actor, queue: RequestQueue): Prisma.RequestWhereInput {
    if (queue === 'submitted') {
      return { companyId: actor.companyId, submittedBy: actor.id };
    }
    if (queue === 'available') {
      return claimableWhere(actor);
    }
    if (queue === 'claimed') {
      return claimedWhere(actor);
    }
    if (queue === 'completed') {
      return completedOwnedWhere(actor);
    }
    return departmentApprovalWhere(actor);
  }

  private toRequestResponse(request: {
    id: number;
    submittedBy: number;
    departmentId: number;
    requestTypeId: number | null;
    capturedApprovalPolicy: ApprovalPolicy | null;
    currentOwnerId: number | null;
    claimedAt: Date | null;
    status: PrismaRequestStatus;
    statusUpdatedAt: Date;
    submittedAt: Date;
    title: string | null;
    description: string | null;
    submitter: { id: number; name: string };
    department: { id: number; name: string };
    requestType: { id: number; name: string } | null;
    currentOwner: { id: number; name: string } | null;
  }) {
    return {
      id: request.id,
      submittedBy: request.submittedBy,
      departmentId: request.departmentId,
      requestTypeId: request.requestTypeId,
      capturedApprovalPolicy: request.capturedApprovalPolicy,
      currentOwnerId: request.currentOwnerId,
      claimedAt: request.claimedAt ? request.claimedAt.toISOString() : null,
      status: request.status,
      statusUpdatedAt: request.statusUpdatedAt.toISOString(),
      submittedAt: request.submittedAt.toISOString(),
      title: request.title,
      description: request.description,
      submitter: {
        id: request.submitter.id,
        name: request.submitter.name,
      },
      department: {
        id: request.department.id,
        name: request.department.name,
      },
      requestType: request.requestType
        ? {
            id: request.requestType.id,
            name: request.requestType.name,
          }
        : null,
      currentOwner: request.currentOwner
        ? {
            id: request.currentOwner.id,
            name: request.currentOwner.name,
          }
        : null,
    };
  }
}

const queueCountSelect = {
  approvalState: true,
  capturedApprovalPolicy: true,
  currentOwnerId: true,
  status: true,
} as const;

const queueItemSelect = {
  id: true,
  title: true,
  submittedAt: true,
  approvalState: true,
  capturedApprovalPolicy: true,
  currentOwnerId: true,
  status: true,
  submitter: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
} as const;

type StageRow = {
  approvalState: ApprovalState | null;
  capturedApprovalPolicy: ApprovalPolicy | null;
  currentOwnerId: number | null;
  status: PrismaRequestStatus;
};

function claimableWhere(actor: Actor): Prisma.RequestWhereInput {
  return {
    companyId: actor.companyId,
    departmentId: actor.departmentId ?? -1,
    currentOwnerId: null,
    submittedBy: { not: actor.id },
    OR: [
      { approvalState: { in: [ApprovalState.NOT_REQUIRED, ApprovalState.APPROVED] } },
      {
        approvalState: null,
        OR: [{ capturedApprovalPolicy: null }, { capturedApprovalPolicy: ApprovalPolicy.NONE }],
      },
    ],
  };
}

function claimedWhere(actor: Actor): Prisma.RequestWhereInput {
  return {
    companyId: actor.companyId,
    currentOwnerId: actor.id,
    status: { in: [PrismaRequestStatus.SUBMITTED, PrismaRequestStatus.IN_PROGRESS] },
  };
}

function completedOwnedWhere(actor: Actor): Prisma.RequestWhereInput {
  return {
    companyId: actor.companyId,
    currentOwnerId: actor.id,
    status: PrismaRequestStatus.COMPLETED,
  };
}

function departmentApprovalWhere(actor: Actor): Prisma.RequestWhereInput {
  return {
    companyId: actor.companyId,
    departmentId: actor.departmentId ?? -1,
    capturedApprovalPolicy: ApprovalPolicy.DEPARTMENT_ADMIN,
    submittedBy: { not: actor.id },
  };
}

function searchWhere(q: string | undefined): Prisma.RequestWhereInput | undefined {
  if (!q) {
    return undefined;
  }
  const id = /^\d+$/.test(q) ? Number(q) : undefined;
  return {
    OR: [
      ...(id != null ? [{ id }] : []),
      { title: { contains: q, mode: 'insensitive' } },
      { submitter: { name: { contains: q, mode: 'insensitive' } } },
    ],
  };
}

function countStages(rows: StageRow[]) {
  const counts = {
    awaitingApproval: 0,
    denied: 0,
    awaitingHandler: 0,
    approvedAwaitingHandler: 0,
    claimed: 0,
    inProgress: 0,
    completed: 0,
  };
  for (const row of rows) {
    counts[stageKey(row)] += 1;
  }
  return counts;
}

function stageKey(row: StageRow): keyof ReturnType<typeof countStages> {
  const required =
    row.approvalState == null &&
    (row.capturedApprovalPolicy === ApprovalPolicy.DEPARTMENT_ADMIN ||
      row.capturedApprovalPolicy === ApprovalPolicy.SUPER_ADMIN);
  if (row.approvalState === ApprovalState.DENIED) {
    return 'denied';
  }
  if (row.approvalState === ApprovalState.PENDING || required) {
    return 'awaitingApproval';
  }
  if (row.status === PrismaRequestStatus.COMPLETED) {
    return 'completed';
  }
  if (row.status === PrismaRequestStatus.IN_PROGRESS) {
    return 'inProgress';
  }
  if (row.currentOwnerId != null) {
    return 'claimed';
  }
  if (row.approvalState === ApprovalState.APPROVED) {
    return 'approvedAwaitingHandler';
  }
  return 'awaitingHandler';
}

function initialApprovalState(policy: ApprovalPolicy): ApprovalState {
  return policy === ApprovalPolicy.NONE ? ApprovalState.NOT_REQUIRED : ApprovalState.PENDING;
}

function isApprovalReviewer(actor: Actor) {
  return actor.role === AccountRole.DEPARTMENT_ADMIN || actor.role === AccountRole.SUPER_ADMIN;
}

function canDecideApproval(actor: Actor, request: DecisionRequest) {
  if (!actor.active || request.submittedBy === actor.id) {
    return false;
  }
  if (request.capturedApprovalPolicy === ApprovalPolicy.DEPARTMENT_ADMIN) {
    return (
      actor.role === AccountRole.DEPARTMENT_ADMIN &&
      actor.departmentId != null &&
      actor.departmentId === request.departmentId
    );
  }
  if (request.capturedApprovalPolicy === ApprovalPolicy.SUPER_ADMIN) {
    return actor.role === AccountRole.SUPER_ADMIN;
  }
  return false;
}

function eligibleApproverWhere(request: DecisionRequest) {
  if (request.capturedApprovalPolicy === ApprovalPolicy.SUPER_ADMIN) {
    return {
      companyId: request.companyId,
      active: true,
      role: AccountRole.SUPER_ADMIN,
      id: { not: request.submittedBy },
    };
  }
  return {
    companyId: request.companyId,
    active: true,
    role: AccountRole.DEPARTMENT_ADMIN,
    departmentId: request.departmentId,
    id: { not: request.submittedBy },
  };
}

function waitNotice(policy: ApprovalPolicy | null) {
  if (policy === ApprovalPolicy.DEPARTMENT_ADMIN) {
    return DEPARTMENT_ADMIN_WAIT_NOTICE;
  }
  if (policy === ApprovalPolicy.SUPER_ADMIN) {
    return SUPER_ADMIN_WAIT_NOTICE;
  }
  return null;
}

function requiredDenialReason(reason: string | undefined) {
  const trimmed = reason?.trim() ?? '';
  if (trimmed.length === 0) {
    throw new BadRequestException('Denial requires a reason');
  }
  return trimmed;
}

function isUniqueConstraint(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function optionalText(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
