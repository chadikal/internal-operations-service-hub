import { IsEnum, IsInt, Min } from 'class-validator';
import { RequestStatus } from '../request-status.enum';

export class TransitionRequestDto {
  @IsEnum(RequestStatus)
  to: RequestStatus;

  @IsInt()
  @Min(1)
  changedBy: number;
}
