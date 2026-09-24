import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { RecordsActivity } from '../auth/auth.decorators';
import { AuthService } from '../auth/auth.service';
import { CreateDepartmentDto } from '../auth/dto/auth.dto';
import { AuthenticatedRequest } from '../auth/session.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller()
export class LookupsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  @Get('employees')
  @RecordsActivity()
  findEmployees(@Req() request: AuthenticatedRequest) {
    return this.prisma.employee.findMany({
      where: { companyId: request.auth!.companyId },
      select: { id: true, name: true, departmentId: true, canHandle: true },
      orderBy: { id: 'asc' },
    });
  }

  @Get('departments')
  @RecordsActivity()
  findDepartments(@Req() request: AuthenticatedRequest) {
    return this.prisma.department.findMany({
      where: { companyId: request.auth!.companyId },
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
    });
  }

  @Post('departments')
  @RecordsActivity()
  createDepartment(@Req() request: AuthenticatedRequest, @Body() dto: CreateDepartmentDto) {
    return this.authService.createDepartment(request.auth!, dto.name);
  }
}
