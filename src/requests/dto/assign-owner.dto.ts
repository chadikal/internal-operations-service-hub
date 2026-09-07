import { IsInt, Min } from 'class-validator';

export class AssignOwnerDto {
  @IsInt()
  @Min(1)
  currentOwnerId: number;
}
