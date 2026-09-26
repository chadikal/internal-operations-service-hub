import { Injectable } from '@nestjs/common';
import { AccountRole, Prisma, RequestStatus } from '@prisma/client';
import { AuthService, SessionAccount } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { ListEmployeesQueryDto } from './dto/list-employees.query';
import { ListCompanyRequestsQueryDto } from './dto/list-requests.query';

export type CompanyDashboardCounts = {
  employees: number;
  departments: number;
  requests: number;
  submitted: number;
  inProgress: number;
  completed: number;
  activeRequests: number;
};

export type CompanyEmployee = {
  id: number;
  name: string;
  email: string | null;
  department: { id: number; name: string } | null;
  role: AccountRole;
  canHandle: boolean;
  active: boolean;
};

export type CompanyRequestListItem = {
  id: number;
  title: string | null;
  status: RequestStatus;
  submitter: { name: string };
  submitterDepartment: { name: string } | null;
  department: { name: string };
  mine: boolean;
};

export type CompanyRequestList = {
  items: CompanyRequestListItem[];
  total: number;
  page: number;
  pageSize: number;
};

const employeePublicSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  canHandle: true,
  active: true,
  department: { select: { id: true, name: true } },
} as const;

const requestListSelect = {
  id: true,
  title: true,
  status: true,
  submittedBy: true,
  submitter: {
    select: {
      name: true,
      department: { select: { name: true } },
    },
  },
  department: { select: { name: true } },
} as const;

const DEFAULT_PAGE_SIZE = 20;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  async dashboard(actor: SessionAccount): Promise<CompanyDashboardCounts> {
    this.authService.assertCompanySuperAdmin(actor);
    const companyId = actor.companyId;
    const [employees, departments, statusCounts] = await Promise.all([
      this.prisma.employee.count({ where: { companyId } }),
      this.prisma.department.count({ where: { companyId } }),
      this.prisma.request.groupBy({
        by: ['status'],
        where: { companyId },
        _count: { _all: true },
      }),
    ]);
    const byStatus: Record<RequestStatus, number> = {
      SUBMITTED: 0,
      IN_PROGRESS: 0,
      COMPLETED: 0,
    };
    for (const row of statusCounts) {
      byStatus[row.status] = row._count._all;
    }
    const submitted = byStatus.SUBMITTED;
    const inProgress = byStatus.IN_PROGRESS;
    const completed = byStatus.COMPLETED;
    return {
      employees,
      departments,
      requests: submitted + inProgress + completed,
      submitted,
      inProgress,
      completed,
      activeRequests: submitted + inProgress,
    };
  }

  async listEmployees(actor: SessionAccount, query: ListEmployeesQueryDto): Promise<CompanyEmployee[]> {
    this.authService.assertCompanySuperAdmin(actor);
    const where: Prisma.EmployeeWhereInput = { companyId: actor.companyId };
    if (query.q) {
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        { email: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    if (query.departmentId != null) {
      where.departmentId = query.departmentId;
    }
    if (query.role) {
      where.role = query.role;
    }
    if (query.canHandle != null) {
      where.canHandle = query.canHandle;
    }
    if (query.active != null) {
      where.active = query.active;
    }
    const rows = await this.prisma.employee.findMany({
      where,
      select: employeePublicSelect,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      department: row.department,
      role: row.role,
      canHandle: row.canHandle,
      active: row.active,
    }));
  }

  async listRequests(actor: SessionAccount, query: ListCompanyRequestsQueryDto): Promise<CompanyRequestList> {
    this.authService.assertCompanySuperAdmin(actor);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const where: Prisma.RequestWhereInput = { companyId: actor.companyId };
    if (query.scope === 'mine') {
      where.submittedBy = actor.id;
    }
    if (query.departmentId != null) {
      where.departmentId = query.departmentId;
    }
    if (query.status === 'ACTIVE') {
      where.status = { in: [RequestStatus.SUBMITTED, RequestStatus.IN_PROGRESS] };
    } else if (query.status) {
      where.status = query.status;
    }
    if (query.assignment === 'unassigned') {
      where.currentOwnerId = null;
    } else if (query.assignment === 'assigned') {
      where.currentOwnerId = { not: null };
    }
    if (query.q) {
      const search: Prisma.RequestWhereInput[] = [
        { title: { contains: query.q, mode: 'insensitive' } },
        { submitter: { name: { contains: query.q, mode: 'insensitive' } } },
        { submitter: { department: { name: { contains: query.q, mode: 'insensitive' } } } },
        { department: { name: { contains: query.q, mode: 'insensitive' } } },
      ];
      const asId = Number(query.q);
      if (Number.isInteger(asId) && asId > 0 && String(asId) === query.q) {
        search.push({ id: asId });
      }
      where.OR = search;
    }
    const [total, rows] = await Promise.all([
      this.prisma.request.count({ where }),
      this.prisma.request.findMany({
        where,
        select: requestListSelect,
        orderBy: [{ statusUpdatedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        submitter: { name: row.submitter.name },
        submitterDepartment: row.submitter.department,
        department: { name: row.department.name },
        mine: row.submittedBy === actor.id,
      })),
      total,
      page,
      pageSize,
    };
  }
}
