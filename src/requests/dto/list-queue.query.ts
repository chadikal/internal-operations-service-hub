import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { optionalQueryString } from '../../admin/dto/list-employees.query';

export const REQUEST_QUEUES = ['submitted', 'available', 'claimed', 'completed', 'department'] as const;
export type RequestQueue = (typeof REQUEST_QUEUES)[number];

export class ListQueueQueryDto {
  @Transform(optionalQueryString('queue'))
  @IsIn(REQUEST_QUEUES)
  queue!: RequestQueue;

  @Transform(optionalQueryString('q'))
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @Transform(optionalQueryString('approvalState'))
  @IsOptional()
  @IsIn(['NOT_REQUIRED', 'PENDING', 'APPROVED', 'DENIED', 'UNSET'])
  approvalState?: 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'DENIED' | 'UNSET';

  @Transform(optionalQueryString('workStatus'))
  @IsOptional()
  @IsIn(['SUBMITTED', 'IN_PROGRESS', 'COMPLETED'])
  workStatus?: 'SUBMITTED' | 'IN_PROGRESS' | 'COMPLETED';

  @Transform(optionalQueryString('assignment'))
  @IsOptional()
  @IsIn(['all', 'unclaimed', 'claimed'])
  assignment?: 'all' | 'unclaimed' | 'claimed';
}
