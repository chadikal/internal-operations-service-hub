const MIN_SECRET_LENGTH = 32;

export function assertJwtSecret(value: string | undefined): string {
  const secret = value?.trim() ?? '';
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      'JWT_SECRET must be a randomly generated string of at least 32 characters. The API will not start without it.',
    );
  }
  return secret;
}
