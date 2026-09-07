import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AssignOwnerDto } from './dto/assign-owner.dto';
import { CreateRequestDto } from './dto/create-request.dto';
import { TransitionRequestDto } from './dto/transition-request.dto';
import { RequestStatus } from './request-status.enum';

export type ServiceRequest = {
  id: number;
  submittedBy: number;
  departmentId: number;
  currentOwnerId: number | null;
  status: RequestStatus;
  statusUpdatedAt: string;
};

export type StatusHistoryRecord = {
  id: number;
  requestId: number;
  previousStatus: RequestStatus;
  newStatus: RequestStatus;
  changedBy: number;
  changedAt: string;
};

const ALLOWED_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  [RequestStatus.SUBMITTED]: [RequestStatus.IN_PROGRESS],
  [RequestStatus.IN_PROGRESS]: [RequestStatus.COMPLETED],
  [RequestStatus.COMPLETED]: [],
};

@Injectable()
export class RequestsService {
  private readonly requests = new Map<number, ServiceRequest>();
  private readonly history: StatusHistoryRecord[] = [];
  private nextRequestId = 1;
  private nextHistoryId = 1;

  create(dto: CreateRequestDto): ServiceRequest {
    const request: ServiceRequest = {
      id: this.nextRequestId++,
      submittedBy: dto.submittedBy,
      departmentId: dto.departmentId,
      currentOwnerId: null,
      status: RequestStatus.SUBMITTED,
      statusUpdatedAt: new Date().toISOString(),
    };
    this.requests.set(request.id, request);
    return request;
  }

  findOne(id: number): ServiceRequest {
    const request = this.requests.get(id);
    if (!request) {
      throw new NotFoundException(`Request ${id} was not found`);
    }
    return request;
  }

  getHistory(id: number): StatusHistoryRecord[] {
    this.findOne(id);
    return this.history.filter((record) => record.requestId === id);
  }

  assignOwner(id: number, dto: AssignOwnerDto): ServiceRequest {
    const request = this.findOne(id);
    request.currentOwnerId = dto.currentOwnerId;
    return request;
  }

  transition(id: number, dto: TransitionRequestDto): ServiceRequest {
    const request = this.findOne(id);

    const allowedNext = ALLOWED_TRANSITIONS[request.status];
    if (!allowedNext.includes(dto.to)) {
      throw new ConflictException(
        `Transition from ${request.status} to ${dto.to} is not allowed`,
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
    const changedAt = new Date().toISOString();
    request.status = dto.to;
    request.statusUpdatedAt = changedAt;

    this.history.push({
      id: this.nextHistoryId++,
      requestId: request.id,
      previousStatus,
      newStatus: dto.to,
      changedBy: dto.changedBy,
      changedAt,
    });

    return request;
  }
}
