import { IsInt, Min } from 'class-validator';

export class CreateRequestDto {
  @IsInt()
  @Min(1)
  submittedBy: number;

  @IsInt()
  @Min(1)
  departmentId: number;
}
