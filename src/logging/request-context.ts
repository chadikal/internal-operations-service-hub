import { AsyncLocalStorage } from 'async_hooks';

type RequestStore = {
  requestId: string;
};

const requestContext = new AsyncLocalStorage<RequestStore>();

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function acceptRequestId(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!REQUEST_ID_PATTERN.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return requestContext.run({ requestId }, fn);
}

export function currentRequestId(): string {
  return requestContext.getStore()?.requestId ?? 'none';
}
