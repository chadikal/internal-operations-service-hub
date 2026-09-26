import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RequestStatus as PrismaRequestStatus, AccountRole, ApprovalPolicy } from '@prisma/client';
import { AssignOwnerDto } from './dto/assign-owner.dto';
import { CreateRequestDto } from './dto/create-request.dto';
import { TransitionRequestDto } from './dto/transition-request.dto';
import { PrismaService } from '../prisma/prisma.service';
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
} as const;

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

    const request = await this.prisma.request.create({
      data: {
        companyId: actor.companyId,
        submittedBy: dto.submittedBy,
        departmentId: dto.departmentId,
        requestTypeId: requestType.id,
        capturedApprovalPolicy: requestType.approvalPolicy,
        currentOwnerId: null,
        status: PrismaRequestStatus.SUBMITTED,
        statusUpdatedAt: new Date(),
        title: optionalText(dto.title),
        description: optionalText(dto.description),
      },
      include: requestInclude,
    });

    return this.toRequestResponse(request);
  }

  async findOne(actorId: number, id: number) {
    const actor = await this.requireActor(actorId);
    const request = await this.getRequestOrThrow(id, actor.companyId);
    this.assertCanView(actor, request);
    return this.toRequestResponse(request);
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

  async assignOwner(actorId: number, id: number, dto: AssignOwnerDto) {
    const actor = await this.requireActor(actorId);
    const existing = await this.getRequestOrThrow(id, actor.companyId);
    this.assertCanHandle(actor);

    const owner = await this.ensureEmployee(dto.currentOwnerId, actor.companyId);
    if (owner.role === AccountRole.SUPER_ADMIN) {
      throw new ForbiddenException('A Super Admin cannot own a request');
    }
    if (!owner.canHandle) {
      throw new ForbiddenException('The assigned owner must be allowed to handle requests');
    }
    if (owner.id === existing.submittedBy) {
      throw new ForbiddenException('The submitter cannot become the owner of their own request');
    }

    const updated = await this.prisma.request.updateMany({
      where: { id, companyId: actor.companyId },
      data: { currentOwnerId: dto.currentOwnerId },
    });
    if (updated.count !== 1) {
      throw new NotFoundException(`Request ${id} was not found`);
    }
    const request = await this.getRequestOrThrow(id, actor.companyId);

    return this.toRequestResponse(request);
  }

  async transition(actorId: number, id: number, dto: TransitionRequestDto) {
    const actor = await this.requireActor(actorId);
    const request = await this.getRequestOrThrow(id, actor.companyId);
    this.assertCanHandle(actor);

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

    return this.toRequestResponse(updated);
  }

  private async requireActor(actorId: number) {
    const actor = await this.prisma.employee.findUnique({
      where: { id: actorId },
      select: { id: true, companyId: true, canHandle: true, role: true },
    });
    if (!actor) {
      throw new BadRequestException(`Employee ${actorId} was not found`);
    }
    return actor;
  }

  private assertCanHandle(actor: { canHandle: boolean; role: AccountRole }) {
    if (actor.role === AccountRole.SUPER_ADMIN || !actor.canHandle) {
      throw new ForbiddenException('You are not allowed to handle requests');
    }
  }

  private assertCanView(
    actor: { id: number; canHandle: boolean; role: AccountRole },
    request: { submittedBy: number },
  ) {
    if (actor.role === AccountRole.SUPER_ADMIN) {
      // Own submissions only. Eligible approval-inbox requests will be added later;
      // do not restore company-wide Super Admin detail access.
      if (request.submittedBy !== actor.id) {
        throw new ForbiddenException('You are not allowed to view this request');
      }
      return;
    }
    if (!actor.canHandle && request.submittedBy !== actor.id) {
      throw new ForbiddenException('You are not allowed to view this request');
    }
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

  private toRequestResponse(request: {
    id: number;
    submittedBy: number;
    departmentId: number;
    requestTypeId: number | null;
    capturedApprovalPolicy: ApprovalPolicy | null;
    currentOwnerId: number | null;
    status: PrismaRequestStatus;
    statusUpdatedAt: Date;
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
      status: request.status,
      statusUpdatedAt: request.statusUpdatedAt.toISOString(),
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

function optionalText(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
