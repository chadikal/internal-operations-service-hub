import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const invalidLoginCredential = Object.freeze({ invalidLoginCredential: true });

/**
 * A missing email or password stays undefined so the service can return the
 * same 401 as a wrong password. Null and every other supplied non-string are
 * rejected here. Implicit conversion runs before @Transform and would turn
 * numbers, booleans, objects, and arrays into strings, so this reads the raw
 * property instead.
 */
function loginCredential({ obj, key }: { obj: unknown; key: string }): unknown {
  if (typeof obj !== 'object' || obj === null || !Object.prototype.hasOwnProperty.call(obj, key)) {
    return undefined;
  }
  const raw = (obj as Record<string, unknown>)[key];
  return typeof raw === 'string' ? raw : invalidLoginCredential;
}

/**
 * Login fields stay optional so a missing email or password reaches the
 * service and returns the same 401 as a wrong password. Null, numbers,
 * booleans, objects, and arrays are rejected here as 400.
 *
 * Signup checks company name, founder name, email, and a password of at
 * least 12 characters. Invitations check the same name, email, department,
 * role, and canHandle rules without a password. Email is trimmed and
 * lowercased here, then accepted only if normalizeEmail accepts it in the
 * service. Duplicate email and an unknown department are service results.
 */
export class LoginDto {
  @Transform(loginCredential)
  @IsOptional()
  @IsString()
  email?: string;

  @Transform(loginCredential)
  @IsOptional()
  @IsString()
  password?: string;
}

function trimmedString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function booleanField(key: string) {
  return ({ obj }: { obj: unknown }) => {
    const raw = (obj as Record<string, unknown>)[key];
    return raw === true || raw === false ? raw : 'not-a-boolean';
  };
}

export class SignupCompanyDto {
  @Transform(trimmedString)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  companyName!: string;

  @Transform(trimmedString)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsString()
  email!: string;

  @IsString()
  @MinLength(12)
  password!: string;
}

export class OpaqueTokenDto {
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token!: string;
}

export class AcceptInvitationDto {
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token!: string;

  @IsString()
  @MinLength(12)
  password!: string;
}

export class InviteStaffDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsString()
  email!: string;

  @Transform(trimmedString)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsInt()
  @Min(1)
  departmentId!: number;

  @IsIn(['EMPLOYEE', 'DEPARTMENT_ADMIN', 'SUPER_ADMIN'])
  role!: 'EMPLOYEE' | 'DEPARTMENT_ADMIN' | 'SUPER_ADMIN';

  // Implicit conversion runs before @Transform and Boolean("false") is true.
  // Read the original property so only a real boolean is kept.
  @Transform(booleanField('canHandle'))
  @IsBoolean()
  canHandle!: boolean;
}

export class CreateDepartmentDto {
  @Transform(trimmedString)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;
}
