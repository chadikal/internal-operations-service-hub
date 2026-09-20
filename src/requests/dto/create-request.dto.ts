import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateRequestDto {
  @IsInt()
  @Min(1)
  submittedBy: number;

  @IsInt()
  @Min(1)
  departmentId: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
