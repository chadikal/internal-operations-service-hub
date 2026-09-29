import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DEPARTMENT_TEMPLATE_IDS } from '../department-templates';

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
export class UpdateProfileDto {
  @Transform(trimmedString)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(12)
  newPassword!: string;

  @IsString()
  @MinLength(1)
  confirmPassword!: string;
}

export class UpdateCompanyDto {
  @Transform(trimmedString)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;
}

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

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SignupDepartmentDto)
  departments?: SignupDepartmentDto[];
}

export class SignupDepartmentDto {
  @Transform(trimmedString)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConfirmedRequestTypeDto)
  requestTypes!: ConfirmedRequestTypeDto[];
}

export class SignupEmailAvailabilityDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  email!: string;
}

export class OpaqueTokenDto {
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token!: string;
}

export class ForgotPasswordDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token!: string;

  @IsString()
  @MinLength(12)
  password!: string;
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

export class ConfirmedRequestTypeDto {
  @Transform(trimmedString)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsIn(['NONE', 'DEPARTMENT_ADMIN', 'SUPER_ADMIN'])
  approvalPolicy!: 'NONE' | 'DEPARTMENT_ADMIN' | 'SUPER_ADMIN';
}

export class CreateDepartmentDto {
  @Transform(trimmedString)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsIn([...DEPARTMENT_TEMPLATE_IDS])
  templateId?: (typeof DEPARTMENT_TEMPLATE_IDS)[number];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConfirmedRequestTypeDto)
  requestTypes?: ConfirmedRequestTypeDto[];
}

export class UpdateDepartmentDto {
  @Transform(trimmedString)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;
}

export class ApplyDepartmentTemplateDto {
  @IsOptional()
  @IsIn([...DEPARTMENT_TEMPLATE_IDS])
  templateId?: (typeof DEPARTMENT_TEMPLATE_IDS)[number];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConfirmedRequestTypeDto)
  requestTypes!: ConfirmedRequestTypeDto[];
}

export class CreateRequestTypeDto {
  @Transform(trimmedString)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsIn(['NONE', 'DEPARTMENT_ADMIN', 'SUPER_ADMIN'])
  approvalPolicy!: 'NONE' | 'DEPARTMENT_ADMIN' | 'SUPER_ADMIN';
}

export class UpdateRequestTypeDto {
  @IsOptional()
  @Transform(trimmedString)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsIn(['NONE', 'DEPARTMENT_ADMIN', 'SUPER_ADMIN'])
  approvalPolicy?: 'NONE' | 'DEPARTMENT_ADMIN' | 'SUPER_ADMIN';
}
