export const MIN_PASSWORD_LENGTH = 12;
export const PASSWORD_TOO_SHORT = 'Password must be at least 12 characters.';
export const PASSWORDS_DONT_MATCH = "Passwords don't match.";
export const EMAIL_INVALID = 'Enter a valid email address.';
export const EMAIL_IN_USE = 'This email is already in use.';

export function shortPasswordError(password: string): string {
  if (password.length === 0 || password.length >= MIN_PASSWORD_LENGTH) {
    return '';
  }
  return PASSWORD_TOO_SHORT;
}

export function confirmPasswordError(password: string, confirmPassword: string): string {
  if (confirmPassword.length === 0 || password === confirmPassword) {
    return '';
  }
  return PASSWORDS_DONT_MATCH;
}

export function canSubmitNewPassword(password: string, confirmPassword: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH && password === confirmPassword;
}
