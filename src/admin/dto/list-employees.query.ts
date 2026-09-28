import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export function optionalQueryString(key: string) {
  return ({ obj }: { obj: unknown }) => {
    if (typeof obj !== 'object' || obj === null || !Object.prototype.hasOwnProperty.call(obj, key)) {
      return undefined;
    }
    const raw = (obj as Record<string, unknown>)[key];
    if (typeof raw !== 'string') {
      return raw;
    }
    const trimmed = raw.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  };
}

export function optionalQueryInt(key: string) {
  return ({ obj }: { obj: unknown }) => {
    if (typeof obj !== 'object' || obj === null || !Object.prototype.hasOwnProperty.call(obj, key)) {
      return undefined;
    }
    const raw = (obj as Record<string, unknown>)[key];
    if (raw === undefined || raw === '') {
      return undefined;
    }
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isInteger(n) ? n : raw;
  };
}

export function optionalQueryBoolean(key: string) {
  return ({ obj }: { obj: unknown }) => {
    if (typeof obj !== 'object' || obj === null || !Object.prototype.hasOwnProperty.call(obj, key)) {
      return undefined;
    }
    const raw = (obj as Record<string, unknown>)[key];
    if (raw === undefined || raw === '') {
      return undefined;
    }
    if (raw === true || raw === 'true') {
      return true;
    }
    if (raw === false || raw === 'false') {
      return false;
    }
    return 'not-a-boolean';
  };
}

export class ListEmployeesQueryDto {
  @Transform(optionalQueryString('q'))
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @Transform(optionalQueryInt('departmentId'))
  @IsOptional()
  @IsInt()
  @Min(1)
  departmentId?: number;

  @Transform(optionalQueryString('role'))
  @IsOptional()
  @IsIn(['EMPLOYEE', 'DEPARTMENT_ADMIN', 'SUPER_ADMIN', 'ADMIN'])
  role?: 'EMPLOYEE' | 'DEPARTMENT_ADMIN' | 'SUPER_ADMIN' | 'ADMIN';

  @Transform(optionalQueryBoolean('canHandle'))
  @IsOptional()
  @IsBoolean()
  canHandle?: boolean;

  @Transform(optionalQueryBoolean('active'))
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
