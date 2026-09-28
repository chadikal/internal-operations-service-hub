import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class UpdateCompanyEmployeeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  departmentId?: number;

  @IsOptional()
  @IsIn(['EMPLOYEE', 'DEPARTMENT_ADMIN', 'SUPER_ADMIN'])
  role?: 'EMPLOYEE' | 'DEPARTMENT_ADMIN' | 'SUPER_ADMIN';

  @IsOptional()
  @IsBoolean()
  canHandle?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateDepartmentEmployeeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsBoolean()
  canHandle?: boolean;
}
