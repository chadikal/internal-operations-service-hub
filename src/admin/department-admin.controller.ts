import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { RecordsActivity } from '../auth/auth.decorators';
import { AuthenticatedRequest } from '../auth/session.guard';
import { AdminService } from './admin.service';
import {
  DepartmentDashboardQueryDto,
  ListDepartmentEmployeesQueryDto,
  ListDepartmentRequestsQueryDto,
} from './dto/department-admin.query';
import { UpdateDepartmentEmployeeDto } from './dto/update-employee.dto';

@Controller('department')
export class DepartmentAdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard')
  @RecordsActivity()
  dashboard(@Req() request: AuthenticatedRequest, @Query() _query: DepartmentDashboardQueryDto) {
    return this.adminService.departmentDashboard(request.auth!);
  }

  @Get('employees')
  @RecordsActivity()
  listEmployees(@Req() request: AuthenticatedRequest, @Query() query: ListDepartmentEmployeesQueryDto) {
    return this.adminService.listDepartmentEmployees(request.auth!, query);
  }

  @Patch('employees/:id')
  @RecordsActivity()
  updateEmployee(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDepartmentEmployeeDto,
  ) {
    return this.adminService.updateDepartmentEmployee(request.auth!, id, dto);
  }

  @Post('employees/:id/deactivate')
  @HttpCode(200)
  @RecordsActivity()
  deactivateEmployee(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.adminService.deactivateDepartmentEmployee(request.auth!, id);
  }

  @Get('requests')
  @RecordsActivity()
  listRequests(@Req() request: AuthenticatedRequest, @Query() query: ListDepartmentRequestsQueryDto) {
    return this.adminService.listDepartmentRequests(request.auth!, query);
  }
}
