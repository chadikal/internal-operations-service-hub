import argon2 = require('argon2');

let dummyHash: string | null = null;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export async function verifyAgainstDummy(password: string): Promise<void> {
  if (!dummyHash) {
    dummyHash = await hashPassword('dummy-password-not-used-for-login');
  }
  await verifyPassword(dummyHash, password);
}
