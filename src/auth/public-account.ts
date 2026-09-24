import { AccountRole } from '@prisma/client';

export type PublicAccount = {
  id: number;
  name: string;
  email: string | null;
  companyId: number;
  companyName: string;
  departmentId: number | null;
  role: AccountRole;
  canHandle: boolean;
  active: boolean;
};

export function toPublicAccount(employee: {
  id: number;
  name: string;
  email: string | null;
  companyId: number;
  departmentId: number | null;
  role: AccountRole;
  canHandle: boolean;
  active: boolean;
  company: { name: string };
}): PublicAccount {
  return {
    id: employee.id,
    name: employee.name,
    email: employee.email,
    companyId: employee.companyId,
    companyName: employee.company.name,
    departmentId: employee.departmentId,
    role: employee.role,
    canHandle: employee.canHandle,
    active: employee.active,
  };
}
