import { Controller, Get, Query, Req } from '@nestjs/common';
import { RecordsActivity } from '../auth/auth.decorators';
import { AuthenticatedRequest } from '../auth/session.guard';
import { AdminService } from './admin.service';
import { ListEmployeesQueryDto } from './dto/list-employees.query';
import { ListCompanyRequestsQueryDto } from './dto/list-requests.query';

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

  @Get('requests')
  @RecordsActivity()
  listRequests(@Req() request: AuthenticatedRequest, @Query() query: ListCompanyRequestsQueryDto) {
    return this.adminService.listRequests(request.auth!, query);
  }
}
