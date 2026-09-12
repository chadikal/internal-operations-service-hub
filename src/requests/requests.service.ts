import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Employee, RequestStatus as PrismaRequestStatus } from '@prisma/client';
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

const requestInclude = {
  submitter: true,
  department: true,
  currentOwner: true,
} as const;

@Injectable()
export class RequestsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(actorId: number, dto: CreateRequestDto) {
    const actor = await this.requireActor(actorId);
    if (dto.submittedBy !== actor.id) {
      throw new ForbiddenException('You can only submit requests as yourself');
    }

    await this.ensureEmployee(dto.submittedBy);
    await this.ensureDepartment(dto.departmentId);

    const request = await this.prisma.request.create({
      data: {
        submittedBy: dto.submittedBy,
        departmentId: dto.departmentId,
        currentOwnerId: null,
        status: PrismaRequestStatus.SUBMITTED,
        statusUpdatedAt: new Date(),
      },
      include: requestInclude,
    });

    return this.toRequestResponse(request);
  }

  async findOne(actorId: number, id: number) {
    const actor = await this.requireActor(actorId);
    const request = await this.getRequestOrThrow(id);
    this.assertCanView(actor, request);
    return this.toRequestResponse(request);
  }

  async getHistory(actorId: number, id: number) {
    await this.findOne(actorId, id);
    const history = await this.prisma.requestStatusHistory.findMany({
      where: { requestId: id },
      include: { changedByEmployee: true },
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
    this.assertCanHandle(actor);

    const existing = await this.getRequestOrThrow(id);
    const owner = await this.ensureEmployee(dto.currentOwnerId);
    if (!owner.canHandle) {
      throw new ForbiddenException('The assigned owner must be allowed to handle requests');
    }
    if (owner.id === existing.submittedBy) {
      throw new ForbiddenException('The submitter cannot become the owner of their own request');
    }

    const request = await this.prisma.request.update({
      where: { id },
      data: { currentOwnerId: dto.currentOwnerId },
      include: requestInclude,
    });

    return this.toRequestResponse(request);
  }

  async transition(actorId: number, id: number, dto: TransitionRequestDto) {
    const actor = await this.requireActor(actorId);
    this.assertCanHandle(actor);

    if (dto.changedBy !== actor.id) {
      throw new ForbiddenException('changedBy must match the acting user');
    }

    const request = await this.getRequestOrThrow(id);

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
    const actor = await this.prisma.employee.findUnique({ where: { id: actorId } });
    if (!actor) {
      throw new BadRequestException(`Employee ${actorId} was not found`);
    }
    return actor;
  }

  private assertCanHandle(actor: Employee) {
    if (!actor.canHandle) {
      throw new ForbiddenException('You are not allowed to handle requests');
    }
  }

  private assertCanView(actor: Employee, request: { submittedBy: number }) {
    if (!actor.canHandle && request.submittedBy !== actor.id) {
      throw new ForbiddenException('You are not allowed to view this request');
    }
  }

  private async getRequestOrThrow(id: number) {
    const request = await this.prisma.request.findUnique({
      where: { id },
      include: requestInclude,
    });
    if (!request) {
      throw new NotFoundException(`Request ${id} was not found`);
    }
    return request;
  }

  private async ensureEmployee(id: number) {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee) {
      throw new BadRequestException(`Employee ${id} was not found`);
    }
    return employee;
  }

  private async ensureDepartment(id: number) {
    const department = await this.prisma.department.findUnique({ where: { id } });
    if (!department) {
      throw new BadRequestException(`Department ${id} was not found`);
    }
  }

  private toRequestResponse(request: {
    id: number;
    submittedBy: number;
    departmentId: number;
    currentOwnerId: number | null;
    status: PrismaRequestStatus;
    statusUpdatedAt: Date;
    submitter: { id: number; name: string };
    department: { id: number; name: string };
    currentOwner: { id: number; name: string } | null;
  }) {
    return {
      id: request.id,
      submittedBy: request.submittedBy,
      departmentId: request.departmentId,
      currentOwnerId: request.currentOwnerId,
      status: request.status,
      statusUpdatedAt: request.statusUpdatedAt.toISOString(),
      submitter: {
        id: request.submitter.id,
        name: request.submitter.name,
      },
      department: {
        id: request.department.id,
        name: request.department.name,
      },
      currentOwner: request.currentOwner
        ? {
            id: request.currentOwner.id,
            name: request.currentOwner.name,
          }
        : null,
    };
  }
}
