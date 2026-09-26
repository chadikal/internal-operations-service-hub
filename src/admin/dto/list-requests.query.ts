import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { optionalQueryInt, optionalQueryString } from './list-employees.query';

export class ListCompanyRequestsQueryDto {
  @Transform(optionalQueryString('scope'))
  @IsOptional()
  @IsIn(['all', 'mine'])
  scope?: 'all' | 'mine';

  @Transform(optionalQueryInt('departmentId'))
  @IsOptional()
  @IsInt()
  @Min(1)
  departmentId?: number;

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
