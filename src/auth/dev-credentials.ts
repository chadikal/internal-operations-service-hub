import { normalizeEmail } from './email';

export function planDevCredentialUpdate(
  employee: { id: number; email: string | null; passwordHash: string | null },
  emailArgument: string | undefined,
): { email?: string } {
  if (employee.passwordHash) {
    throw new Error(
      `Employee ${employee.id} already has a password. This command does not overwrite existing credentials.`,
    );
  }
  if (employee.email) {
    if (emailArgument && normalizeEmail(emailArgument) !== employee.email) {
      throw new Error(
        `Employee ${employee.id} already has an email. This command does not overwrite existing credentials.`,
      );
    }
    return {};
  }
  if (!emailArgument) {
    throw new Error(
      `Employee ${employee.id} has no email. Pass an email as the second argument. This command does not invent one.`,
    );
  }
  return { email: normalizeEmail(emailArgument) };
}
