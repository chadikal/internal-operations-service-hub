import { AiProvider } from './ai-provider';
import { MockAiProvider } from './mock-ai.provider';
import { RequestyAiProvider } from './requesty-ai.provider';

export type AiProviderName = 'mock' | 'requesty';

export function resolveAiProviderName(
  env: NodeJS.ProcessEnv = process.env,
): AiProviderName {
  if (env.JEST_WORKER_ID !== undefined) {
    return 'mock';
  }
  const value = (env.AI_PROVIDER ?? 'mock').trim().toLowerCase();
  return value === 'requesty' ? 'requesty' : 'mock';
}

export function createAiProvider(env: NodeJS.ProcessEnv = process.env): AiProvider {
  if (resolveAiProviderName(env) === 'requesty') {
    return new RequestyAiProvider();
  }
  return new MockAiProvider();
}
