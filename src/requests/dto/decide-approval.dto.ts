import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class DecideApprovalDto {
  @IsIn(['APPROVED', 'DENIED'])
  decision: 'APPROVED' | 'DENIED';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
