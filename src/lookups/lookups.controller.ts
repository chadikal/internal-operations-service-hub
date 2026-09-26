import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Req } from '@nestjs/common';
import { ApprovalPolicy } from '@prisma/client';
import { RecordsActivity } from '../auth/auth.decorators';
import { AuthService } from '../auth/auth.service';
import {
  ApplyDepartmentTemplateDto,
  CreateDepartmentDto,
  CreateRequestTypeDto,
  UpdateDepartmentDto,
  UpdateRequestTypeDto,
} from '../auth/dto/auth.dto';
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

  @Get('request-types')
  @RecordsActivity()
  findRequestTypes(@Req() request: AuthenticatedRequest) {
    return this.prisma.requestType.findMany({
      where: { companyId: request.auth!.companyId },
      select: { id: true, departmentId: true, name: true, approvalPolicy: true },
      orderBy: [{ departmentId: 'asc' }, { id: 'asc' }],
    });
  }

  @Get('department-templates')
  @RecordsActivity()
  listDepartmentTemplates(@Req() request: AuthenticatedRequest) {
    return this.authService.listDepartmentTemplates(request.auth!);
  }

  @Get('department-templates/:id')
  @RecordsActivity()
  previewDepartmentTemplate(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.authService.previewDepartmentTemplate(request.auth!, id);
  }

  @Post('departments')
  @RecordsActivity()
  createDepartment(@Req() request: AuthenticatedRequest, @Body() dto: CreateDepartmentDto) {
    return this.authService.createDepartment(request.auth!, {
      name: dto.name,
      templateId: dto.templateId,
      requestTypes: dto.requestTypes,
    });
  }

  @Post('departments/:departmentId/template-types')
  @RecordsActivity()
  applyDepartmentTemplateTypes(
    @Req() request: AuthenticatedRequest,
    @Param('departmentId', ParseIntPipe) departmentId: number,
    @Body() dto: ApplyDepartmentTemplateDto,
  ) {
    return this.authService.applyDepartmentTemplateTypes(request.auth!, departmentId, {
      templateId: dto.templateId,
      requestTypes: dto.requestTypes,
    });
  }

  @Patch('departments/:id')
  @RecordsActivity()
  updateDepartment(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDepartmentDto,
  ) {
    return this.authService.updateDepartment(request.auth!, id, dto.name);
  }

  @Delete('departments/:id')
  @RecordsActivity()
  deleteDepartment(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.authService.deleteDepartment(request.auth!, id);
  }

  @Post('departments/:departmentId/request-types')
  @RecordsActivity()
  createRequestType(
    @Req() request: AuthenticatedRequest,
    @Param('departmentId', ParseIntPipe) departmentId: number,
    @Body() dto: CreateRequestTypeDto,
  ) {
    return this.authService.createRequestType(
      request.auth!,
      departmentId,
      dto.name,
      dto.approvalPolicy as ApprovalPolicy,
    );
  }

  @Patch('request-types/:id')
  @RecordsActivity()
  updateRequestType(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRequestTypeDto,
  ) {
    return this.authService.updateRequestType(request.auth!, id, {
      name: dto.name,
      approvalPolicy: dto.approvalPolicy as ApprovalPolicy | undefined,
    });
  }
}
