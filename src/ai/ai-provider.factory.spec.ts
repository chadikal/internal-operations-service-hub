import { MockAiProvider } from './mock-ai.provider';
import { RequestyAiProvider } from './requesty-ai.provider';
import { createAiProvider, resolveAiProviderName } from './ai-provider.factory';

describe('AI provider factory', () => {
  it('uses mock while Jest is running even if AI_PROVIDER is requesty', () => {
    expect(process.env.JEST_WORKER_ID).toBeDefined();
    expect(
      resolveAiProviderName({
        ...process.env,
        AI_PROVIDER: 'requesty',
        JEST_WORKER_ID: process.env.JEST_WORKER_ID,
      }),
    ).toBe('mock');
    expect(createAiProvider({ ...process.env, AI_PROVIDER: 'requesty' })).toBeInstanceOf(
      MockAiProvider,
    );
  });

  it('selects Requesty only outside Jest when AI_PROVIDER=requesty', () => {
    const env = {
      AI_PROVIDER: 'requesty',
    } as NodeJS.ProcessEnv;
    expect(resolveAiProviderName(env)).toBe('requesty');
    expect(createAiProvider(env)).toBeInstanceOf(RequestyAiProvider);
  });

  it('defaults to mock when AI_PROVIDER is unset', () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(resolveAiProviderName(env)).toBe('mock');
    expect(createAiProvider(env)).toBeInstanceOf(MockAiProvider);
  });
});
