import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { optionalQueryBoolean, optionalQueryInt, optionalQueryString } from './list-employees.query';

export class DepartmentDashboardQueryDto {}

export class DepartmentOverviewQueryDto {}

export class ListDepartmentEmployeesQueryDto {
  @Transform(optionalQueryBoolean('canHandle'))
  @IsOptional()
  @IsBoolean()
  canHandle?: boolean;

  @Transform(optionalQueryString('role'))
  @IsOptional()
  @IsIn(['EMPLOYEE', 'DEPARTMENT_ADMIN', 'SUPER_ADMIN', 'ADMIN'])
  role?: 'EMPLOYEE' | 'DEPARTMENT_ADMIN' | 'SUPER_ADMIN' | 'ADMIN';
}

export class ListDepartmentRequestsQueryDto {
  @Transform(optionalQueryString('status'))
  @IsOptional()
  @IsIn(['SUBMITTED', 'IN_PROGRESS', 'COMPLETED', 'ACTIVE'])
  status?: 'SUBMITTED' | 'IN_PROGRESS' | 'COMPLETED' | 'ACTIVE';

  @Transform(optionalQueryString('assignment'))
  @IsOptional()
  @IsIn(['all', 'unassigned', 'assigned'])
  assignment?: 'all' | 'unassigned' | 'assigned';

  @Transform(optionalQueryString('q'))
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @Transform(optionalQueryInt('page'))
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @Transform(optionalQueryInt('pageSize'))
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number;
}
