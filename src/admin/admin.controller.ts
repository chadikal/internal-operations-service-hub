import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { RecordsActivity } from '../auth/auth.decorators';
import { AuthenticatedRequest } from '../auth/session.guard';
import { AdminService } from './admin.service';
import { DepartmentOverviewQueryDto } from './dto/department-admin.query';
import { ListEmployeesQueryDto } from './dto/list-employees.query';
import { ListCompanyRequestsQueryDto } from './dto/list-requests.query';
import { UpdateCompanyEmployeeDto } from './dto/update-employee.dto';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard')
  @RecordsActivity()
  dashboard(@Req() request: AuthenticatedRequest) {
    return this.adminService.dashboard(request.auth!);
  }

  @Get('employees')
  @RecordsActivity()
  listEmployees(@Req() request: AuthenticatedRequest, @Query() query: ListEmployeesQueryDto) {
    return this.adminService.listEmployees(request.auth!, query);
  }

  @Patch('employees/:id')
  @RecordsActivity()
  updateEmployee(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCompanyEmployeeDto,
  ) {
    return this.adminService.updateCompanyEmployee(request.auth!, id, dto);
  }

  @Post('employees/:id/deactivate')
  @HttpCode(200)
  @RecordsActivity()
  deactivateEmployee(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.adminService.deactivateCompanyEmployee(request.auth!, id);
  }

  @Get('department-overview')
  @RecordsActivity()
  departmentOverview(@Req() request: AuthenticatedRequest, @Query() _query: DepartmentOverviewQueryDto) {
    return this.adminService.departmentOverview(request.auth!);
  }

  @Get('requests')
  @RecordsActivity()
  listRequests(@Req() request: AuthenticatedRequest, @Query() query: ListCompanyRequestsQueryDto) {
    return this.adminService.listRequests(request.auth!, query);
  }
}
